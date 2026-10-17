// Brielle — ayudantes para hablar con Supabase desde las funciones de Netlify.
// Usa la clave SECRETA (service_role / sb_secret_...). Nunca se envía al navegador.
//   SUPABASE_URL                 -> https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    -> clave secreta del proyecto

const base = () => String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Las claves nuevas (sb_secret_...) van solo en "apikey"; las antiguas (JWT eyJ...) también como Bearer.
const h = (extra = {}) => {
  const k = key();
  const o = { apikey: k, ...extra };
  if (k.startsWith('eyJ')) o.Authorization = `Bearer ${k}`;
  return o;
};

const configured = () => !!(base() && key());

// Verifica el token de sesión que manda el navegador y devuelve {id,email} (o null).
async function getUser(event) {
  const raw = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const res = await fetch(`${base()}/auth/v1/user`, { headers: { apikey: key(), Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? { id: u.id, email: u.email || '' } : null;
}

async function rpc(name, args) {
  const res = await fetch(`${base()}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function insertSong(row) {
  const res = await fetch(`${base()}/rest/v1/songs`, {
    method: 'POST', headers: h({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json())[0];
}

async function getSong(id, userId) {
  const res = await fetch(`${base()}/rest/v1/songs?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=*`, { headers: h() });
  if (!res.ok) return null;
  return (await res.json())[0] || null;
}

// Cambia la canción SOLO si sigue en cola/procesando. Devuelve true si este llamado ganó el cambio
// (así los créditos y los archivos nunca se procesan dos veces).
async function settleSong(id, patch) {
  const res = await fetch(`${base()}/rest/v1/songs?id=eq.${encodeURIComponent(id)}&status=in.(queued,processing)`, {
    method: 'PATCH', headers: h({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).length > 0;
}

async function patchSong(id, patch) {
  const res = await fetch(`${base()}/rest/v1/songs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update song: ${res.status}`);
}

async function uploadAudio(path, buffer, contentType) {
  const res = await fetch(`${base()}/storage/v1/object/songs/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: h({ 'Content-Type': contentType, 'x-upsert': 'true' }), body: buffer,
  });
  if (!res.ok) throw new Error(`storage: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// Enlace temporal (firmado) a un archivo de un bucket privado, para que Soundverse pueda leerlo.
async function signedUrl(bucket, path, seconds) {
  const p = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${base()}/storage/v1/object/sign/${bucket}/${p}`, {
    method: 'POST', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds || 3600 }),
  });
  if (!res.ok) return null;
  const d = await res.json().catch(() => ({}));
  const rel = d.signedURL || d.signedUrl || '';
  return rel ? `${base()}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}` : null;
}

// Tamaño en bytes de un archivo del bucket (null si no existe).
async function objectSize(bucket, path) {
  const p = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${base()}/storage/v1/object/info/${bucket}/${p}`, { headers: h() });
  if (!res.ok) return null;
  const d = await res.json().catch(() => ({}));
  const n = Number(d.size != null ? d.size : (d.metadata && d.metadata.size));
  return Number.isFinite(n) ? n : 0;
}

async function deleteObject(bucket, path) {
  const p = path.split('/').map(encodeURIComponent).join('/');
  await fetch(`${base()}/storage/v1/object/${bucket}/${p}`, { method: 'DELETE', headers: h() }).catch(() => {});
}

// Guarda la constancia de que el usuario aceptó la declaración de derechos de un audio de referencia.
async function insertRightsAcceptance(row) {
  const res = await fetch(`${base()}/rest/v1/rights_acceptances`, {
    method: 'POST', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`rights record: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function getProfile(id) {
  const res = await fetch(`${base()}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`, { headers: h() });
  if (!res.ok) return null;
  return (await res.json())[0] || null;
}
async function profileByCustomer(customerId) {
  const res = await fetch(`${base()}/rest/v1/profiles?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=*`, { headers: h() });
  if (!res.ok) return null;
  return (await res.json())[0] || null;
}
async function patchProfile(id, patch) {
  const res = await fetch(`${base()}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update profile: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
// Registra un evento de Stripe para no procesarlo dos veces. true = nuevo, false = ya visto.
async function recordEvent(id) {
  const res = await fetch(`${base()}/rest/v1/stripe_events`, {
    method: 'POST', headers: h({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id }),
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error(`record event: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return true;
}
async function forgetEvent(id) {
  await fetch(`${base()}/rest/v1/stripe_events?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: h() });
}

module.exports = { insertRightsAcceptance, getProfile, profileByCustomer, patchProfile, recordEvent, forgetEvent, configured, getUser, rpc, insertSong, getSong, settleSong, patchSong, uploadAudio, signedUrl, objectSize, deleteObject };
