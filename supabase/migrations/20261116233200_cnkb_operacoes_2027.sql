-- Controle CNKB por pagamento. Recebimentos diretos ficam fora do caixa FIKARJ.
CREATE TABLE public.pag_cnkb_operacoes_2027 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  atleta_id bigint NOT NULL REFERENCES public.atletas(id),
  ano integer NOT NULL CHECK (ano = 2027),
  modalidade text NOT NULL CHECK (modalidade IN ('direto','intermediado','processo_dan')),
  pagamento_id bigint UNIQUE REFERENCES public.pag_pagamentos(id),
  processo_cobranca_id bigint UNIQUE REFERENCES public.pag_cobrancas(id),
  valor numeric(12,2) NOT NULL CHECK (valor > 0),
  data_pagamento date NOT NULL,
  forma text CHECK (forma IN ('pix','dinheiro','transferencia')),
  pagador text NOT NULL CHECK (char_length(btrim(pagador)) BETWEEN 1 AND 150),
  comprovante_ref text NOT NULL CHECK (char_length(btrim(comprovante_ref)) BETWEEN 1 AND 500),
  registrado_por uuid NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelada_em timestamptz,
  CHECK ((modalidade = 'processo_dan') = (forma IS NULL)),
  CHECK ((modalidade = 'intermediado') = (pagamento_id IS NOT NULL)),
  CHECK ((modalidade = 'processo_dan') = (processo_cobranca_id IS NOT NULL))
);

CREATE UNIQUE INDEX pag_cnkb_direto_por_exercicio_idx
  ON public.pag_cnkb_operacoes_2027 (atleta_id, ano)
  WHERE modalidade = 'direto' AND cancelada_em IS NULL;

CREATE TABLE public.pag_cnkb_historico_2027 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operacao_id bigint NOT NULL REFERENCES public.pag_cnkb_operacoes_2027(id),
  acao text NOT NULL CHECK (acao IN ('conferida','repassada','confirmada','cancelada')),
  data_efetiva date NOT NULL,
  referencia text NOT NULL CHECK (char_length(btrim(referencia)) BETWEEN 1 AND 500),
  responsavel uuid NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (operacao_id, acao)
);

ALTER TABLE public.pag_cnkb_operacoes_2027 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pag_cnkb_historico_2027 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pag_cnkb_operacoes_2027, public.pag_cnkb_historico_2027
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pag_cnkb_operacoes_2027, public.pag_cnkb_historico_2027 TO authenticated;
CREATE POLICY pag_cnkb_operacoes_ler ON public.pag_cnkb_operacoes_2027
  FOR SELECT TO authenticated USING (public.pag_pode_ler());
CREATE POLICY pag_cnkb_historico_ler ON public.pag_cnkb_historico_2027
  FOR SELECT TO authenticated USING (public.pag_pode_ler());

CREATE VIEW public.pag_v_cnkb_operacoes_2027
WITH (security_invoker = true)
AS
SELECT o.id, o.atleta_id, o.ano, o.modalidade, o.valor, o.data_pagamento,
       o.pagamento_id, o.cancelada_em,
       h.conferencia, h.repasse_data, h.confirmacao_data,
       CASE
         WHEN o.cancelada_em IS NOT NULL THEN 'cancelada'
         WHEN EXISTS (SELECT 1 FROM public.pag_estornos e
             WHERE e.pagamento_id = o.pagamento_id AND e.status = 'aprovado') THEN 'estornada'
         WHEN h.confirmacao_data IS NOT NULL THEN 'confirmada'
         WHEN h.repasse_data IS NOT NULL THEN 'repassada'
         WHEN h.conferencia IS NULL THEN 'aguardando_conferencia'
         WHEN o.modalidade = 'direto' THEN 'aguardando_confirmacao'
         ELSE 'aguardando_repasse'
       END AS situacao, o.processo_cobranca_id
  FROM public.pag_cnkb_operacoes_2027 o
  LEFT JOIN LATERAL (
    SELECT max(data_efetiva) FILTER (WHERE acao = 'conferida') AS conferencia,
           max(data_efetiva) FILTER (WHERE acao = 'repassada') AS repasse_data,
           max(data_efetiva) FILTER (WHERE acao = 'confirmada') AS confirmacao_data
      FROM public.pag_cnkb_historico_2027 WHERE operacao_id = o.id
  ) h ON true;

REVOKE ALL ON public.pag_v_cnkb_operacoes_2027 FROM PUBLIC, anon;
GRANT SELECT ON public.pag_v_cnkb_operacoes_2027 TO authenticated;

