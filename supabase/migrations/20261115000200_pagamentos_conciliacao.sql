-- Conciliação auditável dos pagamentos existentes.
-- Não altera nem remove linhas de public.pag_pagamentos.

CREATE TABLE public.pag_pagamentos_conciliacao_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pagamento_id bigint NOT NULL
    REFERENCES public.pag_pagamentos(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pendente', 'conciliado', 'divergente')),
  motivo text CHECK (motivo IS NULL OR char_length(btrim(motivo)) <= 500),
  ator uuid NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pag_pagamentos_conciliacao_motivo_divergente
    CHECK (status <> 'divergente' OR nullif(btrim(motivo), '') IS NOT NULL)
);

CREATE INDEX pag_pagamentos_conciliacao_ult_idx
  ON public.pag_pagamentos_conciliacao_log (pagamento_id, ocorrido_em DESC, id DESC);

ALTER TABLE public.pag_pagamentos_conciliacao_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pag_pagamentos_conciliacao_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pag_pagamentos_conciliacao_log TO authenticated;

CREATE POLICY pag_pagamentos_conciliacao_ler
  ON public.pag_pagamentos_conciliacao_log
  FOR SELECT TO authenticated
  USING (public.pag_pode_ler());

CREATE VIEW public.pag_v_pagamentos_conciliacao
WITH (security_invoker = true)
AS
SELECT
  p.id AS pagamento_id,
  p.cobranca_id,
  p.parcela_id,
  c.atleta_id,
  a.registro,
  a.nome AS atleta_nome,
  a.associacao,
  c.descricao,
  p.valor,
  p.data_pagamento,
  p.forma,
  p.valor_a_confirmar,
  COALESCE(cl.status, 'pendente'::text) AS conciliacao_status,
  cl.motivo AS conciliacao_motivo,
  cl.ocorrido_em AS conciliado_em,
  cl.ator AS conciliado_por
FROM public.pag_pagamentos AS p
JOIN public.pag_cobrancas AS c ON c.id = p.cobranca_id
JOIN public.atletas AS a ON a.id = c.atleta_id
LEFT JOIN LATERAL (
  SELECT l.status, l.motivo, l.ocorrido_em, l.ator
  FROM public.pag_pagamentos_conciliacao_log AS l
  WHERE l.pagamento_id = p.id
  ORDER BY l.ocorrido_em DESC, l.id DESC
  LIMIT 1
) AS cl ON true;

REVOKE ALL ON TABLE public.pag_v_pagamentos_conciliacao FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.pag_v_pagamentos_conciliacao TO authenticated;

CREATE OR REPLACE FUNCTION public.pag_conciliar_pagamento(
  p_pagamento_id bigint,
  p_status text,
  p_motivo text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_motivo text := nullif(btrim(p_motivo), '');
  v_log_id bigint;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.pag_papel() = 'admin', false) THEN
    RAISE EXCEPTION 'Acesso negado: conciliação exige perfil financeiro operacional.'
      USING ERRCODE = '42501';
  END IF;

  IF p_pagamento_id IS NULL
     OR p_status IS NULL
     OR p_status NOT IN ('pendente', 'conciliado', 'divergente')
     OR (p_status = 'divergente' AND v_motivo IS NULL)
     OR (v_motivo IS NOT NULL AND char_length(v_motivo) > 500) THEN
    RAISE EXCEPTION 'Informe pagamento, status válido e motivo obrigatório para divergência.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pag_pagamentos AS p WHERE p.id = p_pagamento_id
  ) THEN
    RAISE EXCEPTION 'Pagamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.pag_pagamentos_conciliacao_log
    (pagamento_id, status, motivo, ator)
  VALUES
    (p_pagamento_id, p_status, v_motivo, v_uid)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.pag_conciliar_pagamento(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_conciliar_pagamento(bigint, text, text) TO authenticated;
