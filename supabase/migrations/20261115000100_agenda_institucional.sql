-- Agenda institucional da Presidencia. Aplicar somente por migration aprovada.
-- A UI acessa os dados exclusivamente pelas RPCs admin-only abaixo.

CREATE TABLE public.agenda_institucional (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 200),
  modulo text NOT NULL CHECK (char_length(btrim(modulo)) BETWEEN 1 AND 60),
  responsavel text CHECK (responsavel IS NULL OR char_length(btrim(responsavel)) <= 160),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'cancelada')),
  prazo date,
  link text CHECK (
    link IS NULL OR (char_length(link) <= 2048 AND left(btrim(link), 8) = 'https://')
  ),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  criado_por uuid NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_por uuid NOT NULL,
  versao integer NOT NULL DEFAULT 1 CHECK (versao > 0)
);

CREATE INDEX agenda_institucional_prazo_idx
  ON public.agenda_institucional (prazo, atualizado_em DESC);

ALTER TABLE public.agenda_institucional ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_institucional FROM PUBLIC, anon, authenticated;

CREATE TABLE public.agenda_institucional_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agenda_id uuid NOT NULL,
  operacao text NOT NULL CHECK (operacao IN ('INSERT', 'UPDATE')),
  ator uuid NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  antes jsonb,
  depois jsonb NOT NULL
);

CREATE INDEX agenda_institucional_auditoria_item_idx
  ON public.agenda_institucional_auditoria (agenda_id, ocorrido_em DESC);

ALTER TABLE public.agenda_institucional_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_institucional_auditoria FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.agenda_institucional_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.agenda_institucional_auditoria
    (agenda_id, operacao, ator, antes, depois)
  VALUES
    (NEW.id,
     TG_OP,
     COALESCE(auth.uid(), NEW.atualizado_por),
     CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
     to_jsonb(NEW));
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_institucional_auditar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER agenda_institucional_audit_trg
  AFTER INSERT OR UPDATE ON public.agenda_institucional
  FOR EACH ROW EXECUTE FUNCTION public.agenda_institucional_auditar();

CREATE OR REPLACE FUNCTION public.agenda_institucional_listar()
RETURNS TABLE (
  id uuid,
  titulo text,
  modulo text,
  responsavel text,
  status text,
  prazo date,
  link text,
  atualizado_em timestamptz,
  versao integer,
  criado_em timestamptz,
  criado_por uuid,
  atualizado_por uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT a.id, a.titulo, a.modulo, a.responsavel, a.status, a.prazo,
           a.link, a.atualizado_em, a.versao, a.criado_em, a.criado_por,
           a.atualizado_por
      FROM public.agenda_institucional AS a
     ORDER BY a.prazo NULLS LAST, a.atualizado_em DESC, a.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_institucional_salvar(
  p_id uuid,
  p_titulo text,
  p_modulo text,
  p_responsavel text,
  p_status text,
  p_prazo date,
  p_link text,
  p_atualizado_em timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_link text := NULLIF(btrim(p_link), '');
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  IF p_titulo IS NULL OR char_length(btrim(p_titulo)) NOT BETWEEN 1 AND 200
     OR p_modulo IS NULL OR char_length(btrim(p_modulo)) NOT BETWEEN 1 AND 60
     OR (p_responsavel IS NOT NULL AND char_length(btrim(p_responsavel)) > 160)
     OR p_status IS NULL
     OR p_status NOT IN ('pendente', 'em_andamento', 'concluida', 'cancelada')
     OR (v_link IS NOT NULL AND
         (char_length(v_link) > 2048 OR left(v_link, 8) <> 'https://')) THEN
    RAISE EXCEPTION 'Dados invalidos para item da agenda' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    IF p_atualizado_em IS NOT NULL THEN
      RAISE EXCEPTION 'Timestamp deve ser nulo na criacao' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.agenda_institucional
      (titulo, modulo, responsavel, status, prazo, link, criado_por, atualizado_por)
    VALUES
      (btrim(p_titulo), btrim(p_modulo), NULLIF(btrim(p_responsavel), ''),
       p_status, p_prazo, v_link, v_uid, v_uid);
    RETURN;
  END IF;

  IF p_atualizado_em IS NULL THEN
    RAISE EXCEPTION 'Timestamp obrigatorio para atualizar item' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_institucional AS a
     SET titulo = btrim(p_titulo),
         modulo = btrim(p_modulo),
         responsavel = NULLIF(btrim(p_responsavel), ''),
         status = p_status,
         prazo = p_prazo,
         link = v_link,
         atualizado_em = clock_timestamp(),
         atualizado_por = v_uid,
         versao = a.versao + 1
   WHERE a.id = p_id
     AND a.atualizado_em = p_atualizado_em;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item ausente ou alterado por outra sessao; recarregue a agenda'
      USING ERRCODE = '40001';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_institucional_listar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_institucional_salvar(uuid, text, text, text, text, date, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_institucional_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_institucional_salvar(uuid, text, text, text, text, date, text, timestamptz) TO authenticated;
