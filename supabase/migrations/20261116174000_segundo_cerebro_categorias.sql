create or replace function public.segundo_cerebro_categorias()
returns table (categoria text)
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
    select distinct d.categoria
      from public.segundo_cerebro_documentos d
     where d.ativo
     order by d.categoria;
end;
$$;

revoke all on function public.segundo_cerebro_categorias() from public, anon, authenticated;
grant execute on function public.segundo_cerebro_categorias() to authenticated;

