CREATE TABLE public.pag_descontos_autorizados_2027 (
  atleta_id bigint PRIMARY KEY REFERENCES public.atletas(id),
  categoria text NOT NULL CHECK (categoria IN ('preta','1kyu','kyu_10_2')),
  valor numeric NOT NULL CHECK (valor IN (90,50,40)),
  final_evento_id bigint NOT NULL REFERENCES public.pag_eventos(id),
  final_data date NOT NULL CHECK (final_data = DATE '2026-12-06'),
  campeonatos integer NOT NULL,
  atuacoes integer NOT NULL,
  justificativa text NOT NULL,
  autorizado_por uuid NOT NULL,
  autorizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pag_descontos_autorizados_2027 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pag_descontos_autorizados_2027 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pag_descontos_autorizados_2027 TO authenticated;
CREATE POLICY descontos_consulta_financeira ON public.pag_descontos_autorizados_2027
  FOR SELECT TO authenticated USING (public.pag_pode_editar());

CREATE FUNCTION public.pag_autorizar_desconto_2027(
  p_atleta bigint, p_final bigint, p_justificativa text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_grau record;
  v_categoria text;
  v_valor numeric;
  v_total integer;
  v_atuacoes integer;
  v_final date;
BEGIN
  IF NOT coalesce(public.is_admin(), false) OR NOT EXISTS (
    SELECT 1 FROM fikarj_protocolos.assinatura_presidencia WHERE titular = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Acesso restrito à Presidência' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_justificativa), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa da conferência';
  END IF;

  SELECT public.pag_categoria_anuidade(a.graduacao)
    INTO v_categoria FROM public.atletas a WHERE id = p_atleta FOR UPDATE;
  SELECT * INTO v_grau FROM public.pag_grau(
    (SELECT graduacao FROM public.atletas WHERE id = p_atleta)
  );
  v_valor := CASE
    WHEN v_grau.nivel = 'dan' THEN 90
    WHEN v_grau.nivel = 'kyu' AND v_grau.numero = 1 THEN 50
    WHEN v_grau.nivel = 'kyu' AND v_grau.numero BETWEEN 2 AND 5 THEN 40
  END;
  IF v_valor IS NULL THEN RAISE EXCEPTION 'Graduação fora das categorias de desconto'; END IF;

  SELECT e.data INTO v_final FROM public.pag_eventos e
   WHERE e.id = p_final AND e.tipo = 'campeonato' AND e.conta_para_desconto
     AND e.data = DATE '2026-12-06' AND e.local ILIKE '%Volta Redonda%';
  IF v_final IS NULL OR v_final > (now() AT TIME ZONE 'America/Sao_Paulo')::date
      OR NOT EXISTS (
        SELECT 1 FROM public.pag_atuacoes a
         WHERE a.evento_id = p_final AND a.atleta_id = p_atleta
           AND a.funcao = CASE WHEN v_valor = 90 THEN 'arbitro' ELSE 'mesario' END
      ) THEN
    RAISE EXCEPTION 'Atuação na final de Volta Redonda sem confirmação';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.pag_atuacoes a
     WHERE a.evento_id = e.id AND a.atleta_id = p_atleta
       AND a.funcao = CASE WHEN v_valor = 90 THEN 'arbitro' ELSE 'mesario' END
  )) INTO v_total, v_atuacoes
    FROM public.pag_eventos e
   WHERE e.tipo = 'campeonato' AND e.conta_para_desconto
     AND e.data >= DATE '2026-01-01' AND e.data < DATE '2027-01-01';
  IF v_atuacoes * 2 < v_total THEN
    RAISE EXCEPTION 'Atuação inferior a 50%% dos campeonatos';
  END IF;
  INSERT INTO public.pag_descontos_autorizados_2027 (
    atleta_id, categoria, valor, final_evento_id, final_data,
    campeonatos, atuacoes, justificativa, autorizado_por
  ) VALUES (
    p_atleta, v_categoria, v_valor, p_final, v_final,
    v_total, v_atuacoes, btrim(p_justificativa), auth.uid()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.pag_autorizar_desconto_2027(bigint,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_autorizar_desconto_2027(bigint,bigint,text) TO authenticated;
-- Atualiza o cálculo para novas operações do exercício de 2027.
-- Os lançamentos e parâmetros históricos permanecem disponíveis.
CREATE OR REPLACE FUNCTION public.pag_calcular_anuidade(
  p_atleta bigint, p_tipo text, p_ano integer, p_data date,
  OUT categoria text, OUT valor_bruto numeric, OUT desconto_pct numeric,
  OUT desconto_motivo text, OUT valor_final numeric, OUT vencimento date
)
RETURNS record
LANGUAGE plpgsql STABLE
SET search_path TO ''
AS $function$
DECLARE
  d record;
BEGIN
  categoria := public.pag_categoria_anuidade(
    (SELECT graduacao FROM public.atletas WHERE id = p_atleta)
  );
  IF categoria IS NULL THEN
    RAISE EXCEPTION 'Graduação do atleta % não reconhecida', p_atleta;
  END IF;
  IF p_tipo = 'anuidade_cnkb' AND categoria <> 'preta' THEN
    RAISE EXCEPTION 'Anuidade CNKB é só para faixas pretas';
  END IF;

  desconto_pct := 0;
  IF p_ano = 2027 AND p_data >= DATE '2026-12-01'
      AND p_tipo IN ('anuidade_fikarj', 'anuidade_cnkb') THEN
    IF p_tipo = 'anuidade_cnkb' THEN
      valor_bruto := CASE
        WHEN p_data <= DATE '2026-12-15' THEN 170
        WHEN p_data <= DATE '2027-01-15' THEN 200
        ELSE 220
      END;
      vencimento := DATE '2027-03-31';
    ELSE
      valor_bruto := CASE categoria
        WHEN 'preta' THEN 150
        WHEN '1kyu' THEN 75
        WHEN 'kyu_10_2' THEN 55
      END;
      vencimento := DATE '2027-02-28';
      SELECT a.valor INTO valor_final
        FROM public.pag_descontos_autorizados_2027 a
       WHERE a.atleta_id = p_atleta AND a.categoria = pag_calcular_anuidade.categoria
         AND p_data >= a.final_data;
      IF FOUND THEN
        desconto_motivo := 'Desconto de arbitragem ou mesa autorizado pela Presidência';
        desconto_pct := (valor_bruto - valor_final) * 100 / valor_bruto;
        RETURN;
      END IF;
    END IF;
  ELSE
    SELECT t.valor INTO valor_bruto
      FROM public.pag_tabela_valores t
     WHERE t.ano = p_ano AND t.tipo = p_tipo
       AND t.categoria = pag_calcular_anuidade.categoria
     ORDER BY (t.valido_ate >= p_data) DESC,
       CASE WHEN t.valido_ate >= p_data THEN t.valido_ate END ASC,
       t.valido_ate DESC
     LIMIT 1;

    SELECT max(t.valido_ate) INTO vencimento
      FROM public.pag_tabela_valores t
     WHERE t.ano = p_ano AND t.tipo = p_tipo
       AND t.categoria = pag_calcular_anuidade.categoria;

    IF p_tipo = 'anuidade_fikarj' AND valor_bruto IS NOT NULL THEN
      SELECT x.pct, x.motivo INTO d FROM public.pag_desconto(p_atleta, p_ano) x;
      desconto_pct := d.pct;
      desconto_motivo := d.motivo;
    END IF;
  END IF;

  IF valor_bruto IS NULL THEN
    RAISE EXCEPTION 'Sem valor cadastrado para % % %', p_tipo, categoria, p_ano;
  END IF;
  valor_final := round(valor_bruto * (1 - desconto_pct / 100), 2);
END;
$function$;
