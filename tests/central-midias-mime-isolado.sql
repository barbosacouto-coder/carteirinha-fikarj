-- Run only in a disposable, empty LOCAL database. All schema/data are rolled back.
\set ON_ERROR_STOP on
begin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid',true),'')::uuid
$$;
create function public.is_admin() returns boolean language sql stable as $$
  select coalesce(current_setting('test.admin',true),'false')='true'
$$;
select set_config('test.uid','11111111-1111-4111-8111-111111111111',true);
select set_config('test.admin','true',true);
\ir ../supabase/migrations/20261115160000_central_midias.sql
-- Capture grants before replacing the function.
create temp table grants_before as select proacl from pg_proc where oid='public.central_midias_transicionar(uuid,integer,text)'::regprocedure;
\ir ../supabase/migrations/20261115203002_central_midias_validar_mime_aprovacao.sql

do $$
declare bad uuid; good uuid; reel uuid; invalid_reel uuid; audits integer; blocked boolean;
begin
  if (select proacl from grants_before) is distinct from
     (select proacl from pg_proc where oid='public.central_midias_transicionar(uuid,integer,text)'::regprocedure) then
    raise exception 'Function privileges changed';
  end if;
  bad:=public.central_midias_salvar(null,null,'Fixture mixed','Texto final',
    array['https://fixture.test/a.jpg','https://fixture.test/b.mp4'],array['instagram_carousel'],
    now()+interval '1 day','instagram_carousel',array['image/jpeg','video/mp4']);
  blocked:=false;
  begin perform public.central_midias_aprovar(bad,1);
  exception when sqlstate '22023' then blocked:=true; end;
  if not blocked then raise exception 'Mixed carousel was approved'; end if;
  if (select status from public.central_midias_itens where id=bad)<>'planejado' then raise exception 'Rejected approval mutated state'; end if;
  if (select count(*) from public.central_midias_auditoria where midia_id=bad)<>1 then raise exception 'Rejected approval wrote audit'; end if;
  -- A previously approved invalid draft must also be blocked at scheduling.
  update public.central_midias_itens set status='aprovado' where id=bad;
  blocked:=false;
  begin perform public.central_midias_agendar(bad,1);
  exception when sqlstate '22023' then blocked:=true; end;
  if not blocked then raise exception 'Mixed carousel was scheduled'; end if;
  if (select status from public.central_midias_destinos where midia_id=bad)<>'pendente' then raise exception 'Rejected schedule mutated destination'; end if;

  good:=public.central_midias_salvar(null,null,'Fixture JPEG','Texto final',
    array['https://fixture.test/a.jpg','https://fixture.test/b.jpg'],array['instagram_carousel'],
    now()+interval '1 day','instagram_carousel',array['image/jpeg','image/jpeg']);
  perform public.central_midias_aprovar(good,1);
  perform public.central_midias_agendar(good,2);
  if (select status from public.central_midias_itens where id=good)<>'agendado' then raise exception 'Valid carousel not scheduled'; end if;
  if (select status from public.central_midias_destinos where midia_id=good)<>'agendado' then raise exception 'Valid destination not scheduled'; end if;
  if (select count(*) from public.central_midias_auditoria where midia_id=good)<>3 then raise exception 'Valid audit trail incomplete'; end if;
  blocked:=false;
  begin perform public.central_midias_agendar(good,2);
  exception when sqlstate '40001' then blocked:=true; end;
  if not blocked then raise exception 'Stale version accepted'; end if;

  blocked:=false;
  begin perform public.central_midias_salvar(null,null,'Null URLs','Texto final',
    null,array['instagram_reel'],now()+interval '1 day','reel',array['video/mp4']);
  exception when sqlstate '22023' then blocked:=true; end;
  if not blocked then raise exception 'NULL URLs accepted'; end if;
  blocked:=false;
  begin perform public.central_midias_salvar(null,null,'Null MIME','Texto final',
    array['https://fixture.test/a.mp4'],array['instagram_reel'],now()+interval '1 day','reel',null);
  exception when sqlstate '22023' then blocked:=true; end;
  if not blocked then raise exception 'NULL MIME accepted'; end if;
  blocked:=false;
  begin perform public.central_midias_salvar(null,null,'Mismatched arrays','Texto final',
    array['https://fixture.test/a.mp4','https://fixture.test/b.mp4'],array['instagram_reel'],
    now()+interval '1 day','reel',array['video/mp4']);
  exception when sqlstate '22023' then blocked:=true; end;
  if not blocked then raise exception 'Mismatched URL/MIME counts accepted'; end if;
  invalid_reel:=public.central_midias_salvar(null,null,'Two videos','Texto final',
    array['https://fixture.test/a.mp4','https://fixture.test/b.mp4'],array['instagram_reel'],
    now()+interval '1 day','reel',array['video/mp4','video/mp4']);
  blocked:=false;
  begin perform public.central_midias_aprovar(invalid_reel,1);
  exception when sqlstate '22023' then blocked:=true; end;
  if not blocked then raise exception 'Two-video Reel approved'; end if;
  invalid_reel:=public.central_midias_salvar(null,null,'No videos','Texto final',
    array[]::text[],array['instagram_reel'],now()+interval '1 day','reel',array[]::text[]);
  blocked:=false;
  begin perform public.central_midias_aprovar(invalid_reel,1);
  exception when sqlstate '22023' then blocked:=true; end;
  if not blocked then raise exception 'Empty Reel approved'; end if;

  reel:=public.central_midias_salvar(null,null,'Fixture Reel','Texto final',
    array['https://fixture.test/a.mp4'],array['instagram_reel','facebook_reel'],
    now()+interval '1 day','reel',array['video/mp4']);
  perform public.central_midias_aprovar(reel,1);
  perform public.central_midias_agendar(reel,2);
  if (select count(*) from public.central_midias_destinos where midia_id=reel and status='agendado')<>2 then raise exception 'Reel destinations not scheduled'; end if;
  perform set_config('test.admin','false',true);
  blocked:=false;
  begin perform public.central_midias_cancelar(reel,3);
  exception when sqlstate '42501' then blocked:=true; end;
  if not blocked then raise exception 'Non admin accepted'; end if;
  raise notice 'PASS: invalid approval/scheduling blocked; JPEG/Reel allowed; audit/grants/version/admin preserved';
end $$;
rollback;
