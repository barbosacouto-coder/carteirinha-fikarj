create table public.central_midias_itens (
  id uuid primary key default gen_random_uuid(),
  versao integer not null default 1,
  tema text not null,
  legenda text not null,
  formato_publicacao text not null check (formato_publicacao in ('instagram_carousel','reel')),
  midias_urls text[] not null,
  midias_mime_types text[] not null,
  agendado_para timestamptz,
  status text not null default 'rascunho' check (status in ('rascunho','planejado','aprovado','agendado','publicando','parcial','publicado','falhou','cancelado')),
  criado_por uuid not null,
  criado_em timestamptz not null default now()
);
create table public.central_midias_destinos (
  id uuid primary key default gen_random_uuid(),
  midia_id uuid not null references public.central_midias_itens(id),
  destino text not null check (destino in ('instagram_carousel','instagram_reel','facebook_reel')),
  status text not null default 'pendente' check (status in ('pendente','agendado','publicando','publicado','falhou','resultado_incerto','cancelado')),
  id_externo text,
  erro text,
  lease_token uuid,
  lease_ate timestamptz,
  unique (midia_id,destino)
);
create table public.central_midias_auditoria (
  id bigint generated always as identity primary key,
  midia_id uuid not null references public.central_midias_itens(id),
  ator uuid,
  acao text not null,
  detalhe jsonb not null default '{}',
  ocorrido_em timestamptz not null default clock_timestamp()
);
alter table public.central_midias_itens enable row level security;
alter table public.central_midias_destinos enable row level security;
alter table public.central_midias_auditoria enable row level security;
revoke all on public.central_midias_itens,public.central_midias_destinos,public.central_midias_auditoria from public,anon,authenticated,service_role;

create function public.central_midias_exigir_admin()
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_admin(),false) then
    raise exception 'Acesso restrito à administração.' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.central_midias_exigir_admin() from public,anon,authenticated,service_role;

create function public.central_midias_listar()
returns jsonb language plpgsql security definer stable set search_path='' as $$
begin
  perform public.central_midias_exigir_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(i) || jsonb_build_object('destinos',coalesce((
      select jsonb_agg(jsonb_build_object('destino',d.destino,'status',d.status,'id_externo',d.id_externo,'erro',d.erro) order by d.destino)
      from public.central_midias_destinos d where d.midia_id=i.id
    ),'[]'::jsonb)) order by i.agendado_para nulls last,i.criado_em desc)
    from public.central_midias_itens i
  ),'[]'::jsonb);
end;
$$;

