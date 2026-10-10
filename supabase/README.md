# Configuración de Brielle (Supabase + Stripe)

## Supabase
1. SQL Editor → pegar `schema.sql` → Run (se puede correr varias veces).
2. Authentication → URL Configuration: Site URL `https://brielle.app`; Redirect URLs: `https://brielle.app`, `https://brielle.app/**`.

## Variables de entorno en Netlify
| Variable | Valor | Secreta |
|---|---|---|
| `SUPABASE_URL` | https://poxudjzlzagkorjfwxum.supabase.co | no |
| `SUPABASE_SERVICE_ROLE_KEY` | clave secreta de Supabase | sí |
| `SOUNDVERSE_API_KEY` | clave de Soundverse | sí |
| `STRIPE_SECRET_KEY` | `sk_test_...` (pruebas) / `sk_live_...` (real) | sí |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` del webhook | sí |
| `BRIELLE_ACCESS_CODE` | solo para `song-status?debug=1` | sí |

## Stripe
- Webhook: endpoint `https://brielle.app/.netlify/functions/stripe-webhook`
  con los eventos `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`.
- Los precios ($9.99 y $24.99 al mes) se crean solos en el Checkout; ver `netlify/lib/plans.js`.
- Activar el Customer Portal (Settings → Billing → Customer portal).
