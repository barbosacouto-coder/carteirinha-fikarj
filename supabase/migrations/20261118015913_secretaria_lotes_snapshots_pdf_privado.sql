begin;
create table if not exists fikarj_protocolos.secretaria_lotes (
  id uuid primary key,
  teste boolean not null,
  conteudo jsonb not null,
  destinatarios jsonb not null,
  criado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default clock_timestamp()
);
create table if not exists fikarj_protocolos.secretaria_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references fikarj_protocolos.secretaria_lotes(id),
  ordem integer not null check(ordem > 0),
  destinatario jsonb not null,
  protocolo text not null,
  arquivo_path text not null unique,
  pdf_sha256 text check(pdf_sha256 ~ '^[0-9a-f]{64}$'),
  arquivado_em timestamptz,
  arquivado_por uuid references auth.users(id),
  unique(lote_id,ordem)
);
alter table fikarj_protocolos.secretaria_lotes enable row level security;
alter table fikarj_protocolos.secretaria_itens enable row level security;
revoke all on fikarj_protocolos.secretaria_lotes, fikarj_protocolos.secretaria_itens from public,anon,authenticated,service_role;

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
      'arquivo_path',i.arquivo_path,'pdf_sha256',i.pdf_sha256) order by i.ordem),'[]'::jsonb))
    into resultado from fikarj_protocolos.secretaria_lotes l
    join fikarj_protocolos.secretaria_itens i on i.lote_id=l.id
    where l.id=p_lote group by l.id;
  if resultado is null then raise exception 'Lote não localizado.'; end if;
  return resultado;
end;
$$;

create or replace function public.listar_lotes_documentos_fikarj()
returns jsonb language plpgsql security definer set search_path='' as $$
declare resultado jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_admin(),false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.criado_em desc),'[]'::jsonb) into resultado
  from (select l.id as lote_id,l.criado_em,l.teste,l.conteudo->>'tipo' as tipo,
    l.conteudo->>'assunto' as assunto,count(*) as total,count(i.pdf_sha256) as pdfs
    from fikarj_protocolos.secretaria_lotes l join fikarj_protocolos.secretaria_itens i on i.lote_id=l.id
    group by l.id order by l.criado_em desc limit 100) r;
  return resultado;
end;
$$;

create or replace function public.preparar_lote_documentos_fikarj(
  p_chave uuid,p_teste boolean,p_conteudo jsonb,p_destinatarios jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  lote fikarj_protocolos.secretaria_lotes%rowtype;
  pessoa jsonb;
  chave uuid;
  numero text;
  pos integer:=0;
  campo text;
begin
  if auth.uid() is null or not coalesce(public.is_admin(),false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode='42501';
  end if;
  if p_chave is null or p_teste is null or jsonb_typeof(p_conteudo) is distinct from 'object'
    or jsonb_typeof(p_destinatarios) is distinct from 'array' then
    raise exception 'Informe chave, modo, conteúdo e destinatários.';
  end if;
  if jsonb_array_length(p_destinatarios) not between 1 and 500
    or octet_length(p_conteudo::text)>200000 or octet_length(p_destinatarios::text)>1000000 then
    raise exception 'Limite de 500 destinatários ou tamanho do lote excedido.';
  end if;
  foreach campo in array array['tipo','assunto','corpo','local','data','signatario','cargo_signatario','modelo_versao'] loop
    if jsonb_typeof(p_conteudo->campo) is distinct from 'string'
      or nullif(btrim(p_conteudo->>campo),'') is null then
      raise exception 'Campo obrigatório do conteúdo: %.',campo;
    end if;
  end loop;
  if length(p_conteudo->>'tipo')>100 or length(p_conteudo->>'assunto')>500
    or length(p_conteudo->>'modelo_versao')>100 then raise exception 'Tipo, assunto ou versão muito longo.'; end if;
  if p_conteudo->>'data' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data deve usar AAAA-MM-DD.'; end if;
  perform (p_conteudo->>'data')::date;
  for pessoa in select value from jsonb_array_elements(p_destinatarios) loop
    if jsonb_typeof(pessoa) is distinct from 'object' or jsonb_typeof(pessoa->'nome') is distinct from 'string'
      or nullif(btrim(pessoa->>'nome'),'') is null or length(pessoa->>'nome')>500 then
      raise exception 'Cada destinatário precisa de nome válido.';
    end if;
    foreach campo in array array['associacao','cargo','tratamento','endereco'] loop
      if pessoa ? campo and jsonb_typeof(pessoa->campo) not in ('string','null') then
        raise exception 'Campo inválido do destinatário: %.',campo;
      end if;
    end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_destinatarios) d group by d.value having count(*)>1) then
    raise exception 'Há destinatários duplicados no lote.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fikarj-secretaria-lote:'||p_chave::text,0));
  select * into lote from fikarj_protocolos.secretaria_lotes where id=p_chave;
  if found then
    if (lote.criado_por,lote.teste,lote.conteudo,lote.destinatarios)
      is distinct from (auth.uid(),p_teste,p_conteudo,p_destinatarios) then
      raise exception 'Chave já utilizada com outro conteúdo ou responsável.';
    end if;
    return public.obter_lote_documentos_fikarj(p_chave);
  end if;
  insert into fikarj_protocolos.secretaria_lotes(id,teste,conteudo,destinatarios,criado_por)
    values(p_chave,p_teste,p_conteudo,p_destinatarios,auth.uid());
  for pessoa in select value from jsonb_array_elements(p_destinatarios) loop
    chave:=gen_random_uuid();
    if p_teste then
      numero:=public.reservar_protocolo_teste_fikarj(chave,p_conteudo->>'tipo',p_conteudo->>'assunto',pessoa->>'nome');
    else
      numero:=public.reservar_protocolo_fikarj(chave,p_conteudo->>'tipo',p_conteudo->>'assunto',pessoa->>'nome');
    end if;
    pos:=pos+1;
    insert into fikarj_protocolos.secretaria_itens(id,lote_id,ordem,destinatario,protocolo,arquivo_path)
      values(chave,p_chave,pos,pessoa,numero,p_chave::text||'/'||chave::text||'.pdf');
  end loop;
  return public.obter_lote_documentos_fikarj(p_chave);
