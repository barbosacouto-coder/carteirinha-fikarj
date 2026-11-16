-- Disposable LOCAL database only; no network or Meta calls. All changes rolled back.
\set ON_ERROR_STOP on
begin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select '11111111-1111-4111-8111-111111111111'::uuid
$$;
create function public.is_admin() returns boolean language sql stable as $$ select true $$;
\ir ../supabase/migrations/20261115160000_central_midias.sql
\ir ../supabase/migrations/20261115203002_central_midias_validar_mime_aprovacao.sql
do $$
declare item uuid;
begin
 if has_function_privilege('anon','public.central_midias_worker_claim(integer)','execute') or
    has_function_privilege('authenticated','public.central_midias_worker_claim(integer)','execute') then
   raise exception 'Public worker access';
 end if;
 item:=public.central_midias_salvar(null,null,'Local queue test','Synthetic',
 array['https://fixture.test/a.mp4'],array['instagram_reel','facebook_reel'],
 now()+interval '1 day','reel',array['video/mp4']);
 perform public.central_midias_aprovar(item,1);
 perform public.central_midias_agendar(item,2);
 update public.central_midias_itens set agendado_para=now()-interval '1 minute' where id=item;
end $$;
set local role service_role;
create temp table first_claim as select * from public.central_midias_worker_claim(1);
do $$
declare c record; blocked boolean:=false;
begin
 select * into strict c from first_claim;
 begin
   perform public.central_midias_worker_finalizar(c.destino_id,gen_random_uuid(),'publicado','fake-meta-id',null);
 exception when sqlstate '40001' then blocked:=true;
 end;
 if not blocked then raise exception 'Wrong lease accepted'; end if;
 perform public.central_midias_worker_finalizar(c.destino_id,c.lease_token,'publicado','fake-meta-id',null);
 blocked:=false;
 begin
   perform public.central_midias_worker_finalizar(c.destino_id,c.lease_token,'publicado','duplicate',null);
 exception when sqlstate '40001' then blocked:=true;
 end;
 if not blocked then raise exception 'Duplicate finalization accepted'; end if;
end $$;
create temp table second_claim as select * from public.central_midias_worker_claim(1);
reset role;
do $$
begin
 if (select count(*) from first_claim)<>1 or (select count(*) from second_claim)<>1 then
   raise exception 'Claim cardinality incorrect';
 end if;
 if (select destino_id from first_claim)=(select destino_id from second_claim) then
   raise exception 'Published destination reclaimed';
 end if;
 update public.central_midias_destinos set lease_ate=now()-interval '1 second'
 where id=(select destino_id from second_claim);
end $$;
set local role service_role;
create temp table third_claim as select * from public.central_midias_worker_claim(1);
reset role;
do $$
begin
 if exists(select from third_claim) then raise exception 'Expired destination retried automatically'; end if;
 if (select status from public.central_midias_destinos where id=(select destino_id from second_claim))<>'resultado_incerto' then
   raise exception 'Expired lease was not marked uncertain';
 end if;
 if (select id_externo from public.central_midias_destinos where id=(select destino_id from first_claim))<>'fake-meta-id' then
   raise exception 'Published receipt lost';
 end if;
 raise notice 'PASS: worker grants; one destination per claim; lease mismatch; duplicate finalize; expired lease quarantine; receipt preservation';
end $$;
rollback;
