// Brielle — consulta el estado de una canción en Soundverse y, si está lista,
// devuelve enlaces de audio temporales (se piden de nuevo cada vez que se reproduce).
//
// Uso normal (desde la app): GET /.netlify/functions/song-status?id=JOB_ID   con encabezado x-brielle-code
// Diagnóstico (desde el navegador):
//   /.netlify/functions/song-status?debug=1&code=TU_CODIGO            -> última canción generada
//   /.netlify/functions/song-status?debug=1&code=TU_CODIGO&id=JOB_ID  -> una canción específica

const API = 'https://apiv2.soundverse.ai';

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body, null, 2),
});

const auth = () => ({ Authorization: `Bearer ${process.env.SOUNDVERSE_API_KEY}` });

// Busca el primer enlace http(s) dentro de cualquier respuesta, sin importar cómo se llame el campo.
function findUrl(obj, depth = 0) {
  if (!obj || depth > 5) return null;
  if (typeof obj === 'string') return /^https?:\/\//i.test(obj) ? obj : null;
  if (Array.isArray(obj)) { for (const v of obj) { const u = findUrl(v, depth + 1); if (u) return u; } return null; }
  if (typeof obj === 'object') {
    // Primero los campos que más probablemente son el enlace de descarga.
    const preferred = ['signed_url', 'download_url', 'url', 'href', 'link', 'presigned_url', 'playback_url'];
    for (const k of preferred) { const u = findUrl(obj[k], depth + 1); if (u) return u; }
    for (const k of Object.keys(obj)) { const u = findUrl(obj[k], depth + 1); if (u) return u; }
  }
  return null;
}

// Pide a Soundverse un enlace firmado de corta duración para un archivo.
async function signedUrl(fileId) {
  const res = await fetch(`${API}/v1/files/${encodeURIComponent(fileId)}/download`, {
    headers: auth(),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    return { url: res.headers.get('location'), status: res.status, raw: { redirect: res.headers.get('location') } };
  }
  const text = await res.text();
  let raw;
  try { raw = JSON.parse(text); } catch { raw = text.slice(0, 2000); }
  const url = typeof raw === 'string' ? (/^https?:\/\//i.test(raw.trim()) ? raw.trim() : null) : findUrl(raw);
  return { url: res.ok ? url : null, status: res.status, raw };
}

// Encuentra la lista de archivos de audio de una tarea, se llame como se llame el campo.
function getAssets(task) {
  const out = task.output || task.result || task.outputs || {};
  const list = out.assets || task.assets || out.files || (Array.isArray(out) ? out : []) || [];
  return Array.isArray(list) ? list : [];
}
const assetFileId = a => a.file_id || a.fileId || a.id || (a.file && (a.file.id || a.file.file_id)) || null;

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const debug = q.debug === '1';
  const code = event.headers['x-brielle-code'] || (debug ? q.code : '') || '';
  if (!process.env.BRIELLE_ACCESS_CODE || code !== process.env.BRIELLE_ACCESS_CODE) {
    return json(401, { error: 'Código de acceso inválido' });
  }
  if (!process.env.SOUNDVERSE_API_KEY) return json(500, { error: 'Falta SOUNDVERSE_API_KEY en Netlify' });

  let id = String(q.id || '').trim();

  try {
    // Diagnóstico sin id: tomar la generación más reciente de la cuenta.
    let listRaw;
    if (debug && !id) {
      const lr = await fetch(`${API}/v1/generations?limit=1`, { headers: auth() });
      listRaw = await lr.json().catch(() => ({}));
      const items = listRaw.items || listRaw.generations || listRaw.data || listRaw.tasks || (Array.isArray(listRaw) ? listRaw : []);
      const first = Array.isArray(items) ? items[0] : null;
      id = first ? (first.id || first.task_id || first.job_id || '') : '';
      if (!id) return json(200, { note: 'No encontré generaciones en la lista', listRaw });
    }
    if (!id) return json(400, { error: 'Falta el id' });

    const res = await fetch(`${API}/v1/generations/${encodeURIComponent(id)}`, { headers: auth() });
    const data = await res.json().catch(() => ({}));
    const task = data.task || data.generation || data;

    if (debug) {
      const assets = getAssets(task);
      const fid = assets[0] ? assetFileId(assets[0]) : null;
      const download = fid ? await signedUrl(fid) : null;
      return json(200, { id, generationStatus: res.status, generation: data, firstFileId: fid, download, listRaw });
    }

    if (!res.ok) return json(res.status, { error: data.error || 'Error de Soundverse', message: data.message || '' });

    const status = String(task.status || '').toLowerCase(); // queued / processing / completed / failed
    if (status === 'failed') {
      return json(200, { status, error: task.error || task.message || (task.output && task.output.error) || 'La generación falló' });
    }
    if (status !== 'completed' && status !== 'succeeded' && status !== 'success') {
      return json(200, { status: status || 'processing' });
    }

    const tracks = [];
    for (const a of getAssets(task)) {
      const fileId = assetFileId(a);
      if (!fileId) continue;
      const d = await signedUrl(fileId);
      tracks.push({
        fileId,
        url: d.url,
        duration: a.duration || a.duration_seconds || (a.metadata && a.metadata.duration) || null,
        title: a.title || a.name || null,
      });
    }
    if (!tracks.length) return json(200, { status: 'completed', error: 'Canción lista pero sin archivos de audio' });
    return json(200, { status: 'completed', tracks });
  } catch (e) {
    return json(502, { error: 'No se pudo contactar a Soundverse', message: String(e.message || e) });
  }
};
