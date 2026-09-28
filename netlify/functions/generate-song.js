// Brielle — crea una canción en Soundverse (API v7, ruta compat).
// Variables de entorno en Netlify:
//   SOUNDVERSE_API_KEY   -> la llave sksoundverse_...
//   BRIELLE_ACCESS_CODE  -> código de acceso de la fase de pruebas

const API = 'https://apiv2.soundverse.ai';

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });

  // Protección: sin cuentas todavía, solo quien tenga el código puede generar (cada canción cuesta dinero).
  const code = event.headers['x-brielle-code'] || '';
  if (!process.env.BRIELLE_ACCESS_CODE || code !== process.env.BRIELLE_ACCESS_CODE) {
    return json(401, { error: 'Código de acceso inválido' });
  }
  if (!process.env.SOUNDVERSE_API_KEY) return json(500, { error: 'Falta SOUNDVERSE_API_KEY en Netlify' });

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON inválido' }); }

  const prompt = String(input.prompt || '').trim().slice(0, 1024);
  const lyrics = String(input.lyrics || '').trim().slice(0, 3000);
  const gender = ['male', 'female'].includes(input.gender) ? input.gender : '';
  const requestId = String(input.requestId || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 200);

  if (!prompt) return json(400, { error: 'Falta la descripción del estilo' });

  const body = { prompt, lyrics, parameters: { versions: 1 } }; // 1 versión = 1 canción cobrada
  if (gender) body.gender = gender;

  const headers = {
    Authorization: `Bearer ${process.env.SOUNDVERSE_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (requestId) headers['Idempotency-Key'] = `brielle-${requestId}`; // evita cobros dobles en reintentos

  try {
    const res = await fetch(`${API}/v7/generate/song`, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(res.status, {
        error: data.error || 'Error de Soundverse',
        message: data.message || '',
        retryable: !!data.retryable,
      });
    }
    const jobId = data.job_id || data.task_id || data.id;
    if (!jobId) return json(502, { error: 'Soundverse no devolvió un id de trabajo', raw: data });
    return json(200, { jobId, status: data.status || 'queued' });
  } catch (e) {
    return json(502, { error: 'No se pudo contactar a Soundverse', message: String(e.message || e) });
  }
};
