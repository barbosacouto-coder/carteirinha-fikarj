-- Estornos integrais auditáveis. Pagamentos originais são preservados; a
-- decisão da Presidência é ligada ao titular cadastrado em assinatura_presidencia.

CREATE TABLE public.pag_estornos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pagamento_id bigint NOT NULL
    REFERENCES public.pag_pagamentos(id) ON DELETE RESTRICT,
  valor numeric NOT NULL CHECK (valor > 0),
  motivo_solicitacao text NOT NULL
    CHECK (nullif(btrim(motivo_solicitacao), '') IS NOT NULL
           AND char_length(motivo_solicitacao) <= 500),
  solicitado_por uuid NOT NULL,
  solicitante_email text,
  solicitado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aprovado', 'recusado')),
  decisao_motivo text,
  decidido_por uuid,
  decisor_email text,
  decidido_em timestamptz,
  CONSTRAINT pag_estornos_decisao_coerente CHECK (
    (status = 'pendente' AND decisao_motivo IS NULL
       AND decidido_por IS NULL AND decidido_em IS NULL)
    OR
    (status IN ('aprovado', 'recusado')
       AND nullif(btrim(decisao_motivo), '') IS NOT NULL
       AND char_length(decisao_motivo) <= 500
       AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)
  )
);

CREATE INDEX pag_estornos_pagamento_idx
  ON public.pag_estornos (pagamento_id, solicitado_em DESC, id DESC);
CREATE INDEX pag_estornos_status_idx
  ON public.pag_estornos (status, solicitado_em DESC, id DESC);
CREATE UNIQUE INDEX pag_estornos_ativos_por_pagamento_uidx
  ON public.pag_estornos (pagamento_id)
  WHERE status IN ('pendente', 'aprovado');

ALTER TABLE public.pag_estornos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pag_estornos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pag_estornos TO authenticated;
CREATE POLICY pag_estornos_ler
  ON public.pag_estornos
  FOR SELECT TO authenticated
  USING (public.pag_pode_ler());

-- Preserva INSERT/SELECT já usados pelas RPCs SECURITY INVOKER; remove edição
-- ou apagamento direto do histórico financeiro por clientes autenticados/anon.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.pag_pagamentos
  FROM PUBLIC, anon, authenticated;

-- A view expõe saldo líquido: estornos aprovados deixam de contar como pagos.
CREATE OR REPLACE VIEW public.pag_v_cobrancas
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.atleta_id,
  c.tipo,
  c.ano,
  c.evento_id,
  c.descricao,
  c.graduacao_ref,
  c.valor_bruto,
  c.desconto_pct,
  c.desconto_motivo,
  c.valor_final,
  c.vencimento,
  c.cancelada,
  c.criado_em,
  c.criado_por,
  a.nome AS atleta_nome,
  a.cpf,
  a.associacao,
  coalesce(p.pago, 0::numeric) AS valor_pago,
  c.valor_final - coalesce(p.pago, 0::numeric) AS saldo,
  CASE
    WHEN c.cancelada THEN 'cancelada'::text
    WHEN coalesce(p.pago, 0::numeric) >= c.valor_final THEN 'pago'::text
    WHEN (
      EXISTS (
        SELECT 1
          FROM public.pag_parcelas pp
         WHERE pp.cobranca_id = c.id
           AND pp.vencimento < CURRENT_DATE
           AND pp.valor > coalesce((
             SELECT coalesce(sum(x.valor), 0::numeric)
                    - coalesce(sum(e.valor), 0::numeric)
               FROM public.pag_pagamentos x
               LEFT JOIN public.pag_estornos e
                 ON e.pagamento_id = x.id AND e.status = 'aprovado'
              WHERE x.parcela_id = pp.id
           ), 0::numeric)
      )
    ) OR (
      c.vencimento < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM public.pag_parcelas pp WHERE pp.cobranca_id = c.id
      )
    ) THEN 'inadimplente'::text
    WHEN coalesce(p.pago, 0::numeric) > 0::numeric THEN 'parcial'::text
    ELSE 'pendente'::text
  END AS status,
  p.ultimo_pagamento
