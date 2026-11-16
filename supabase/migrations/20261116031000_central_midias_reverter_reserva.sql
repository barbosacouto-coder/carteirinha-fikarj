alter table public.central_midias_destinos add column reserva_manual_id uuid;

create function public.central_midias_reservar_publicacao(p_id uuid, p_versao integer, p_destino text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_destino_id uuid;
  v_reserva_id uuid:=gen_random_uuid();
begin
  perform public.central_midias_exigir_admin();
  perform 1 from public.central_midias_itens where id=p_id for update;
  if exists(select from public.central_midias_destinos d
    where d.midia_id=p_id and d.destino=p_destino and d.status='pendente'
      and d.solicitado_manual_em >= clock_timestamp()-interval '15 minutes') then
    raise exception 'Já existe uma solicitação de envio para este destino.' using errcode='55000';
  end if;
  v_destino_id:=public.central_midias_solicitar_publicacao(p_id,p_versao,p_destino);
  update public.central_midias_destinos set reserva_manual_id=v_reserva_id where id=v_destino_id;
  return jsonb_build_object('destino_id',v_destino_id,'reserva_id',v_reserva_id);
end;
$$;
revoke all on function public.central_midias_reservar_publicacao(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.central_midias_reservar_publicacao(uuid,integer,text) to authenticated;

create function public.central_midias_reverter_reserva(p_destino_id uuid,p_reserva_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_midia_id uuid;
begin
  perform public.central_midias_exigir_admin();
  select i.id into v_midia_id from public.central_midias_itens i
    join public.central_midias_destinos d on d.midia_id=i.id
    where d.id=p_destino_id for update of i;
  if not found then return false; end if;
  update public.central_midias_destinos d set solicitado_manual_em=null,reserva_manual_id=null
    where d.id=p_destino_id and d.reserva_manual_id=p_reserva_id
      and d.status='pendente' and d.solicitado_manual_em is not null;
  if not found then return false; end if;
  insert into public.central_midias_auditoria(midia_id,ator,acao,detalhe)
    values(v_midia_id,auth.uid(),'reverter_reserva',jsonb_build_object('destino_id',p_destino_id));
  return true;
end;
$$;
revoke all on function public.central_midias_reverter_reserva(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.central_midias_reverter_reserva(uuid,uuid) to authenticated;
revoke execute on function public.central_midias_solicitar_publicacao(uuid,integer,text) from authenticated;
