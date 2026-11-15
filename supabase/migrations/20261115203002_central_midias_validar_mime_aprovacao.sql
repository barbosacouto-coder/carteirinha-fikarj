-- Align approval/scheduling with the JPEG-only carousel supported by the worker.
-- Existing drafts, access checks, function grants and audit history are preserved.
create or replace function public.central_midias_transicionar(p_id uuid,p_versao integer,p_acao text)
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
       or (v_item.formato_publicacao='instagram_carousel' and (
         cardinality(v_item.midias_urls) not between 2 and 10
         or cardinality(v_item.midias_mime_types)<>cardinality(v_item.midias_urls)
         or exists(select from unnest(v_item.midias_mime_types) m where m is null or m<>'image/jpeg')
       ))
       or (v_item.formato_publicacao='reel' and v_item.midias_mime_types<>array['video/mp4']) then
      raise exception 'Informe carrossel com 2 a 10 JPEG ou Reel MP4, destinos, legenda final e data futura.' using errcode='22023';
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
