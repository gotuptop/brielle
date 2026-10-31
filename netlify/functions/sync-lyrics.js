// Brielle — Karaoke: calcula en qué segundo empieza cada línea de la letra.
//
// Soundverse entrega el audio y la letra por separado, sin tiempos. Aquí se manda el audio
// a Deepgram (voz a texto con marca de tiempo por palabra) y, como la letra exacta ya la
// tenemos, se alinea palabra por palabra con lo que Deepgram oyó. El resultado se guarda en
// songs.lyrics_timing y la app lo usa para iluminar la línea que está sonando.
//
// Uso (desde la app): POST /.netlify/functions/sync-lyrics  {id: SONG_ID}  con sesión.
// Respuesta: { timing: [{t, line}, ...] }   (t = segundos desde el inicio)
// Variables en Netlify: DEEPGRAM_API_KEY (+ las de Supabase que ya existen).

const sb = require('../lib/supabase');

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

// Normaliza una palabra para compararla: minúsculas, sin acentos ni signos.
const norm = w => String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');

// Puntuación de parecido entre una palabra de la letra y una oída por Deepgram.
function sim(a, b) {
  if (!a || !b) return -1;
  if (a === b) return 2;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return 1;
  if (a.length >= 3 && b.length >= 3 && a[0] === b[0] && Math.abs(a.length - b.length) <= 1) {
    let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
    if (d <= 1) return 1;
  }
  return -1;
}

// Alineación de secuencias (Needleman–Wunsch): devuelve, para cada palabra de la letra,
// el índice de la palabra oída que le corresponde (o -1).
function align(lyr, heard) {
  const n = lyr.length, m = heard.length, GAP_L = -0.6, GAP_H = -0.4;
  const S = new Float32Array((n + 1) * (m + 1)), P = new Uint8Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) { S[at(i, 0)] = S[at(i - 1, 0)] + GAP_L; P[at(i, 0)] = 1; }
  for (let j = 1; j <= m; j++) { S[at(0, j)] = S[at(0, j - 1)] + GAP_H; P[at(0, j)] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const d = S[at(i - 1, j - 1)] + sim(lyr[i - 1], heard[j - 1]);
    const u = S[at(i - 1, j)] + GAP_L, l = S[at(i, j - 1)] + GAP_H;
    if (d >= u && d >= l) { S[at(i, j)] = d; P[at(i, j)] = 0; }
    else if (u >= l) { S[at(i, j)] = u; P[at(i, j)] = 1; }
    else { S[at(i, j)] = l; P[at(i, j)] = 2; }
  }
  const map = new Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const p = (i > 0 && j > 0) ? P[at(i, j)] : (i > 0 ? 1 : 2);
    if (p === 0) { if (sim(lyr[i - 1], heard[j - 1]) > 0) map[i - 1] = j - 1; i--; j--; }
    else if (p === 1) i--;
    else j--;
  }
  return map;
}

// Convierte letra + palabras oídas en el tiempo de inicio de cada línea.
function lineTimes(lyrics, words, duration) {
  const lines = String(lyrics).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const lyr = [], owner = [];
  lines.forEach((ln, li) => ln.split(/\s+/).map(norm).filter(Boolean).forEach(w => { lyr.push(w); owner.push(li); }));
  const heard = words.map(w => norm(w.word));
  const map = align(lyr, heard);

  const starts = new Array(lines.length).fill(null);
  map.forEach((j, k) => { if (j >= 0 && starts[owner[k]] == null) starts[owner[k]] = words[j].start; });

  // Líneas que no se oyeron (coros tarareados, voces superpuestas): se reparten entre las vecinas.
  let prev = 0, prevIdx = -1;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] == null) continue;
    const gap = i - prevIdx;
    for (let k = prevIdx + 1; k < i; k++) starts[k] = prev + (starts[i] - prev) * (k - prevIdx) / gap;
    prev = starts[i]; prevIdx = i;
  }
  const end = duration || (words.length ? words[words.length - 1].end + 5 : prev + 20);
  for (let k = prevIdx + 1; k < starts.length; k++) starts[k] = prev + (end - prev) * (k - prevIdx) / (starts.length - prevIdx + 1);
  // Nunca hacia atrás.
  for (let i = 1; i < starts.length; i++) if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1];

  const matched = starts.filter((_, i) => map.some((j, k) => j >= 0 && owner[k] === i)).length;
  return { timing: lines.map((line, i) => ({ t: Math.max(0, Math.round(starts[i] * 100) / 100), line })), matched, total: lines.length };
}

async function transcribe(url) {
  const params = new URLSearchParams({ model: 'nova-3', language: 'multi', punctuate: 'false', smart_format: 'false' });
  let res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    // Si el modo multilingüe no está disponible en la cuenta, se intenta en español.
    params.set('language', 'es');
    res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const alt = data.results && data.results.channels && data.results.channels[0] && data.results.channels[0].alternatives[0];
  return (alt && alt.words) || [];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'MethodNotAllowed' });
  if (!process.env.DEEPGRAM_API_KEY) return json(500, { error: 'NoDeepgramKey', message: 'Falta DEEPGRAM_API_KEY en Netlify' });
  if (!sb.configured()) return json(500, { error: 'NoSupabase' });
  try {
    const user = await sb.getUser(event);
    if (!user) return json(401, { error: 'Unauthorized' });
    let body = {}; try { body = JSON.parse(event.body || '{}'); } catch {}
    const id = String(body.id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'BadId' });
    const song = await sb.getSong(id, user.id);
    if (!song) return json(404, { error: 'NotFound' });
    if (song.lyrics_timing && !body.force) return json(200, { timing: song.lyrics_timing, cached: true });
    if (song.status !== 'completed' || !song.audio_path) return json(409, { error: 'NotReady' });
    if (!song.lyrics || !song.lyrics.trim()) return json(409, { error: 'NoLyrics' });

    const url = await sb.signedUrl('songs', song.audio_path, 900);
    if (!url) return json(500, { error: 'NoAudio' });
    const words = await transcribe(url);
    if (!words.length) return json(502, { error: 'NothingHeard' });

    const { timing, matched, total } = lineTimes(song.lyrics, words, song.duration);
    await sb.patchSong(song.id, { lyrics_timing: timing });
    return json(200, { timing, matched, total });
  } catch (e) {
    return json(500, { error: 'SyncFailed', message: String(e.message || e).slice(0, 300) });
  }
};

exports.lineTimes = lineTimes;
