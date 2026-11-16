grant insert on table public.segundo_cerebro_acessos to authenticated;

drop policy if exists segundo_cerebro_acessos_admin_insert on public.segundo_cerebro_acessos;
create policy segundo_cerebro_acessos_admin_insert
on public.segundo_cerebro_acessos for insert to authenticated
with check (
  (select public.is_admin())
  and usuario_id = (select auth.uid())
);

alter function public.segundo_cerebro_buscar(text, text, integer, integer) security invoker;
alter function public.segundo_cerebro_registrar_acesso(uuid) security invoker;

