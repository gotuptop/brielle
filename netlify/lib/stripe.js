// Brielle — ayudantes de Stripe (sin librerías: fetch + crypto).
//   STRIPE_SECRET_KEY      -> sk_test_... (pruebas) o sk_live_... (real)
//   STRIPE_WEBHOOK_SECRET  -> whsec_... (del webhook que apunta a /.netlify/functions/stripe-webhook)
const crypto = require('crypto');
const API = 'https://api.stripe.com/v1';

function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, name, out);
    else out.push(encodeURIComponent(name) + '=' + encodeURIComponent(v));
  }
  return out;
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY || ''}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? encode(body).join('&') : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`stripe ${path}: ${res.status} ${(data.error && data.error.message) || ''}`);
  return data;
}

// Comprueba que el aviso viene de Stripe (firma HMAC) y que no es viejo.
function verify(rawBody, header, secret, tolerance = 300, now = Date.now() / 1000) {
  if (!header || !secret) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const t = (parts.find(p => p[0] === 't') || [])[1];
  const sigs = parts.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !sigs.length || Math.abs(now - Number(t)) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

const siteUrl = () => String(process.env.SITE_URL || process.env.URL || 'https://brielle.app').replace(/\/$/, '');

module.exports = { call, verify, siteUrl };
