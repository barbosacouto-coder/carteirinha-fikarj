-- Processos de competência 2027. As anuidades incluídas são apuradas por vínculo,
-- sem inserir receitas ou pagamentos adicionais.
ALTER TABLE public.pag_cobrancas DROP CONSTRAINT pag_cobrancas_tipo_check;
ALTER TABLE public.pag_cobrancas ADD CONSTRAINT pag_cobrancas_tipo_check
  CHECK (tipo IN ('anuidade_fikarj','anuidade_cnkb','registro_dan','exame_dan','evento',
                  'reconhecimento_dan','primeiro_registro_dangai','diploma_dangai'));

CREATE TABLE public.pag_processos_registro_2027 (
  cobranca_id bigint PRIMARY KEY REFERENCES public.pag_cobrancas(id),
  tipo text NOT NULL CHECK (tipo IN ('registro_dan','exame_dan','reconhecimento_dan',
                                    'primeiro_registro_dangai','diploma_dangai')),
  grau_dan integer CHECK (grau_dan BETWEEN 1 AND 7),
  fikarj_valor numeric(10,2) NOT NULL CHECK (fikarj_valor > 0),
  cnkb_valor numeric(10,2) NOT NULL CHECK (cnkb_valor >= 0),
  registrado_por uuid NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((grau_dan IS NULL) = (cnkb_valor = 0))
);
ALTER TABLE public.pag_processos_registro_2027 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pag_processos_registro_2027 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pag_processos_registro_2027 TO authenticated;
CREATE POLICY financeiro_processos_ler ON public.pag_processos_registro_2027
  FOR SELECT TO authenticated USING ((SELECT public.pag_pode_ler()));

