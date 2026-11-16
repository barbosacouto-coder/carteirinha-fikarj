alter table public.central_midias_destinos add column solicitado_manual_em timestamptz;

create function public.central_midias_solicitar_publicacao(p_id uuid, p_versao integer, p_destino text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_destino_id uuid;
begin
  perform public.central_midias_exigir_admin();
  perform 1 from public.central_midias_itens
    where id=p_id and versao=p_versao and status in ('aprovado','parcial') for update;
  if not found then
    raise exception 'Pauta indisponível ou desatualizada.' using errcode='40001';
  end if;
  update public.central_midias_destinos d set solicitado_manual_em=clock_timestamp()
    where d.midia_id=p_id and d.destino=p_destino and d.status='pendente'
    returning d.id into v_destino_id;
  if not found then
    raise exception 'Destino indisponível.' using errcode='22023';
  end if;
  insert into public.central_midias_auditoria(midia_id,ator,acao,detalhe)
    values(p_id,auth.uid(),'solicitar_publicacao',jsonb_build_object('destino_id',v_destino_id));
  return v_destino_id;
end;
$$;
revoke all on function public.central_midias_solicitar_publicacao(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.central_midias_solicitar_publicacao(uuid,integer,text) to authenticated;

create function public.central_midias_worker_claim_target(p_destino_id uuid)
returns table(midia_id uuid,destino_id uuid,idempotency_key uuid,lease_token uuid,destino text,tema text,legenda text,formato_publicacao text,midias_urls text[],midias_mime_types text[],scheduled timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  v_item public.central_midias_itens%rowtype;
  v_destino public.central_midias_destinos%rowtype;
  v_lease uuid:=gen_random_uuid();
begin
  select i.* into v_item from public.central_midias_itens i
    join public.central_midias_destinos d on d.midia_id=i.id
    where d.id=p_destino_id and i.status in ('aprovado','parcial')
    for update of i;
  if not found then return; end if;

  update public.central_midias_destinos d
     set status='publicando', lease_token=v_lease, lease_ate=clock_timestamp()+interval '30 minutes',
         solicitado_manual_em=null
   where d.id=p_destino_id and d.status='pendente'
     and d.solicitado_manual_em >= clock_timestamp()-interval '15 minutes'
   returning d.* into v_destino;
  if not found then return; end if;

  perform public.central_midias_recalcular_estado(v_item.id);
  insert into public.central_midias_auditoria(midia_id,acao,detalhe)
    values(v_item.id,'encaminhar',jsonb_build_object('destino_id',p_destino_id,'manual',true));
  return query select v_item.id,v_destino.id,v_destino.id,v_lease,v_destino.destino,v_item.tema,
    v_item.legenda,v_item.formato_publicacao,v_item.midias_urls,v_item.midias_mime_types,clock_timestamp();
end;
$$;
revoke all on function public.central_midias_worker_claim_target(uuid) from public,anon,authenticated,service_role;
grant execute on function public.central_midias_worker_claim_target(uuid) to service_role;
