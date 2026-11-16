alter table public.segundo_cerebro_documentos
  alter column storage_path drop not null,
  alter column tamanho_bytes drop not null,
  alter column sha256 drop not null;

alter table public.segundo_cerebro_documentos
  add column if not exists caminho_relativo text,
  add column if not exists arquivo_disponivel boolean generated always as (storage_path is not null) stored;

alter table public.segundo_cerebro_documentos
  drop constraint if exists segundo_cerebro_documentos_caminho_relativo_check;
alter table public.segundo_cerebro_documentos
  add constraint segundo_cerebro_documentos_caminho_relativo_check
  check (
    caminho_relativo is null
    or (
      caminho_relativo !~ '(^|[\\/])(\.\.|\.)($|[\\/])'
      and caminho_relativo !~ '^[A-Za-z]:'
      and caminho_relativo !~ '^[/\\]'
    )
  );

create unique index if not exists segundo_cerebro_documentos_caminho_relativo_uidx
on public.segundo_cerebro_documentos (caminho_relativo)
where caminho_relativo is not null;

drop function if exists public.segundo_cerebro_buscar(text, text, integer, integer);
create function public.segundo_cerebro_buscar(
  p_busca text default '',
  p_categoria text default '',
  p_limite integer default 60,
  p_offset integer default 0
)
returns table (
  id uuid,
  titulo text,
  categoria text,
  resumo text,
  data_documento date,
  tipo text,
  nome_original text,
  storage_path text,
  tamanho_bytes bigint,
  sha256 text,
  arquivo_disponivel boolean,
  criado_em timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query
    select d.id, d.titulo, d.categoria, d.resumo, d.data_documento, d.tipo,
           d.nome_original, d.storage_path, d.tamanho_bytes, d.sha256,
           d.arquivo_disponivel, d.criado_em
      from public.segundo_cerebro_documentos d
     where d.ativo
       and (btrim(coalesce(p_categoria, '')) = '' or lower(d.categoria) = lower(btrim(p_categoria)))
       and (
         btrim(coalesce(p_busca, '')) = ''
         or lower(d.titulo) like '%' || lower(btrim(p_busca)) || '%'
         or lower(coalesce(d.resumo, '')) like '%' || lower(btrim(p_busca)) || '%'
         or lower(d.categoria) like '%' || lower(btrim(p_busca)) || '%'
         or lower(d.tipo) like '%' || lower(btrim(p_busca)) || '%'
       )
     order by d.data_documento desc nulls last, d.titulo
     limit least(greatest(coalesce(p_limite, 60), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.segundo_cerebro_buscar(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.segundo_cerebro_buscar(text, text, integer, integer) to authenticated;