CREATE FUNCTION public.pag_abrir_processo_registro_2027(
  p_atleta bigint, p_tipo text, p_grau_dan integer DEFAULT NULL
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_graduacao text;
  v_categoria text;
  v_id bigint;
  v_fikarj numeric;
  v_cnkb numeric := 0;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.pag_pode_editar(), false) THEN
    RAISE EXCEPTION 'Acesso restrito ao financeiro' USING ERRCODE = '42501';
  END IF;
  IF v_hoje < DATE '2026-12-01' THEN
    RAISE EXCEPTION 'As custas de 2027 entram em vigor em 01/12/2026';
  END IF;

  SELECT a.graduacao INTO v_graduacao FROM public.atletas a
   WHERE a.id = p_atleta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atleta não encontrado'; END IF;

  CASE
    WHEN p_tipo IN ('registro_dan','exame_dan','reconhecimento_dan') THEN
      SELECT t.fikarj, t.cnkb INTO v_fikarj, v_cnkb
        FROM (VALUES (1,500,200),(2,250,250),(3,250,300),(4,350,300),
                     (5,450,400),(6,650,450),(7,900,500)) AS t(grau,fikarj,cnkb)
       WHERE t.grau = p_grau_dan;
      IF NOT FOUND THEN RAISE EXCEPTION 'Informe o grau Dan de 1 a 7'; END IF;
    WHEN p_tipo IN ('primeiro_registro_dangai','diploma_dangai') THEN
      IF p_grau_dan IS NOT NULL THEN RAISE EXCEPTION 'Processo Dangai não tem grau Dan'; END IF;
      v_categoria := public.pag_categoria_anuidade(v_graduacao);
      CASE v_categoria
        WHEN '1kyu' THEN v_fikarj := CASE WHEN p_tipo = 'diploma_dangai' THEN 20 ELSE 75 END;
        WHEN 'kyu_10_2' THEN v_fikarj := CASE WHEN p_tipo = 'diploma_dangai' THEN 15 ELSE 55 END;
        ELSE RAISE EXCEPTION 'O processo Dangai exige uma graduação de faixa colorida';
      END CASE;
    ELSE RAISE EXCEPTION 'Tipo de processo inválido';
  END CASE;

  IF EXISTS (
    SELECT 1 FROM public.pag_processos_registro_2027 p
    JOIN public.pag_cobrancas c ON c.id = p.cobranca_id
    WHERE c.atleta_id = p_atleta AND NOT c.cancelada
      AND ((p.tipo = p_tipo AND p.grau_dan IS NOT DISTINCT FROM p_grau_dan)
           OR (p.tipo <> 'diploma_dangai' AND p_tipo <> 'diploma_dangai'))
  ) THEN RAISE EXCEPTION 'Já existe um processo ativo para este atleta com as mesmas inclusões'; END IF;

  IF p_tipo <> 'diploma_dangai' AND EXISTS (
    SELECT 1 FROM public.pag_cobrancas c
    WHERE c.atleta_id = p_atleta AND c.ano = 2027 AND NOT c.cancelada
      AND (c.tipo = 'anuidade_fikarj' OR (v_cnkb > 0 AND c.tipo = 'anuidade_cnkb'))
  ) THEN RAISE EXCEPTION 'Há uma anuidade independente ativa. Confira o histórico antes de abrir o processo'; END IF;

  IF p_tipo = 'diploma_dangai' AND NOT EXISTS (
    SELECT 1 FROM public.pag_v_anuidades_inclusas_2027 v
    WHERE v.atleta_id = p_atleta AND v.tipo = 'anuidade_fikarj'
      AND v.status = 'quitada_por_inclusao'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.pag_cobrancas c
    WHERE c.atleta_id = p_atleta AND c.ano = 2027 AND c.tipo = 'anuidade_fikarj'
      AND NOT c.cancelada AND c.valor_final <= (
        SELECT coalesce(sum(p.valor - coalesce(e.valor,0)),0)
        FROM public.pag_pagamentos p
        JOIN LATERAL (
          SELECT l.status FROM public.pag_pagamentos_conciliacao_log l
          WHERE l.pagamento_id = p.id ORDER BY l.ocorrido_em DESC,l.id DESC LIMIT 1
        ) conciliacao ON conciliacao.status = 'conciliado'
        LEFT JOIN public.pag_estornos e ON e.pagamento_id = p.id AND e.status = 'aprovado'
        WHERE p.cobranca_id = c.id
      )
  ) THEN RAISE EXCEPTION 'Confirme a regularidade da anuidade FIKARJ 2027 antes de abrir o diploma'; END IF;

  IF v_cnkb > 0 AND EXISTS (
    SELECT 1 FROM public.pag_cnkb_operacoes_2027 o
     WHERE o.atleta_id = p_atleta AND o.ano = 2027 AND o.modalidade = 'direto'
       AND o.cancelada_em IS NULL
  ) THEN RAISE EXCEPTION 'Há um pagamento direto à CNKB já registrado para este atleta'; END IF;

  INSERT INTO public.pag_cobrancas (
    atleta_id, tipo, ano, descricao, graduacao_ref, valor_bruto, valor_final, criado_por
  ) VALUES (
    p_atleta, p_tipo, 2027,
    CASE p_tipo
      WHEN 'registro_dan' THEN format('Registro %sº Dan', p_grau_dan)
      WHEN 'exame_dan' THEN format('Exame %sº Dan', p_grau_dan)
      WHEN 'reconhecimento_dan' THEN format('Reconhecimento %sº Dan', p_grau_dan)
      WHEN 'primeiro_registro_dangai' THEN 'Primeiro registro Dangai'
      ELSE 'Diploma Dangai'
    END,
    v_graduacao, v_fikarj + v_cnkb, v_fikarj + v_cnkb, auth.uid()::text
  ) RETURNING id INTO v_id;

  INSERT INTO public.pag_processos_registro_2027 (
    cobranca_id, tipo, grau_dan, fikarj_valor, cnkb_valor, registrado_por
  ) VALUES (v_id, p_tipo, p_grau_dan, v_fikarj, v_cnkb, auth.uid());
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pag_abrir_processo_registro_2027(bigint,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_abrir_processo_registro_2027(bigint,text,integer) TO authenticated;

CREATE FUNCTION public.pag_verificar_anuidade_inclusa_2027()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public.pag_processos_registro_2027 p WHERE p.cobranca_id = OLD.id
  ) THEN
    IF NEW.atleta_id IS DISTINCT FROM OLD.atleta_id OR NEW.ano IS DISTINCT FROM OLD.ano
        OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.valor_final IS DISTINCT FROM OLD.valor_final
        OR NEW.valor_bruto IS DISTINCT FROM OLD.valor_bruto OR (OLD.cancelada AND NOT NEW.cancelada) THEN
      RAISE EXCEPTION 'O valor e a identificação de um processo registrado são imutáveis';
    END IF;
    IF NEW.cancelada AND NOT OLD.cancelada AND EXISTS (
      SELECT 1 FROM public.pag_pagamentos p WHERE p.cobranca_id = OLD.id
        AND NOT EXISTS (SELECT 1 FROM public.pag_estornos e
                         WHERE e.pagamento_id = p.id AND e.status = 'aprovado' AND e.valor >= p.valor)
    ) THEN RAISE EXCEPTION 'Estorne os pagamentos antes de cancelar o processo'; END IF;
  END IF;
  IF NEW.ano = 2027 AND NOT NEW.cancelada
      AND NEW.tipo IN ('anuidade_fikarj','anuidade_cnkb') THEN
    PERFORM 1 FROM public.atletas a WHERE a.id = NEW.atleta_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.pag_processos_registro_2027 p
      JOIN public.pag_cobrancas c ON c.id = p.cobranca_id
      WHERE c.atleta_id = NEW.atleta_id AND NOT c.cancelada
        AND p.tipo <> 'diploma_dangai'
        AND (NEW.tipo = 'anuidade_fikarj' OR p.cnkb_valor > 0)
    ) THEN RAISE EXCEPTION 'Anuidade vinculada a processo ativo do exercício'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pag_verificar_anuidade_inclusa_2027() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pag_verificar_anuidade_inclusa_2027
  BEFORE INSERT OR UPDATE OF atleta_id, ano, tipo, cancelada, valor_final, valor_bruto ON public.pag_cobrancas
  FOR EACH ROW EXECUTE FUNCTION public.pag_verificar_anuidade_inclusa_2027();

