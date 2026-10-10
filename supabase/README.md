# Configuración de Supabase para Brielle

1. SQL Editor → pegar `schema.sql` → Run (se puede correr varias veces).
2. Netlify → Site configuration → Environment variables:
   - `SUPABASE_URL` = https://poxudjzlzagkorjfwxum.supabase.co
   - `SUPABASE_SERVICE_ROLE_KEY` = clave **secreta** (Supabase → Project Settings → API Keys). Nunca en el navegador.
   - `SOUNDVERSE_API_KEY` (ya existe)
   - `BRIELLE_ACCESS_CODE` (opcional; solo para el modo diagnóstico de `song-status?debug=1`)
3. Supabase → Authentication → URL Configuration: Site URL `https://briellemusic.netlify.app`
   y en Redirect URLs agregar ese mismo dominio (y luego `https://brielle.app`).
