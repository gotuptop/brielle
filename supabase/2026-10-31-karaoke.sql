-- Brielle — Karaoke: tiempos de cada línea de la letra, calculados una vez por canción.
-- Pégalo en Supabase → SQL Editor → New query → Run. Es seguro correrlo más de una vez.
--
-- lyrics_timing = lista JSON de líneas: [{"t": 12.4, "line": "Contigo aprendí..."}, ...]
-- Solo lo escribe el servidor (función sync-lyrics con la clave service_role);
-- el navegador lo lee con la política de lectura que ya existe para canciones propias.

alter table public.songs add column if not exists lyrics_timing jsonb;
