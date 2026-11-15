-- Arquivos destinados à publicação externa, acessíveis somente por URL direta.
-- Rascunhos locais não pertencem a este bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('central-midias-publicacao', 'central-midias-publicacao', true, 52428800, array['image/jpeg', 'video/mp4']);

-- A leitura por URL usa o endpoint público de Storage. Não conceder SELECT
-- em storage.objects para este bucket, pois SELECT também autoriza listagem.
create policy central_midias_publicacao_enviar
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'central-midias-publicacao'
  and (select auth.uid()) is not null
  and (select public.is_admin())
  and name ~ (
    '^' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|mp4)$'
  )
);