CREATE VIEW public.pag_v_anuidades_inclusas_2027 WITH (security_invoker = true) AS
SELECT c.atleta_id, c.ano, m.tipo, c.id AS cobranca_id,
       CASE WHEN coalesce(pago.total,0) < c.valor_final THEN 'aguardando_confirmacao'
            WHEN m.tipo = 'anuidade_cnkb' THEN 'coberta_aguardando_cnkb'
            ELSE 'quitada_por_inclusao' END AS status
FROM public.pag_processos_registro_2027 r
JOIN public.pag_cobrancas c ON c.id = r.cobranca_id
CROSS JOIN LATERAL (VALUES ('anuidade_fikarj'), ('anuidade_cnkb')) m(tipo)
LEFT JOIN LATERAL (
  SELECT sum(p.valor - coalesce(e.valor,0)) AS total
    FROM public.pag_pagamentos p
    JOIN LATERAL (
      SELECT l.status FROM public.pag_pagamentos_conciliacao_log l
       WHERE l.pagamento_id = p.id ORDER BY l.ocorrido_em DESC,l.id DESC LIMIT 1
    ) conciliacao ON conciliacao.status = 'conciliado'
    LEFT JOIN public.pag_estornos e ON e.pagamento_id = p.id AND e.status = 'aprovado'
   WHERE p.cobranca_id = c.id
) pago ON true
WHERE NOT c.cancelada AND r.tipo <> 'diploma_dangai'
  AND (m.tipo = 'anuidade_fikarj' OR r.cnkb_valor > 0);
REVOKE ALL ON public.pag_v_anuidades_inclusas_2027 FROM PUBLIC, anon;
GRANT SELECT ON public.pag_v_anuidades_inclusas_2027 TO authenticated;
