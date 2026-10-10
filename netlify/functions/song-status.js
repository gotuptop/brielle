// Brielle — consulta el estado de una canción. Cuando Soundverse la termina, el servidor
// copia el audio al almacenamiento privado de Supabase (los enlaces de Soundverse vencen),
// y marca la canción como lista.
//
// Uso normal (desde la app): GET /.netlify/functions/song-status?id=SONG_ID   con sesión (Authorization: Bearer ...)
// Diagnóstico (solo administrador, requiere BRIELLE_ACCESS_CODE):
//   /.netlify/functions/song-status?debug=1&code=TU_CODIGO[&id=JOB_ID_DE_SOUNDVERSE]

const { API, auth, getAssets, assetFileId, resolveUrl } = require('../lib/soundverse');
const sb = require('../lib/supabase');

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body, null, 2),
});

async function debugMode(q) {
  if (!process.env.BRIELLE_ACCESS_CODE || q.code !== process.env.BRIELLE_ACCESS_CODE) return json(401, { error: 'Código inválido' });
  let id = String(q.id || '').trim();
  if (!id) {
    const lr = await fetch(`${API}/v1/generations?limit=1`, { headers: auth() });
    const listRaw = await lr.json().catch(() => ({}));
    const items = listRaw.items || listRaw.generations || listRaw.data || listRaw.tasks || (Array.isArray(listRaw) ? listRaw : []);
    const first = Array.isArray(items) ? items[0] : null;
    id = first ? (first.id || first.task_id || first.job_id || '') : '';
    if (!id) return json(200, { note: 'No encontré generaciones en la lista', listRaw });
  }
  const res = await fetch(`${API}/v1/generations/${encodeURIComponent(id)}`, { headers: auth() });
  const data = await res.json().catch(() => ({}));
  const task = data.task || data.generation || data;
  const assets = getAssets(task);
  const download = assets[0] ? await resolveUrl(id, assets[0], true) : null;
  const slim = JSON.parse(JSON.stringify(data));
  if (slim.output && slim.output.metadata_json) slim.output.metadata_json = String(slim.output.metadata_json).slice(0, 200) + '…';
  return json(200, { id, status: task.status, workingRoute: download && download.via, download, generation: slim });
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (!process.env.SOUNDVERSE_API_KEY) return json(500, { error: 'Falta SOUNDVERSE_API_KEY en Netlify' });
  try {
    if (q.debug === '1') return await debugMode(q);

    if (!sb.configured()) return json(500, { error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Netlify' });
    const user = await sb.getUser(event);
    if (!user) return json(401, { error: 'Inicia sesión' });

    const id = String(q.id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'Falta el id' });
    const song = await sb.getSong(id, user.id);
    if (!song) return json(404, { error: 'Canción no encontrada' });

    if (song.status === 'completed') return json(200, { status: 'completed', duration: song.duration });
    if (song.status === 'failed') return json(200, { status: 'failed', error: 'La generación falló' });
    if (!song.soundverse_task_id) return json(200, { status: 'processing' });

    const res = await fetch(`${API}/v1/generations/${encodeURIComponent(song.soundverse_task_id)}`, { headers: auth() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json(200, { status: 'processing' }); // fallo temporal: la app vuelve a preguntar
    const task = data.task || data.generation || data;
    const status = String(task.status || '').toLowerCase();

    if (status === 'failed') {
      const msg = task.error || task.message || (task.output && task.output.error) || 'La generación falló';
      // Solo quien cambia el estado devuelve el crédito, así nunca se devuelve dos veces.
      if (await sb.settleSong(song.id, { status: 'failed' })) await sb.rpc('refund_credit', { p_user: user.id });
      return json(200, { status: 'failed', error: typeof msg === 'string' ? msg : 'La generación falló' });
    }
    if (!['completed', 'succeeded', 'success'].includes(status)) return json(200, { status: 'processing' });

    // Lista en Soundverse: copiar el audio a nuestro almacenamiento.
    const asset = getAssets(task).find(a => assetFileId(a));
    if (!asset) return json(200, { status: 'processing' });
    const d = await resolveUrl(song.soundverse_task_id, asset, false);
    if (!d.url) return json(200, { status: 'processing' });

    const audioRes = await fetch(d.url);
    if (!audioRes.ok) return json(200, { status: 'processing' });
    const type = (audioRes.headers.get('content-type') || 'audio/mpeg').split(';')[0];
    const ext = /wav/.test(type) ? 'wav' : /ogg/.test(type) ? 'ogg' : /mp4|m4a|aac/.test(type) ? 'm4a' : 'mp3';
    const buf = Buffer.from(await audioRes.arrayBuffer());
    const path = `${user.id}/${song.id}.${ext}`;
    await sb.uploadAudio(path, buf, type.startsWith('audio/') ? type : 'audio/mpeg');

    let meta = {}; try { meta = JSON.parse(asset.metadata_json || '{}'); } catch {}
    const duration = meta.duration_ms ? meta.duration_ms / 1000 : (asset.duration || asset.duration_seconds || null);
    await sb.settleSong(song.id, { status: 'completed', audio_path: path, duration });
    return json(200, { status: 'completed', duration });
  } catch (e) {
    // Error temporal (red, almacenamiento…): la app vuelve a preguntar en unos segundos.
    return json(200, { status: 'processing', note: String(e.message || e).slice(0, 200) });
  }
};
