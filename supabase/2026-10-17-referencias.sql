-- Brielle — canciones de referencia (17 oct 2026).
-- Pegar en Supabase → SQL Editor → Run. Se puede correr varias veces.
-- (También está incluido en schema.sql.)

alter table public.songs add column if not exists reference_path text;

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
