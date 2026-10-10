// Brielle — ayudantes compartidos para hablar con Soundverse.
const API = 'https://apiv2.soundverse.ai';

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

module.exports = { API, auth, usable, findUrl, tryGet, candidates, resolveUrl, getAssets, assetFileId };
