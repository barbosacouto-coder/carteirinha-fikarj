begin;
alter table fikarj_protocolos.secretaria_itens add column if not exists final_sha256 text check(final_sha256 ~ '^[0-9a-f]{64}$');
alter table fikarj_protocolos.secretaria_itens add column if not exists final_registrado_em timestamptz;
alter table fikarj_protocolos.secretaria_itens add column if not exists final_registrado_por uuid references auth.users(id);
alter table fikarj_protocolos.secretaria_itens add column if not exists assinatura_referencia text;

create or replace function public.registrar_emissao_lote_fikarj(
  p_item uuid,p_sha256 text,p_confirmacao boolean,p_assinatura_referencia text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  item fikarj_protocolos.secretaria_itens%rowtype;
  lote fikarj_protocolos.secretaria_lotes%rowtype;
  documento record;
  caminho text;
begin
  if auth.uid() is null or not coalesce(public.is_admin(),false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode='42501';
  end if;
  if p_confirmacao is distinct from true or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Confirme a conferência e autorização de emissão do PDF final.';
  end if;
  if length(p_assinatura_referencia)>1000 then raise exception 'Referência da assinatura muito longa.'; end if;
  select * into item from fikarj_protocolos.secretaria_itens where id=p_item for update;
  if not found then raise exception 'Item não localizado.'; end if;
  select * into lote from fikarj_protocolos.secretaria_lotes where id=item.lote_id;
  if lote.teste then
    select * into documento from fikarj_protocolos_teste.documentos where solicitacao=p_item for update;
  else
    select * into documento from fikarj_protocolos.documentos where solicitacao=p_item for update;
  end if;
  if not found then raise exception 'Protocolo não localizado.'; end if;
  if documento.tipo='Diploma' and not exists(
    select 1 from fikarj_protocolos.assinatura_presidencia where titular=auth.uid()
  ) then raise exception 'Emissão de diploma exclusiva da Presidência.' using errcode='42501'; end if;
  if documento.estado='emitido' and item.final_sha256=p_sha256
    and documento.pdf_sha256=p_sha256 then return public.obter_lote_documentos_fikarj(item.lote_id); end if;
  if documento.estado<>'rascunho' or item.final_sha256 is not null then
    raise exception 'Protocolo indisponível ou PDF final já registrado.';
  end if;
  caminho:=item.lote_id::text||'/'||item.id::text||'-final.pdf';
  if not exists(select 1 from storage.objects where bucket_id='secretaria-documentos' and name=caminho
    and lower(coalesce(metadata->>'mimetype',''))='application/pdf'
    and coalesce((metadata->>'size')::bigint,0)>0) then
    raise exception 'Envie o PDF final conferido ao armazenamento privado.';
  end if;
  update fikarj_protocolos.secretaria_itens set final_sha256=p_sha256,final_registrado_em=clock_timestamp(),
    final_registrado_por=auth.uid(),assinatura_referencia=nullif(btrim(p_assinatura_referencia),'') where id=p_item;
  if lote.teste then
    update fikarj_protocolos_teste.documentos set estado='emitido',emitido_em=clock_timestamp(),
      emitido_por=auth.uid(),pdf_sha256=p_sha256 where solicitacao=p_item;
  else
    update fikarj_protocolos.documentos set estado='emitido',emitido_em=clock_timestamp(),
      emitido_por=auth.uid(),pdf_sha256=p_sha256 where solicitacao=p_item;
  end if;
  return public.obter_lote_documentos_fikarj(item.lote_id);
end;
$$;

create or replace function public.secretaria_pode_enviar_pdf(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(public.is_admin(),false) and exists(
    select 1 from fikarj_protocolos.secretaria_itens i
    join fikarj_protocolos.secretaria_lotes l on l.id=i.lote_id
    left join fikarj_protocolos.documentos d on not l.teste and d.solicitacao=i.id
    left join fikarj_protocolos_teste.documentos dt on l.teste and dt.solicitacao=i.id
    where coalesce(d.estado,dt.estado)='rascunho' and (
      (i.arquivo_path=p_path and i.pdf_sha256 is null)
      or (p_path=i.lote_id::text||'/'||i.id::text||'-final.pdf' and i.final_sha256 is null)
    )
  );
$$;
revoke all on function public.registrar_emissao_lote_fikarj(uuid,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.registrar_emissao_lote_fikarj(uuid,text,boolean,text) to authenticated;
create or replace function public.obter_lote_documentos_fikarj(p_lote uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare resultado jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_admin(),false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode='42501';
  end if;
  select jsonb_build_object('lote_id',l.id,'teste',l.teste,'conteudo',l.conteudo,
    'criado_em',l.criado_em,'itens',coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'protocolo',i.protocolo,'destinatario',i.destinatario,'conteudo',l.conteudo,
      'estado',case when i.pdf_sha256 is null then 'preparado' else 'pdf_arquivado' end,
      'estado_protocolo',coalesce(d.estado,dt.estado),
      'ano',coalesce(d.ano,dt.ano),'numero',coalesce(d.numero,dt.numero),
      'solicitacao',i.id,'emitido_em',case when l.teste then null else d.emitido_em end,
      'motivo_cancelamento',case when l.teste then null else d.motivo_cancelamento end,
      'arquivo_final_path',i.lote_id::text||'/'||i.id::text||'-final.pdf',
      'final_sha256',i.final_sha256,'final_registrado_em',i.final_registrado_em,
      'assinatura_referencia',i.assinatura_referencia,
      'arquivo_path',i.arquivo_path,'pdf_sha256',i.pdf_sha256) order by i.ordem),'[]'::jsonb))
    into resultado from fikarj_protocolos.secretaria_lotes l
    join fikarj_protocolos.secretaria_itens i on i.lote_id=l.id
    left join fikarj_protocolos.documentos d on not l.teste and d.solicitacao=i.id
    left join fikarj_protocolos_teste.documentos dt on l.teste and dt.solicitacao=i.id
    where l.id=p_lote group by l.id;
  if resultado is null then raise exception 'Lote não localizado.'; end if;
  return resultado;
end;
$$;


commit;
