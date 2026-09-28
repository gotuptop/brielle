// Brielle — consulta el estado de una canción en Soundverse y, si está lista,
// devuelve enlaces de audio temporales (se piden de nuevo cada vez que se reproduce).
// Uso: GET /.netlify/functions/song-status?id=JOB_ID   (agrega &debug=1 para ver la respuesta cruda)

const API = 'https://apiv2.soundverse.ai';

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const auth = () => ({ Authorization: `Bearer ${process.env.SOUNDVERSE_API_KEY}` });

// Pide a Soundverse un enlace firmado de corta duración para un archivo.
async function signedUrl(fileId) {
  const res = await fetch(`${API}/v1/files/${encodeURIComponent(fileId)}/download`, {
    headers: auth(),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) return res.headers.get('location');
  const data = await res.json().catch(() => ({}));
  return data.url || data.download_url || data.signed_url || (data.data && data.data.url) || null;
}

exports.handler = async (event) => {
  const code = event.headers['x-brielle-code'] || '';
  if (!process.env.BRIELLE_ACCESS_CODE || code !== process.env.BRIELLE_ACCESS_CODE) {
    return json(401, { error: 'Código de acceso inválido' });
  }
  if (!process.env.SOUNDVERSE_API_KEY) return json(500, { error: 'Falta SOUNDVERSE_API_KEY en Netlify' });

  const q = event.queryStringParameters || {};
  const id = String(q.id || '').trim();
  if (!id) return json(400, { error: 'Falta el id' });

  try {
    const res = await fetch(`${API}/v1/generations/${encodeURIComponent(id)}`, { headers: auth() });
    const data = await res.json().catch(() => ({}));
    if (q.debug === '1') return json(res.status, { raw: data });
    if (!res.ok) return json(res.status, { error: data.error || 'Error de Soundverse', message: data.message || '' });

    const task = data.task || data.generation || data;
    const status = String(task.status || '').toLowerCase(); // queued / processing / completed / failed

    if (status === 'failed') {
      return json(200, { status, error: task.error || task.message || (task.output && task.output.error) || 'La generación falló' });
    }
    if (status !== 'completed') return json(200, { status: status || 'processing' });

    const assets = (task.output && task.output.assets) || task.assets || [];
    const tracks = [];
    for (const a of assets) {
      const fileId = a.file_id || a.fileId;
      if (!fileId) continue;
      tracks.push({
        fileId,
        url: await signedUrl(fileId),
        duration: a.duration || a.duration_seconds || null,
        title: a.title || a.name || null,
      });
    }
    if (!tracks.length) return json(200, { status, error: 'Canción lista pero sin archivos de audio', raw: task });
    return json(200, { status, tracks });
  } catch (e) {
    return json(502, { error: 'No se pudo contactar a Soundverse', message: String(e.message || e) });
  }
};
