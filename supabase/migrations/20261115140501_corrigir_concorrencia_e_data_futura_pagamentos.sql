-- Serializa lançamentos financeiros concorrentes e rejeita datas futuras.
-- Mantém assinaturas, SECURITY INVOKER e search_path das RPCs existentes.

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

  -- Todos os lançamentos desta cobrança passam pelo mesmo lock antes de
  -- calcular o saldo, evitando que duas sessões consumam o mesmo saldo.
  SELECT valor_final, cancelada
    INTO v_total, v_canc
    FROM public.pag_cobrancas
   WHERE id = p_cobranca
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança % não encontrada', p_cobranca;
  END IF;
  IF v_canc THEN
    RAISE EXCEPTION 'Cobrança cancelada';
  END IF;

  SELECT coalesce(sum(valor), 0)
    INTO v_pago
    FROM public.pag_pagamentos
   WHERE cobranca_id = p_cobranca;
  v_saldo := v_total - v_pago;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor inválido';
  END IF;
  IF p_valor > v_saldo THEN
    RAISE EXCEPTION 'Valor (%) maior que o saldo devedor (%)', p_valor, v_saldo;
  END IF;
  IF p_parcela IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pag_parcelas
     WHERE id = p_parcela AND cobranca_id = p_cobranca
  ) THEN
    RAISE EXCEPTION 'Parcela não pertence à cobrança';
  END IF;

  INSERT INTO public.pag_pagamentos(
    cobranca_id, parcela_id, valor, data_pagamento, forma,
    comprovante_path, observacao, lancado_por
  )
  VALUES (
    p_cobranca, p_parcela, p_valor, v_data, p_forma,
    p_comprovante, p_obs, auth.jwt()->>'email'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
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
  IF NOT public.pag_pode_editar() THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF p_data IS NULL OR p_data > v_hoje THEN
    RAISE EXCEPTION 'A data do pagamento não pode ser nula ou futura';
  END IF;
  IF p_tipo NOT IN ('anuidade_fikarj', 'anuidade_cnkb') THEN
    RAISE EXCEPTION 'Tipo inválido';
  END IF;

  -- Serializa todas as criações/alterações de anuidade para o mesmo atleta,
  -- inclusive quando ainda não existe cobrança para o ano e tipo solicitados.
  PERFORM 1
    FROM public.atletas
   WHERE id = p_atleta
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atleta % não encontrado', p_atleta;
  END IF;

  SELECT * INTO c
    FROM public.pag_calcular_anuidade(p_atleta, p_tipo, p_ano, p_data);

  SELECT id INTO v_cob
    FROM public.pag_cobrancas
   WHERE atleta_id = p_atleta
     AND tipo = p_tipo
     AND ano = p_ano
     AND NOT cancelada
   FOR UPDATE;

  IF v_cob IS NULL THEN
    INSERT INTO public.pag_cobrancas (
      atleta_id, tipo, ano, descricao, graduacao_ref, valor_bruto,
      desconto_pct, desconto_motivo, valor_final, vencimento
    )
    VALUES (
      p_atleta, p_tipo, p_ano,
      CASE p_tipo
        WHEN 'anuidade_fikarj' THEN 'Anuidade FIKARJ '
        ELSE 'Anuidade CNKB '
      END || p_ano,
      (SELECT graduacao FROM public.atletas WHERE id = p_atleta),
      c.valor_bruto, c.desconto_pct, c.desconto_motivo, c.valor_final, c.vencimento
    )
    RETURNING id INTO v_cob;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.pag_pagamentos WHERE cobranca_id = v_cob
  ) THEN
    UPDATE public.pag_cobrancas
       SET graduacao_ref = (SELECT graduacao FROM public.atletas WHERE id = p_atleta),
           valor_bruto = c.valor_bruto,
           desconto_pct = c.desconto_pct,
           desconto_motivo = c.desconto_motivo,
           valor_final = c.valor_final
     WHERE id = v_cob;
  ELSE
    RAISE EXCEPTION 'Esta anuidade já tem pagamento lançado';
  END IF;

  v_pago := coalesce(p_valor_pago, c.valor_final);
  IF v_pago <> c.valor_final THEN
    RAISE EXCEPTION 'Valor pago (R$ %) diferente do devido (R$ %). Anuidade é paga de uma vez.',
      v_pago, c.valor_final;
  END IF;

  INSERT INTO public.pag_pagamentos (
    cobranca_id, valor, data_pagamento, forma, comprovante_path, observacao
  )
  VALUES (v_cob, v_pago, p_data, p_forma, p_comprovante, p_obs);
  RETURN v_cob;
END
$function$;
