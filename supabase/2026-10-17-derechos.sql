-- Brielle — constancia de derechos sobre audios de referencia (17 oct 2026).
-- Pegar en Supabase → SQL Editor → Run. Se puede correr varias veces.
-- (También está incluido en schema.sql.)

-- Bloqueo manual de referencias para una cuenta (política de infractores reincidentes).
-- Para bloquear:  update public.profiles set references_blocked = true where email = 'correo@ejemplo.com';
alter table public.profiles add column if not exists references_blocked boolean not null default false;

-- Cada vez que alguien usa un audio de referencia queda un registro de que aceptó la declaración de derechos.
-- Sin claves foráneas a propósito: el registro se conserva aunque se borre la canción o la cuenta.
create table if not exists public.rights_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  user_email text,
  song_id uuid,
  reference_path text not null,
  file_name text,
  file_size bigint,
  terms_version text not null,
  statement_lang text,
  statement text not null,
  ip text,
  user_agent text,
  accepted_at timestamptz not null default now()
);
create index if not exists rights_acceptances_user_idx on public.rights_acceptances (user_id, accepted_at desc);

-- Solo el servidor la lee y escribe. Nadie puede editarla ni borrarla desde el navegador.
alter table public.rights_acceptances enable row level security;
revoke all on public.rights_acceptances from anon, authenticated;
grant all on public.rights_acceptances to service_role;
