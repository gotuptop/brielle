-- Brielle: esquema inicial de la base de datos
-- Pégalo completo en Supabase → SQL Editor → New query → Run.
-- Es seguro correrlo más de una vez.
--
-- Diseño:
--  * Los créditos y las canciones SOLO los escribe el servidor (funciones de Netlify
--    con la clave service_role). El navegador puede leer lo suyo y editar unos pocos
--    campos de sus propias canciones (título, favorita, pública), nada más.
--  * Como desmarcaste "Automatically expose new tables", aquí se otorgan los permisos
--    de forma explícita, tabla por tabla.

-- ───────────── Perfiles (uno por usuario, con plan y créditos) ─────────────
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text,
  plan                   text not null default 'demo' check (plan in ('demo','estudio','productor')),
  display_name           text,
  credits                integer not null default 2 check (credits >= 0),  -- 1 crédito = 1 creación (2 versiones)
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now()
);

-- ───────────── Canciones ─────────────
create table if not exists public.songs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  title              text not null,
  genre              text,
  style              text,
  prompt             text,
  lyrics             text,
  voice              text,
  mood               text,
  tempo              integer,
  duration           real,      -- segundos
  instrumental       boolean not null default false,
  version            integer not null default 1,
  status             text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  soundverse_task_id text,
  audio_path         text,      -- ruta dentro del bucket privado "songs"
  cover_path         text,
  liked              boolean not null default false,
  is_public          boolean not null default false,
  created_at         timestamptz not null default now()
);

-- Por si ya corriste la versión anterior del script:
alter table public.profiles add column if not exists display_name text;
alter table public.songs add column if not exists voice text;
alter table public.songs add column if not exists mood text;
alter table public.songs add column if not exists tempo integer;
alter table public.songs add column if not exists duration real;
alter table public.songs add column if not exists reference_path text; -- ruta en el bucket privado "references"

create index if not exists songs_user_created_idx on public.songs (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.songs    enable row level security;

-- ───────────── Políticas (quién ve qué) ─────────────
drop policy if exists "perfil propio: lectura" on public.profiles;
create policy "perfil propio: lectura" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "perfil propio: edición" on public.profiles;
create policy "perfil propio: edición" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "canciones propias: lectura" on public.songs;
create policy "canciones propias: lectura" on public.songs
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "canciones públicas: lectura" on public.songs;
create policy "canciones públicas: lectura" on public.songs
  for select to anon, authenticated using (is_public);

drop policy if exists "canciones propias: edición" on public.songs;
create policy "canciones propias: edición" on public.songs
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "canciones propias: borrado" on public.songs;
create policy "canciones propias: borrado" on public.songs
  for delete to authenticated using (user_id = (select auth.uid()));

-- ───────────── Permisos explícitos ─────────────
revoke all on public.profiles from anon, authenticated;
revoke all on public.songs    from anon, authenticated;

-- Solo estas columnas son visibles desde el navegador (los datos de Stripe quedan solo en el servidor).
grant select (id, email, plan, display_name, credits, current_period_end, created_at) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;  -- créditos y plan NO se pueden editar desde el navegador
grant select on public.songs    to anon, authenticated;
grant update (title, liked, is_public) on public.songs to authenticated;  -- solo estos campos
grant delete on public.songs to authenticated;

grant all on public.profiles to service_role;
grant all on public.songs    to service_role;

-- ───────────── Eventos de Stripe ya procesados (evita activar dos veces el mismo pago) ─────────────
create table if not exists public.stripe_events (
  id         text primary key,
  created_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
grant all on public.stripe_events to service_role;

-- ───────────── Perfil automático al registrarse ─────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── Descontar / devolver créditos (solo el servidor puede llamarlas) ─────────────
-- consume_credit devuelve los créditos restantes, o -1 si no tenía saldo.
create or replace function public.consume_credit(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  restantes integer;
begin
  update public.profiles
     set credits = credits - 1
   where id = p_user and credits > 0
  returning credits into restantes;

  return coalesce(restantes, -1);
end;
$$;

create or replace function public.refund_credit(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  restantes integer;
begin
  update public.profiles set credits = credits + 1 where id = p_user
  returning credits into restantes;
  return restantes;
end;
$$;

revoke execute on function public.consume_credit(uuid) from public, anon, authenticated;
revoke execute on function public.refund_credit(uuid)  from public, anon, authenticated;
grant  execute on function public.consume_credit(uuid) to service_role;
grant  execute on function public.refund_credit(uuid)  to service_role;

-- ───────────── Almacenamiento privado de audio ─────────────
-- Estructura: songs/<user_id>/<song_id>.mp3  (el servidor sube; el usuario solo lee lo suyo)
insert into storage.buckets (id, name, public)
values ('songs', 'songs', false)
on conflict (id) do nothing;

drop policy if exists "audio propio: lectura" on storage.objects;
create policy "audio propio: lectura" on storage.objects
  for select to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "audio propio: borrado" on storage.objects;
create policy "audio propio: borrado" on storage.objects
  for delete to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ───────────── Canciones de referencia (el usuario sube, el servidor las usa y las borra) ─────────────
-- Estructura: references/<user_id>/<archivo>.mp3 | .m4a   (máx. 15 MB, solo audio)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('references', 'references', false, 15728640, array['audio/mpeg','audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/mp3'])
on conflict (id) do update set public = false, file_size_limit = 15728640,
  allowed_mime_types = array['audio/mpeg','audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/mp3'];

drop policy if exists "referencia propia: subida" on storage.objects;
create policy "referencia propia: subida" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "referencia propia: lectura" on storage.objects;
create policy "referencia propia: lectura" on storage.objects
  for select to authenticated
  using (bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "referencia propia: borrado" on storage.objects;
create policy "referencia propia: borrado" on storage.objects
  for delete to authenticated
  using (bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ───────────── Constancia de derechos sobre audios de referencia ─────────────
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