CREATE FUNCTION public.pag_cnkb_registrar_2027(
  p_atleta bigint, p_modalidade text, p_data date, p_valor numeric,
  p_forma text, p_pagador text, p_comprovante_ref text, p_credito_conferido boolean
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id bigint;
  v_cobranca bigint;
  v_pagamento bigint;
  v_devido numeric;
BEGIN
  IF v_uid IS NULL OR NOT coalesce(public.pag_pode_editar(), false) THEN
    RAISE EXCEPTION 'Sem permissão para registrar operações CNKB' USING ERRCODE = '42501';
  END IF;
  IF p_modalidade IS NULL OR p_modalidade NOT IN ('direto','intermediado')
     OR p_data IS NULL OR p_data < DATE '2026-12-01'
     OR p_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date
     OR p_valor IS NULL OR p_valor <= 0 OR p_valor <> round(p_valor,2) THEN
    RAISE EXCEPTION 'Confira modalidade, data efetiva e valor do pagamento';
  END IF;
  PERFORM 1 FROM public.atletas WHERE id = p_atleta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atleta não encontrado'; END IF;

  IF EXISTS (SELECT 1 FROM public.pag_cnkb_operacoes_2027
              WHERE atleta_id = p_atleta AND ano = 2027 AND modalidade = 'direto'
                AND cancelada_em IS NULL)
     OR EXISTS (
       SELECT 1 FROM public.pag_cobrancas c
       JOIN public.pag_pagamentos p ON p.cobranca_id = c.id
       WHERE c.atleta_id = p_atleta AND c.ano = 2027 AND c.tipo = 'anuidade_cnkb'
         AND NOT c.cancelada
         AND NOT EXISTS (SELECT 1 FROM public.pag_estornos e
                          WHERE e.pagamento_id = p.id AND e.status = 'aprovado')
     ) THEN
    RAISE EXCEPTION 'Já existe um pagamento CNKB ativo para este exercício';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pag_processos_registro_2027 p
    JOIN public.pag_cobrancas c ON c.id = p.cobranca_id
    WHERE c.atleta_id = p_atleta AND c.ano = 2027 AND NOT c.cancelada AND p.cnkb_valor > 0
  ) THEN
    RAISE EXCEPTION 'Anuidade CNKB vinculada a processo Dan existente';
  END IF;
  IF p_modalidade = 'intermediado' AND p_credito_conferido IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirme que o crédito foi conferido no caixa ou extrato';
  END IF;
  SELECT valor_final INTO v_devido
    FROM public.pag_calcular_anuidade(p_atleta,'anuidade_cnkb',2027,p_data);
  IF p_valor IS DISTINCT FROM v_devido THEN
    RAISE EXCEPTION 'O valor CNKB aplicável à data é R$ %', v_devido;
  END IF;
  IF p_modalidade = 'intermediado' THEN
    v_cobranca := public.pag_lancar_anuidade(
      p_atleta,'anuidade_cnkb',2027,p_data,p_valor,p_forma,NULL,
      'Recebimento intermediado para repasse à CNKB'
    );
    SELECT p.id INTO STRICT v_pagamento
      FROM public.pag_pagamentos p WHERE p.cobranca_id = v_cobranca
       AND NOT EXISTS (SELECT 1 FROM public.pag_estornos e
                        WHERE e.pagamento_id = p.id AND e.status = 'aprovado');
    INSERT INTO public.pag_pagamentos_conciliacao_log (pagamento_id,status,motivo,ator)
    VALUES (v_pagamento,'conciliado','Recebimento intermediado conferido no lançamento',v_uid);
  END IF;
  INSERT INTO public.pag_cnkb_operacoes_2027 (
    atleta_id, ano, modalidade, pagamento_id, valor, data_pagamento, forma, pagador,
    comprovante_ref, registrado_por
  ) VALUES (p_atleta, 2027, p_modalidade, v_pagamento, p_valor, p_data, p_forma,
            btrim(p_pagador), btrim(p_comprovante_ref), v_uid)
  RETURNING id INTO v_id;
  IF p_modalidade = 'intermediado' THEN
    INSERT INTO public.pag_cnkb_historico_2027 (operacao_id,acao,data_efetiva,referencia,responsavel)
    VALUES (v_id,'conferida',(now() AT TIME ZONE 'America/Sao_Paulo')::date,btrim(p_comprovante_ref),v_uid);
  END IF;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.pag_cnkb_movimentar_2027(
  p_operacao bigint, p_acao text, p_data date, p_referencia text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_operacao public.pag_cnkb_operacoes_2027%ROWTYPE;
  v_repasse date;
  v_conferencia date;
BEGIN
  IF v_uid IS NULL OR NOT coalesce(public.pag_pode_editar(), false) THEN
    RAISE EXCEPTION 'Sem permissão para movimentar operações CNKB' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_operacao FROM public.pag_cnkb_operacoes_2027
   WHERE id = p_operacao FOR UPDATE;
  IF NOT FOUND OR v_operacao.cancelada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Operação CNKB ativa não encontrada';
  END IF;
  IF v_operacao.pagamento_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pag_estornos WHERE pagamento_id = v_operacao.pagamento_id AND status = 'aprovado'
  ) THEN
    RAISE EXCEPTION 'Pagamento já estornado';
  END IF;
  IF v_operacao.modalidade = 'processo_dan' AND NOT EXISTS (
    SELECT 1 FROM public.pag_v_anuidades_inclusas_2027 a
     WHERE a.cobranca_id = v_operacao.processo_cobranca_id
       AND a.tipo = 'anuidade_cnkb' AND a.status IN ('coberta_aguardando_cnkb','quitada_por_inclusao')
  ) THEN RAISE EXCEPTION 'O processo Dan precisa estar integralmente quitado e conciliado'; END IF;
  IF p_data IS NULL OR p_data < v_operacao.data_pagamento
     OR p_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Data efetiva inválida para esta operação';
  END IF;
  SELECT data_efetiva INTO v_repasse FROM public.pag_cnkb_historico_2027
   WHERE operacao_id = p_operacao AND acao = 'repassada';
  SELECT data_efetiva INTO v_conferencia FROM public.pag_cnkb_historico_2027
   WHERE operacao_id = p_operacao AND acao = 'conferida';
  CASE p_acao
    WHEN 'conferida' THEN
      NULL;
    WHEN 'repassada' THEN
      IF v_operacao.modalidade = 'direto' OR v_conferencia IS NULL THEN RAISE EXCEPTION 'Repasse exige recebimento intermediado conferido'; END IF;
    WHEN 'confirmada' THEN
      IF v_conferencia IS NULL
         OR (v_operacao.modalidade <> 'direto' AND (v_repasse IS NULL OR p_data < v_repasse)) THEN
        RAISE EXCEPTION 'Conclua a conferência e o repasse aplicável antes da confirmação CNKB';
      END IF;
    WHEN 'cancelada' THEN
      IF v_operacao.modalidade <> 'direto' THEN
        RAISE EXCEPTION 'Recebimento intermediado deve seguir o fluxo auditado de estorno';
      END IF;
      IF NOT coalesce(public.is_admin(), false) THEN
        RAISE EXCEPTION 'Cancelamento restrito à administração' USING ERRCODE = '42501';
      END IF;
      UPDATE public.pag_cnkb_operacoes_2027 SET cancelada_em = clock_timestamp() WHERE id = p_operacao;
    ELSE
      RAISE EXCEPTION 'Movimentação CNKB inválida';
  END CASE;
  INSERT INTO public.pag_cnkb_historico_2027 (operacao_id,acao,data_efetiva,referencia,responsavel)
  VALUES (p_operacao,p_acao,p_data,btrim(p_referencia),v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.pag_cnkb_registrar_2027(bigint,text,date,numeric,text,text,text,boolean),
  public.pag_cnkb_movimentar_2027(bigint,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_cnkb_registrar_2027(bigint,text,date,numeric,text,text,text,boolean),
  public.pag_cnkb_movimentar_2027(bigint,text,date,text) TO authenticated;

-- Protege também as rotas antigas e os lançamentos diretos na tabela de pagamentos.
CREATE FUNCTION public.pag_cnkb_impedir_cobranca_dupla_2027()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_atleta bigint;
BEGIN
  SELECT c.atleta_id INTO v_atleta FROM public.pag_cobrancas c
   WHERE c.id = NEW.cobranca_id AND c.ano = 2027 AND c.tipo = 'anuidade_cnkb';
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.atletas WHERE id = v_atleta FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.pag_cnkb_operacoes_2027
     WHERE atleta_id = v_atleta AND ano = 2027 AND modalidade = 'direto' AND cancelada_em IS NULL
  ) THEN
    RAISE EXCEPTION 'Anuidade CNKB já registrada como pagamento direto';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pag_cnkb_impedir_cobranca_dupla_2027() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pag_cnkb_impedir_cobranca_dupla_2027
  BEFORE INSERT ON public.pag_pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.pag_cnkb_impedir_cobranca_dupla_2027();