create function public.central_midias_salvar(
  p_id uuid,p_versao integer,p_tema text,p_legenda text,
  p_midias_urls text[],p_destinos text[],p_agendado_para timestamptz,
  p_formato_publicacao text,p_midias_mime_types text[]
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_status text := case when p_agendado_para is null then 'rascunho' else 'planejado' end;
begin
  perform public.central_midias_exigir_admin();
  if not coalesce(char_length(btrim(p_tema)) between 1 and 200,false)
     or coalesce(char_length(p_legenda),0)>2200
     or p_formato_publicacao is null or p_formato_publicacao not in ('instagram_carousel','reel')
     or p_midias_urls is null or p_midias_mime_types is null or p_destinos is null
     or cardinality(p_midias_urls)>10 or cardinality(p_midias_urls)<>cardinality(p_midias_mime_types)
     or cardinality(p_destinos)>2
     or exists(select from unnest(p_midias_urls) u where u is null or char_length(u)>2048 or u !~ '^https://[a-zA-Z0-9.-]+(/[^?#[:space:]]*)?$')
     or exists(select from unnest(p_midias_mime_types) m where m is null or m not in ('image/jpeg','video/mp4'))
     or exists(select from unnest(p_destinos) d where d is null or (p_formato_publicacao='instagram_carousel' and d<>'instagram_carousel') or (p_formato_publicacao='reel' and d not in ('instagram_reel','facebook_reel'))) then
    raise exception 'Revise título, formato, destinos e URLs públicas.' using errcode='22023';
  end if;
  if p_id is null then
    insert into public.central_midias_itens(tema,legenda,formato_publicacao,midias_urls,midias_mime_types,agendado_para,status,criado_por)
    values (btrim(p_tema),coalesce(btrim(p_legenda),''),p_formato_publicacao,p_midias_urls,p_midias_mime_types,p_agendado_para,v_status,auth.uid())
    returning id into v_id;
  else
    update public.central_midias_itens set tema=btrim(p_tema),legenda=coalesce(btrim(p_legenda),''),
      formato_publicacao=p_formato_publicacao,midias_urls=p_midias_urls,midias_mime_types=p_midias_mime_types,
      agendado_para=p_agendado_para,status=v_status,versao=versao+1
      where id=p_id and versao=p_versao and status in ('rascunho','planejado') returning id into v_id;
    if not found then raise exception 'Rascunho atualizado em outra sessão ou já aprovado.' using errcode='40001'; end if;
    delete from public.central_midias_destinos where midia_id=v_id;
  end if;
  insert into public.central_midias_destinos(midia_id,destino)
    select v_id,d from (select distinct unnest(p_destinos) as d) lista;
  insert into public.central_midias_auditoria(midia_id,ator,acao,detalhe)
    values(v_id,auth.uid(),'salvar',jsonb_build_object('status',v_status));
  return v_id;
end;
$$;

create function public.central_midias_transicionar(p_id uuid,p_versao integer,p_acao text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_item public.central_midias_itens%rowtype;
  v_novo text;
begin
  perform public.central_midias_exigir_admin();
  select * into v_item from public.central_midias_itens where id=p_id and versao=p_versao for update;
  if not found then raise exception 'Item desatualizado. Atualize o calendário.' using errcode='40001'; end if;
  if p_acao='cancelar' and v_item.status in ('rascunho','planejado','aprovado','agendado') then
    v_novo:='cancelado';
    update public.central_midias_destinos set status='cancelado' where midia_id=p_id;
  elsif (p_acao='aprovar' and v_item.status='planejado') or (p_acao='agendar' and v_item.status='aprovado') then
    if v_item.agendado_para is null or v_item.agendado_para<=clock_timestamp() or v_item.legenda='' or v_item.legenda ~ '\[[^]]+\]'
       or not exists(select from public.central_midias_destinos where midia_id=p_id)
       or (v_item.formato_publicacao='instagram_carousel' and cardinality(v_item.midias_urls)<2)
       or (v_item.formato_publicacao='reel' and v_item.midias_mime_types<>array['video/mp4']) then
      raise exception 'Informe mídia, destinos, legenda final e data futura.' using errcode='22023';
    end if;
    v_novo:=case when p_acao='aprovar' then 'aprovado' else 'agendado' end;
    if v_novo='agendado' then
      update public.central_midias_destinos set status='agendado' where midia_id=p_id;
    end if;
  else
    raise exception 'Ação indisponível no estado atual.' using errcode='22023';
  end if;
  update public.central_midias_itens set status=v_novo,versao=versao+1 where id=p_id;
  insert into public.central_midias_auditoria(midia_id,ator,acao,detalhe)
    values(p_id,auth.uid(),p_acao,jsonb_build_object('status',v_novo));
end;
$$;
revoke all on function public.central_midias_transicionar(uuid,integer,text) from public,anon,authenticated,service_role;

create function public.central_midias_aprovar(p_id uuid,p_versao integer)
returns void language sql security definer set search_path='' as $$
  select public.central_midias_transicionar(p_id,p_versao,'aprovar');
$$;
create function public.central_midias_agendar(p_id uuid,p_versao integer)
returns void language sql security definer set search_path='' as $$
  select public.central_midias_transicionar(p_id,p_versao,'agendar');
$$;
create function public.central_midias_cancelar(p_id uuid,p_versao integer)
returns void language sql security definer set search_path='' as $$
  select public.central_midias_transicionar(p_id,p_versao,'cancelar');
$$;

create function public.central_midias_recalcular_estado(p_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.central_midias_itens i
  set status=(
    select case
      when bool_or(d.status='publicando') then 'publicando'
      when bool_or(d.status='agendado') then 'agendado'
      when bool_and(d.status='publicado') then 'publicado'
      when bool_or(d.status='publicado') then 'parcial'
      else 'falhou'
    end
    from public.central_midias_destinos d where d.midia_id=i.id
  ), versao=versao+1
  where i.id=p_id;
$$;
revoke all on function public.central_midias_recalcular_estado(uuid) from public,anon,authenticated,service_role;

create function public.central_midias_worker_claim(p_limite integer default 1)
returns table(midia_id uuid,destino_id uuid,idempotency_key uuid,lease_token uuid,destino text,tema text,legenda text,formato_publicacao text,midias_urls text[],midias_mime_types text[],scheduled timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  v_lease uuid;
  v_id uuid;
  v_item record;
begin
  for v_item in
    select i.id from public.central_midias_itens i
    where i.status='publicando' and exists (
      select from public.central_midias_destinos d
      where d.midia_id=i.id and d.status='publicando' and d.lease_ate<clock_timestamp()
    )
    for update skip locked
  loop
    with expirados as (
      update public.central_midias_destinos d
      set status='resultado_incerto',erro='Prazo da execução expirou. Confira o destino antes de publicar novamente.',
          lease_token=null,lease_ate=null
      where d.midia_id=v_item.id and d.status='publicando' and d.lease_ate<clock_timestamp()
      returning d.id
    )
    insert into public.central_midias_auditoria(midia_id,acao,detalhe)
      select v_item.id,'resultado_incerto',jsonb_build_object('destino_id',e.id) from expirados e;
    perform public.central_midias_recalcular_estado(v_item.id);
  end loop;
  for v_item in
    select i.* from public.central_midias_itens i
    where i.status in ('agendado','publicando') and i.agendado_para<=clock_timestamp()
      and exists(select from public.central_midias_destinos d where d.midia_id=i.id and d.status='agendado')
    order by i.agendado_para,i.id
    limit greatest(1,least(coalesce(p_limite,1),10))
    for update skip locked
  loop
    select d.id into v_id
      from public.central_midias_destinos d
      where d.midia_id=v_item.id and d.status='agendado'
      order by d.destino limit 1;
    v_lease:=gen_random_uuid();
    update public.central_midias_destinos d
      set status='publicando',lease_token=v_lease,lease_ate=clock_timestamp()+interval '30 minutes'
      where d.id=v_id;
    perform public.central_midias_recalcular_estado(v_item.id);
    insert into public.central_midias_auditoria(midia_id,acao,detalhe)
      values(v_item.id,'encaminhar',jsonb_build_object('destino_id',v_id));
    return query select v_item.id,d.id,d.id,v_lease,d.destino,v_item.tema,v_item.legenda,
      v_item.formato_publicacao,v_item.midias_urls,v_item.midias_mime_types,v_item.agendado_para
      from public.central_midias_destinos d where d.id=v_id;
  end loop;
end;
$$;

create function public.central_midias_worker_finalizar(p_destino_id uuid,p_lease_token uuid,p_resultado text,p_id_externo text,p_erro text)
returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if p_resultado is null or p_resultado not in ('publicado','falhou','resultado_incerto')
     or (p_resultado='publicado' and nullif(btrim(p_id_externo),'') is null) then
    raise exception 'Resultado editorial inválido.' using errcode='22023';
  end if;
  select i.id into v_id from public.central_midias_itens i
    join public.central_midias_destinos d on d.midia_id=i.id where d.id=p_destino_id for update of i;
  if not found then raise exception 'Destino inexistente.' using errcode='P0002'; end if;
  update public.central_midias_destinos d
    set status=p_resultado,id_externo=left(p_id_externo,300),erro=left(p_erro,500),lease_token=null,lease_ate=null
    where d.id=p_destino_id and d.status='publicando' and d.lease_token=p_lease_token and d.lease_ate>=clock_timestamp();
  if not found then raise exception 'Execução expirada ou já finalizada.' using errcode='40001'; end if;
  perform public.central_midias_recalcular_estado(v_id);
  insert into public.central_midias_auditoria(midia_id,acao,detalhe)
    values(v_id,'finalizar',jsonb_build_object('destino_id',p_destino_id,'resultado',p_resultado));
end;
$$;

revoke all on function public.central_midias_listar(), public.central_midias_salvar(uuid,integer,text,text,text[],text[],timestamptz,text,text[]),
  public.central_midias_aprovar(uuid,integer), public.central_midias_agendar(uuid,integer), public.central_midias_cancelar(uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.central_midias_listar(), public.central_midias_salvar(uuid,integer,text,text,text[],text[],timestamptz,text,text[]),
  public.central_midias_aprovar(uuid,integer), public.central_midias_agendar(uuid,integer), public.central_midias_cancelar(uuid,integer)
  to authenticated;
revoke all on function public.central_midias_worker_claim(integer), public.central_midias_worker_finalizar(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.central_midias_worker_claim(integer), public.central_midias_worker_finalizar(uuid,uuid,text,text,text) to service_role;
