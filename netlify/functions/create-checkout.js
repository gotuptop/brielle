// Brielle — abre el pago de una suscripción (Stripe Checkout).
const sb = require('../lib/supabase');
const stripe = require('../lib/stripe');
const { PLANS } = require('../lib/plans');

const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Falta STRIPE_SECRET_KEY en Netlify' });
  if (!sb.configured()) return json(500, { error: 'Faltan variables de Supabase en Netlify' });
  try {
    const user = await sb.getUser(event);
    if (!user) return json(401, { error: 'Inicia sesión' });

    let input; try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON inválido' }); }
    const plan = PLANS[input.plan] ? input.plan : null;
    if (!plan) return json(400, { error: 'Plan inválido' });

    const profile = await sb.getProfile(user.id);
    if (!profile) return json(404, { error: 'Perfil no encontrado' });
    if (profile.plan && profile.plan !== 'demo') return json(409, { error: 'AlreadySubscribed' });

    let customer = profile.stripe_customer_id;
    if (!customer) {
      const c = await stripe.call('POST', '/customers', { email: user.email, metadata: { user_id: user.id } });
      customer = c.id;
      await sb.patchProfile(user.id, { stripe_customer_id: customer });
    }

    const p = PLANS[plan], site = stripe.siteUrl();
    const session = await stripe.call('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      allow_promotion_codes: 'true',
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: p.amount, recurring: { interval: 'month' },
        product_data: { name: `Brielle ${p.name}`, description: `${p.credits} songs / canciones por mes` },
      } }],
      subscription_data: { metadata: { user_id: user.id, plan } },
      metadata: { user_id: user.id, plan },
      success_url: `${site}/?checkout=success#perfil`,
      cancel_url: `${site}/?checkout=cancel#planes`,
    });
    return json(200, { url: session.url });
  } catch (e) {
    return json(502, { error: 'PaymentError', message: String(e.message || e).slice(0, 200) });
  }
};
