// Brielle — recibe los avisos de Stripe y activa/renueva/cancela los planes.
//  * invoice.paid (alta y cada renovación)  -> plan activo + créditos del mes
//  * customer.subscription.updated/deleted  -> fecha de renovación / vuelve a Demo con 0 canciones
// Cada evento se procesa una sola vez (tabla stripe_events).
const sb = require('../lib/supabase');
const stripe = require('../lib/stripe');
const { PLANS } = require('../lib/plans');

const ok = (body = 'ok') => ({ statusCode: 200, body });
const iso = t => (t ? new Date(t * 1000).toISOString() : null);

async function handle(ev) {
  const obj = ev.data.object;

  if (ev.type === 'invoice.paid') {
    if (!['subscription_create', 'subscription_cycle'].includes(obj.billing_reason)) return;
    const subId = obj.subscription || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
    if (!subId) return;
    const sub = await stripe.call('GET', `/subscriptions/${subId}`);
    const plan = sub.metadata && sub.metadata.plan, userId = sub.metadata && sub.metadata.user_id;
    if (!PLANS[plan] || !userId) return;
    const end = sub.current_period_end || (sub.items && sub.items.data[0] && sub.items.data[0].current_period_end);
    await sb.patchProfile(userId, {
      plan, credits: PLANS[plan].credits,
      stripe_customer_id: obj.customer, stripe_subscription_id: subId, current_period_end: iso(end),
    });
    return;
  }

  if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const userId = obj.metadata && obj.metadata.user_id;
    const profile = (userId && await sb.getProfile(userId)) || await sb.profileByCustomer(obj.customer);
    if (!profile) return;
    // Ignorar suscripciones viejas que no son la actual del usuario.
    if (profile.stripe_subscription_id && profile.stripe_subscription_id !== obj.id) return;
    const dead = ev.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status);
    if (dead) {
      const patch = { plan: 'demo', stripe_subscription_id: null, current_period_end: null };
      // Si era la suscripción pagada del usuario, sus canciones del plan se acaban con ella
      // (las 2 de Demo son de una sola vez). Un pago que nunca se completó no toca los créditos.
      if (profile.stripe_subscription_id === obj.id) patch.credits = 0;
      await sb.patchProfile(profile.id, patch);
    }
    else await sb.patchProfile(profile.id, { current_period_end: iso(obj.current_period_end || (obj.items && obj.items.data[0] && obj.items.data[0].current_period_end)) });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Método no permitido' };
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!stripe.verify(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)) return { statusCode: 400, body: 'Firma inválida' };
  if (!sb.configured()) return { statusCode: 500, body: 'Faltan variables de Supabase' };

  let ev; try { ev = JSON.parse(raw); } catch { return { statusCode: 400, body: 'JSON inválido' }; }
  try {
    if (!(await sb.recordEvent(ev.id))) return ok('duplicado');
    try { await handle(ev); }
    catch (e) { await sb.forgetEvent(ev.id); throw e; } // para que Stripe reintente
    return ok();
  } catch (e) {
    return { statusCode: 500, body: String(e.message || e).slice(0, 200) };
  }
};
