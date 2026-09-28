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

// Un enlace sirve si es http(s) y NO es el localizador privado sin firma (…/private/… sin token).
const usable = u => typeof u === 'string' && /^https?:\/\//i.test(u) &&
  !(/\/private\//.test(u) && !/[?&](sig|se|sv|token|X-Amz-Signature|Signature)=/i.test(u));

// Busca el primer enlace utilizable dentro de cualquier respuesta, sin importar cómo se llame el campo.
function findUrl(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') return usable(obj) ? obj : null;
  if (Array.isArray(obj)) { for (const v of obj) { const u = findUrl(v, depth + 1); if (u) return u; } return null; }
  if (typeof obj === 'object') {
    const preferred = ['signed_url', 'download_url', 'audio_url', 'song_url', 'url', 'href', 'link', 'presigned_url', 'playback_url', 'stream_url'];
    for (const k of preferred) { const u = findUrl(obj[k], depth + 1); if (u) return u; }
    for (const k of Object.keys(obj)) { const u = findUrl(obj[k], depth + 1); if (u) return u; }
  }
  return null;
}

async function tryGet(path) {
  const res = await fetch(`${API}${path}`, { headers: auth(), redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    return { path, status: res.status, url: usable(loc) ? loc : null, raw: { redirect: loc } };
  }
  const text = await res.text();
  let raw; try { raw = JSON.parse(text); } catch { raw = text.slice(0, 1500); }
  let url = null;
  if (res.ok) url = typeof raw === 'string' ? (usable(raw.trim()) ? raw.trim() : null) : findUrl(raw);
  return { path, status: res.status, url, raw: typeof raw === 'string' ? raw : JSON.stringify(raw).slice(0, 1500) };
}

// Rutas posibles para obtener un enlace reproducible, en orden de preferencia.
function candidates(jobId, fileId, blobHash) {
  const f = encodeURIComponent(fileId || ''), j = encodeURIComponent(jobId || '');
  const list = [];
  if (fileId) list.push(`/v1/files/${f}/download`, `/v1/files/${f}/download-url`, `/v1/files/${f}/url`, `/v1/files/${f}`);
  if (jobId) list.push(`/v7/status?job_id=${j}`, `/v5/status?job_id=${j}`);
  if (blobHash) list.push(`/v1/files/${encodeURIComponent(blobHash)}/download`);
  return list;
}

// Devuelve el primer enlace que funcione (y, si se pide, el detalle de cada intento).
async function resolveUrl(jobId, asset, collectAll) {
  const tries = [];
  for (const path of candidates(jobId, assetFileId(asset), asset.blob_hash)) {
    let r;
    try { r = await tryGet(path); } catch (e) { r = { path, status: 0, url: null, raw: String(e.message || e) }; }
    tries.push(r);
    if (r.url && !collectAll) break;
  }
  const hit = tries.find(t => t.url);
  return { url: hit ? hit.url : null, via: hit ? hit.path : null, tries };
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
      const download = assets[0] ? await resolveUrl(id, assets[0], true) : null;
      // Recortamos la respuesta larga (letra con tiempos) para que el diagnóstico sea legible.
      const slim = JSON.parse(JSON.stringify(data));
      if (slim.output && slim.output.metadata_json) slim.output.metadata_json = String(slim.output.metadata_json).slice(0, 200) + '…';
      return json(200, { id, status: task.status, firstFileId: fid, workingRoute: download && download.via, download, generation: slim });
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
      const d = await resolveUrl(id, a, false);
      let meta = {}; try { meta = JSON.parse(a.metadata_json || '{}'); } catch {}
      tracks.push({
        fileId,
        url: d.url,
        duration: meta.duration_ms ? meta.duration_ms / 1000 : (a.duration || a.duration_seconds || null),
        title: meta.song_name || a.title || a.name || null,
      });
    }
    if (!tracks.length) return json(200, { status: 'completed', error: 'Canción lista pero sin archivos de audio' });
    return json(200, { status: 'completed', tracks });
  } catch (e) {
    return json(502, { error: 'No se pudo contactar a Soundverse', message: String(e.message || e) });
  }
};
