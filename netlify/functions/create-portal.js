// Brielle — abre el portal de Stripe para cancelar la suscripción o cambiar la tarjeta.
const sb = require('../lib/supabase');
const stripe = require('../lib/stripe');

const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Falta STRIPE_SECRET_KEY en Netlify' });
  if (!sb.configured()) return json(500, { error: 'Faltan variables de Supabase en Netlify' });
  try {
    const user = await sb.getUser(event);
    if (!user) return json(401, { error: 'Inicia sesión' });
    const profile = await sb.getProfile(user.id);
    if (!profile || !profile.stripe_customer_id) return json(404, { error: 'NoSubscription' });
    const s = await stripe.call('POST', '/billing_portal/sessions', { customer: profile.stripe_customer_id, return_url: `${stripe.siteUrl()}/#perfil` });
    return json(200, { url: s.url });
  } catch (e) {
    return json(502, { error: 'PaymentError', message: String(e.message || e).slice(0, 200) });
  }
};