end;
$$;

create or replace function public.anexar_pdf_lote_fikarj(p_item uuid,p_path text,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item fikarj_protocolos.secretaria_itens%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_admin(),false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode='42501';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Hash SHA-256 inválido.'; end if;
  select * into item from fikarj_protocolos.secretaria_itens where id=p_item for update;
  if not found or p_path is distinct from item.arquivo_path then raise exception 'Item ou caminho inválido.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='secretaria-documentos' and name=p_path
    and lower(coalesce(metadata->>'mimetype',''))='application/pdf'
    and coalesce((metadata->>'size')::bigint,0)>0) then
    raise exception 'PDF privado não localizado no armazenamento.';
  end if;
  if item.pdf_sha256 is not null and item.pdf_sha256<>p_sha256 then
    raise exception 'O item já possui outro PDF arquivado.';
  end if;
  update fikarj_protocolos.secretaria_itens set pdf_sha256=p_sha256,
    arquivado_em=coalesce(arquivado_em,clock_timestamp()),arquivado_por=coalesce(arquivado_por,auth.uid()) where id=p_item;
  return public.obter_lote_documentos_fikarj(item.lote_id);
end;
$$;

create or replace function public.secretaria_pode_enviar_pdf(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(public.is_admin(),false) and exists(
    select 1 from fikarj_protocolos.secretaria_itens i where i.arquivo_path=p_path and i.pdf_sha256 is null
  );
$$;
revoke all on function public.obter_lote_documentos_fikarj(uuid),public.listar_lotes_documentos_fikarj(),
  public.preparar_lote_documentos_fikarj(uuid,boolean,jsonb,jsonb),public.anexar_pdf_lote_fikarj(uuid,text,text),
  public.secretaria_pode_enviar_pdf(text) from public,anon,authenticated,service_role;
grant execute on function public.obter_lote_documentos_fikarj(uuid),public.listar_lotes_documentos_fikarj(),
  public.preparar_lote_documentos_fikarj(uuid,boolean,jsonb,jsonb),public.anexar_pdf_lote_fikarj(uuid,text,text),
  public.secretaria_pode_enviar_pdf(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('secretaria-documentos','secretaria-documentos',false,20971520,array['application/pdf'])
  on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf'];
drop policy if exists secretaria_documentos_ler on storage.objects;
create policy secretaria_documentos_ler on storage.objects for select to authenticated
  using(bucket_id='secretaria-documentos' and (select auth.uid()) is not null and (select public.is_admin()));
drop policy if exists secretaria_documentos_enviar on storage.objects;
create policy secretaria_documentos_enviar on storage.objects for insert to authenticated
  with check(bucket_id='secretaria-documentos' and public.secretaria_pode_enviar_pdf(name));
commit;