FROM public.pag_cobrancas c
JOIN public.atletas a ON a.id = c.atleta_id
LEFT JOIN LATERAL (
  SELECT coalesce(sum(pp.valor), 0::numeric)
           - coalesce(sum(e.valor), 0::numeric) AS pago,
         max(pp.data_pagamento) AS ultimo_pagamento
    FROM public.pag_pagamentos pp
    LEFT JOIN public.pag_estornos e
      ON e.pagamento_id = pp.id AND e.status = 'aprovado'
   WHERE pp.cobranca_id = c.id
) p ON true;

CREATE OR REPLACE FUNCTION public.pag_estorno_solicitar(
  p_pagamento_id bigint,
  p_motivo text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_cobranca_id bigint;
  v_valor numeric;
  v_estorno_id bigint;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  IF v_uid IS NULL OR NOT coalesce(public.pag_pode_editar(), false) THEN
    RAISE EXCEPTION 'Solicitação restrita ao Financeiro autorizado.'
      USING ERRCODE = '42501';
  END IF;
  IF p_pagamento_id IS NULL OR v_motivo IS NULL OR char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'Informe o pagamento e um motivo de até 500 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.cobranca_id, p.valor
    INTO v_cobranca_id, v_valor
    FROM public.pag_pagamentos p
   WHERE p.id = p_pagamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.pag_cobrancas c
   WHERE c.id = v_cobranca_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança do pagamento não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.valor INTO v_valor
    FROM public.pag_pagamentos p
   WHERE p.id = p_pagamento_id AND p.cobranca_id = v_cobranca_id
   FOR UPDATE;

  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'O pagamento não tem valor elegível para estorno integral.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pag_estornos e
     WHERE e.pagamento_id = p_pagamento_id
       AND e.status IN ('pendente', 'aprovado')
  ) THEN
    RAISE EXCEPTION 'Já existe solicitação pendente ou estorno aprovado para este pagamento.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.pag_estornos (
    pagamento_id, valor, motivo_solicitacao, solicitado_por, solicitante_email
  )
  VALUES (p_pagamento_id, v_valor, v_motivo, v_uid, v_email)
  RETURNING id INTO v_estorno_id;
  RETURN v_estorno_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pag_estorno_decidir(
  p_id bigint,
  p_aprovar boolean,
  p_motivo text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_pagamento_id bigint;
  v_cobranca_id bigint;
  v_valor numeric;
  v_valor_original numeric;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_status text := CASE WHEN p_aprovar THEN 'aprovado' ELSE 'recusado' END;
BEGIN
  -- Mesmo predicado de autoridade já usado por confirmar_anuidades_presidencia.
  IF NOT coalesce(public.is_admin(), false)
     OR NOT EXISTS (
       SELECT 1 FROM fikarj_protocolos.assinatura_presidencia
        WHERE titular = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Acesso restrito à Presidência titular.'
      USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_aprovar IS NULL OR v_motivo IS NULL
     OR char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'Informe a decisão e justificativa de até 500 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.pagamento_id, e.valor
    INTO v_pagamento_id, v_valor
    FROM public.pag_estornos e
   WHERE e.id = p_id AND e.status = 'pendente'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada ou já decidida.'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_aprovar THEN
    SELECT p.cobranca_id, p.valor
      INTO v_cobranca_id, v_valor_original
      FROM public.pag_pagamentos p
     WHERE p.id = v_pagamento_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pagamento original não encontrado.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM 1 FROM public.pag_cobrancas c
     WHERE c.id = v_cobranca_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cobrança do pagamento não encontrada.' USING ERRCODE = 'P0002';
    END IF;
    SELECT p.valor INTO v_valor_original
      FROM public.pag_pagamentos p
     WHERE p.id = v_pagamento_id AND p.cobranca_id = v_cobranca_id
     FOR UPDATE;
    IF v_valor_original IS DISTINCT FROM v_valor THEN
      RAISE EXCEPTION 'O valor original mudou; solicite nova conferência.'
        USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.pag_estornos e
       WHERE e.pagamento_id = v_pagamento_id
         AND e.id <> p_id AND e.status = 'aprovado'
    ) THEN
      RAISE EXCEPTION 'Este pagamento já possui estorno aprovado.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.pag_estornos
     SET status = v_status,
         decisao_motivo = v_motivo,
         decidido_por = v_uid,
         decisor_email = v_email,
         decidido_em = clock_timestamp()
   WHERE id = p_id AND status = 'pendente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação já decidida.' USING ERRCODE = '40001';
  END IF;
  RETURN p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pag_estornos_listar(
  p_registro integer DEFAULT NULL,
  p_somente_solicitacoes boolean DEFAULT false
)
RETURNS TABLE (
  pagamento_id bigint,
  cobranca_id bigint,
  atleta_id bigint,
  registro integer,
  atleta_nome text,
  associacao text,
  descricao text,
  valor numeric,
  data_pagamento date,
  forma text,
  conciliacao_status text,
  saldo_liquido numeric,
  estornado boolean,
  estorno_status text,
  motivo text,
  solicitante_email text,
  solicitado_em timestamptz,
  decisao_motivo text,
  decisor_email text,
  decidido_em timestamptz,
  pode_decidir boolean,
  estorno_historico jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT coalesce(public.pag_pode_ler(), false) THEN
    RAISE EXCEPTION 'Acesso negado ao histórico financeiro.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    pc.pagamento_id,
    pc.cobranca_id,
    pc.atleta_id,
    pc.registro,
    pc.atleta_nome,
    pc.associacao,
    pc.descricao,
    pc.valor,
    pc.data_pagamento,
    pc.forma,
    pc.conciliacao_status,
    vc.saldo AS saldo_liquido,
    coalesce(latest.status = 'aprovado', false) AS estornado,
    coalesce(latest.status, 'sem_solicitacao') AS estorno_status,
    latest.motivo_solicitacao AS motivo,
    latest.solicitante_email,
    latest.solicitado_em,
    latest.decisao_motivo,
    latest.decisor_email,
    latest.decidido_em,
    coalesce(public.is_admin(), false) AND EXISTS (
      SELECT 1 FROM fikarj_protocolos.assinatura_presidencia ap
       WHERE ap.titular = auth.uid()
    ) AS pode_decidir,
    coalesce(hist.itens, '[]'::jsonb) AS estorno_historico
  FROM public.pag_v_pagamentos_conciliacao pc
  JOIN public.pag_v_cobrancas vc ON vc.id = pc.cobranca_id
  LEFT JOIN LATERAL (
    SELECT e.status, e.motivo_solicitacao, e.solicitante_email,
           e.solicitado_em, e.decisao_motivo, e.decisor_email, e.decidido_em
      FROM public.pag_estornos e
     WHERE e.pagamento_id = pc.pagamento_id
     ORDER BY e.solicitado_em DESC, e.id DESC
     LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'status', e.status, 'valor', e.valor,
      'motivo_solicitacao', e.motivo_solicitacao,
      'solicitante_email', e.solicitante_email,
      'solicitado_em', e.solicitado_em,
      'decisao_motivo', e.decisao_motivo,
      'decisor_email', e.decisor_email,
      'decidido_em', e.decidido_em
    ) ORDER BY e.solicitado_em, e.id) AS itens
    FROM public.pag_estornos e
    WHERE e.pagamento_id = pc.pagamento_id
  ) hist ON true
  WHERE (p_registro IS NULL OR pc.registro = p_registro)
    AND (NOT coalesce(p_somente_solicitacoes, false)
         OR coalesce(jsonb_array_length(hist.itens), 0) > 0)
  ORDER BY pc.data_pagamento DESC, pc.pagamento_id DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.pag_estorno_solicitar(bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_estorno_solicitar(bigint, text) TO authenticated;
REVOKE ALL ON FUNCTION public.pag_estorno_decidir(bigint, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_estorno_decidir(bigint, boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.pag_estornos_listar(integer, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_estornos_listar(integer, boolean) TO authenticated;

-- Efetivo pago = pagamentos originais menos estornos aprovados, por cobrança.
CREATE OR REPLACE FUNCTION public.pag_registrar_pagamento(
  p_cobranca bigint,
  p_valor numeric,
  p_data date DEFAULT CURRENT_DATE,
  p_parcela bigint DEFAULT NULL::bigint,
  p_forma text DEFAULT 'pix'::text,
  p_comprovante text DEFAULT NULL::text,
  p_obs text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric;
  v_pago numeric;
  v_saldo numeric;
  v_id bigint;
  v_canc boolean;
  v_data date;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.pag_pode_editar() THEN
    RAISE EXCEPTION 'Sem permissão para lançar pagamentos';
  END IF;
  v_data := coalesce(p_data, v_hoje);
  IF v_data > v_hoje THEN
    RAISE EXCEPTION 'A data do pagamento não pode ser futura';
  END IF;

  SELECT valor_final, cancelada INTO v_total, v_canc
    FROM public.pag_cobrancas WHERE id = p_cobranca FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança % não encontrada', p_cobranca; END IF;
  IF v_canc THEN RAISE EXCEPTION 'Cobrança cancelada'; END IF;

  SELECT coalesce(sum(p.valor), 0) - coalesce(sum(e.valor), 0)
    INTO v_pago
    FROM public.pag_pagamentos p
    LEFT JOIN public.pag_estornos e
      ON e.pagamento_id = p.id AND e.status = 'aprovado'
   WHERE p.cobranca_id = p_cobranca;
  v_saldo := v_total - v_pago;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  IF p_valor > v_saldo THEN
    RAISE EXCEPTION 'Valor (%) maior que o saldo devedor (%)', p_valor, v_saldo;
  END IF;
  IF p_parcela IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pag_parcelas WHERE id = p_parcela AND cobranca_id = p_cobranca
  ) THEN RAISE EXCEPTION 'Parcela não pertence à cobrança'; END IF;

  INSERT INTO public.pag_pagamentos(
    cobranca_id, parcela_id, valor, data_pagamento, forma,
    comprovante_path, observacao, lancado_por
  ) VALUES (
    p_cobranca, p_parcela, p_valor, v_data, p_forma,
    p_comprovante, p_obs, auth.jwt()->>'email'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pag_lancar_anuidade(
  p_atleta bigint,
  p_tipo text,
  p_ano integer,
  p_data date,
  p_valor_pago numeric DEFAULT NULL::numeric,
  p_forma text DEFAULT 'pix'::text,
  p_comprovante text DEFAULT NULL::text,
  p_obs text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  c record;
  v_cob bigint;
  v_pago numeric;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.pag_pode_editar() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_data IS NULL OR p_data > v_hoje THEN
    RAISE EXCEPTION 'A data do pagamento não pode ser nula ou futura';
  END IF;
  IF p_tipo NOT IN ('anuidade_fikarj','anuidade_cnkb') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;

  PERFORM 1 FROM public.atletas WHERE id = p_atleta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atleta % não encontrado', p_atleta; END IF;
  SELECT * INTO c FROM public.pag_calcular_anuidade(p_atleta, p_tipo, p_ano, p_data);
  SELECT id INTO v_cob FROM public.pag_cobrancas
   WHERE atleta_id = p_atleta AND tipo = p_tipo AND ano = p_ano AND NOT cancelada
   FOR UPDATE;

  IF v_cob IS NULL THEN
    INSERT INTO public.pag_cobrancas (
      atleta_id, tipo, ano, descricao, graduacao_ref, valor_bruto,
      desconto_pct, desconto_motivo, valor_final, vencimento
    ) VALUES (
      p_atleta, p_tipo, p_ano,
      CASE p_tipo WHEN 'anuidade_fikarj' THEN 'Anuidade FIKARJ ' ELSE 'Anuidade CNKB ' END || p_ano,
      (SELECT graduacao FROM public.atletas WHERE id = p_atleta),
      c.valor_bruto, c.desconto_pct, c.desconto_motivo, c.valor_final, c.vencimento
    ) RETURNING id INTO v_cob;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM public.pag_pagamentos p
     WHERE p.cobranca_id = v_cob
       AND NOT EXISTS (
         SELECT 1 FROM public.pag_estornos e
          WHERE e.pagamento_id = p.id AND e.status = 'aprovado'
       )
  ) THEN
    UPDATE public.pag_cobrancas
       SET graduacao_ref = (SELECT graduacao FROM public.atletas WHERE id = p_atleta),
           valor_bruto = c.valor_bruto, desconto_pct = c.desconto_pct,
           desconto_motivo = c.desconto_motivo, valor_final = c.valor_final
     WHERE id = v_cob;
  ELSE
    RAISE EXCEPTION 'Esta anuidade já tem pagamento não estornado';
  END IF;

  v_pago := coalesce(p_valor_pago, c.valor_final);
  IF v_pago <> c.valor_final THEN
    RAISE EXCEPTION 'Valor pago (R$ %) diferente do devido (R$ %). Anuidade é paga de uma vez.',
      v_pago, c.valor_final;
  END IF;
  INSERT INTO public.pag_pagamentos (
    cobranca_id, valor, data_pagamento, forma, comprovante_path, observacao
  ) VALUES (v_cob, v_pago, p_data, p_forma, p_comprovante, p_obs);
  RETURN v_cob;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pag_inscrever_evento(
  p_atleta bigint,
  p_evento bigint,
  p_categoria text,
  OUT cobranca_id bigint,
  OUT alerta text
)
RETURNS record
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v numeric;
  e record;
  v_ano integer;
BEGIN
  IF NOT public.pag_pode_editar() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO e FROM public.pag_eventos WHERE id = p_evento;
  SELECT valor INTO v FROM public.pag_evento_valores
   WHERE evento_id = p_evento AND categoria = p_categoria;
  IF v IS NULL THEN RAISE EXCEPTION 'Categoria "%" sem valor neste evento', p_categoria; END IF;
  v_ano := extract(year FROM e.data);
  INSERT INTO public.pag_cobrancas (
    atleta_id, tipo, ano, evento_id, descricao, graduacao_ref,
    valor_bruto, valor_final, vencimento
  ) VALUES (
    p_atleta, 'evento', v_ano, p_evento, e.nome || ' — ' || p_categoria,
    (SELECT graduacao FROM public.atletas WHERE id = p_atleta), v, v, e.data
  ) RETURNING id INTO cobranca_id;
  IF NOT EXISTS (
    SELECT 1
      FROM public.pag_cobrancas c
      JOIN public.pag_pagamentos p ON p.cobranca_id = c.id
     WHERE c.atleta_id = p_atleta AND c.tipo = 'anuidade_fikarj'
       AND c.ano = v_ano AND NOT c.cancelada
       AND NOT EXISTS (
         SELECT 1 FROM public.pag_estornos x
          WHERE x.pagamento_id = p.id AND x.status = 'aprovado'
       )
  ) THEN
    alerta := format('Atenção: anuidade FIKARJ %s não paga.', v_ano);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_anuidades_presidencia(
  p_ano integer,
  p_revisado jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  lote jsonb;
  registro jsonb;
BEGIN
  IF NOT coalesce(public.is_admin(), false)
     OR NOT EXISTS (
       SELECT 1 FROM fikarj_protocolos.assinatura_presidencia
        WHERE titular = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Acesso restrito à Presidência' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'tipo', c.tipo, 'matricula', a.registro,
           'nome', a.nome, 'valor', p.valor, 'data', p.data_pagamento
         ) ORDER BY p.id), '[]')
    INTO lote
    FROM public.pag_pagamentos p
    JOIN public.pag_cobrancas c ON c.id = p.cobranca_id
    JOIN public.atletas a ON a.id = c.atleta_id
   WHERE c.ano = p_ano AND NOT c.cancelada
     AND c.tipo IN ('anuidade_fikarj', 'anuidade_cnkb')
     AND NOT EXISTS (
       SELECT 1 FROM public.pag_estornos e
        WHERE e.pagamento_id = p.id AND e.status = 'aprovado'
     );
  IF p_revisado IS NOT NULL THEN
    IF lote = '[]' OR lote <> p_revisado THEN
      RAISE EXCEPTION 'O lote mudou. Confira novamente.';
    END IF;
    INSERT INTO fikarj_protocolos.confirmacoes_anuidades (ano, titular, pagamentos)
    VALUES (p_ano, auth.uid(), lote)
    ON CONFLICT (ano) DO NOTHING;
  END IF;
  SELECT jsonb_build_object('em', confirmado_em, 'titular', titular, 'mesmo_lote', pagamentos = lote)
    INTO registro
    FROM fikarj_protocolos.confirmacoes_anuidades
   WHERE ano = p_ano;
  RETURN jsonb_build_object('pagamentos', lote, 'confirmacao', registro);
END;
$function$;
