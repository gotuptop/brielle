// Brielle — crea una canción en Soundverse para un usuario con sesión.
// Descuenta 1 crédito en el servidor ANTES de generar; si algo falla, lo devuelve.
// Variables de entorno en Netlify:
//   SOUNDVERSE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { API } = require('../lib/soundverse');
const sb = require('../lib/supabase');

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});
const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!process.env.SOUNDVERSE_API_KEY) return json(500, { error: 'Falta SOUNDVERSE_API_KEY en Netlify' });
  if (!sb.configured()) return json(500, { error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Netlify' });

  let user;
  try { user = await sb.getUser(event); } catch { return json(502, { error: 'No se pudo verificar tu sesión' }); }
  if (!user) return json(401, { error: 'Inicia sesión para crear canciones' });

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON inválido' }); }

  const prompt = clean(input.prompt, 1024);
  const lyrics = clean(input.lyrics, 3000);
  const title = clean(input.title, 120) || 'Sin título';
  const gender = ['male', 'female'].includes(input.gender) ? input.gender : '';
  if (!prompt) return json(400, { error: 'Falta la descripción del estilo' });

  // 1) Cobrar el crédito (atómico en la base de datos).
  let credits;
  try { credits = await sb.rpc('consume_credit', { p_user: user.id }); }
  catch (e) { return json(502, { error: 'No se pudo verificar tu saldo', message: String(e.message || e) }); }
  if (typeof credits !== 'number' || credits < 0) {
    return json(402, { error: 'NoCredits', message: 'No te quedan canciones disponibles.' });
  }

  const refund = async () => { try { return await sb.rpc('refund_credit', { p_user: user.id }); } catch { return null; } };

  // 2) Registrar la canción (así queda guardada aunque el usuario cierre la página).
  let song;
  try {
    song = await sb.insertSong({
      user_id: user.id, title, genre: clean(input.genre, 40), voice: clean(input.voice, 40), mood: clean(input.mood, 40),
      tempo: Number.isFinite(+input.tempo) ? Math.round(+input.tempo) : null,
      prompt, lyrics, instrumental: !lyrics, status: 'queued',
    });
  } catch (e) {
    await refund();
    return json(500, { error: 'No se pudo guardar la canción', message: String(e.message || e) });
  }

  // 3) Mandar a Soundverse.
  const body = { prompt, lyrics, parameters: { versions: 1 } }; // 1 versión = 1 canción cobrada
  if (gender) body.gender = gender;
  const failAndRefund = async () => {
    try { if (await sb.settleSong(song.id, { status: 'failed' })) await refund(); } catch {}
  };

  try {
    const res = await fetch(`${API}/v7/generate/song`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SOUNDVERSE_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `brielle-${song.id}`, // evita cobros dobles si Netlify reintenta
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await failAndRefund();
      return json(res.status, { error: data.error || 'Error de Soundverse', message: data.message || '', retryable: !!data.retryable });
    }
    const jobId = data.job_id || data.task_id || data.id;
    if (!jobId) { await failAndRefund(); return json(502, { error: 'Soundverse no devolvió un id de trabajo' }); }
    await sb.patchSong(song.id, { soundverse_task_id: String(jobId), status: 'processing' });
    return json(200, { song: { ...song, soundverse_task_id: String(jobId), status: 'processing' }, credits });
  } catch (e) {
    await failAndRefund();
    return json(502, { error: 'No se pudo contactar a Soundverse', message: String(e.message || e) });
  }
};
