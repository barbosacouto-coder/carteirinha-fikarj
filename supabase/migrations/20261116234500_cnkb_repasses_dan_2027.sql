-- O repasse de processo Dan acompanha a cobrança, inclusive quando houve parcelas.
CREATE FUNCTION public.pag_cnkb_vincular_dan_2027(p_cobranca bigint, p_referencia text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c record;
  v_ultimo date;
  v_id bigint;
BEGIN
  IF v_uid IS NULL OR NOT coalesce(public.pag_pode_editar(), false) THEN
    RAISE EXCEPTION 'Sem permissão para registrar repasse Dan' USING ERRCODE = '42501';
  END IF;
  SELECT c.atleta_id, p.cnkb_valor INTO v_c FROM public.pag_cobrancas c
    JOIN public.pag_processos_registro_2027 p ON p.cobranca_id = c.id
   WHERE c.id = p_cobranca AND c.ano = 2027 AND NOT c.cancelada AND p.cnkb_valor > 0
   FOR UPDATE OF c;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.pag_v_anuidades_inclusas_2027 a
     WHERE a.cobranca_id = p_cobranca AND a.tipo = 'anuidade_cnkb'
       AND a.status IN ('coberta_aguardando_cnkb','quitada_por_inclusao')
  ) THEN RAISE EXCEPTION 'A cobrança Dan precisa estar integralmente quitada e conciliada'; END IF;

  SELECT max(p.data_pagamento) INTO v_ultimo FROM public.pag_pagamentos p
   WHERE p.cobranca_id = p_cobranca AND NOT EXISTS (
     SELECT 1 FROM public.pag_estornos e WHERE e.pagamento_id = p.id AND e.status = 'aprovado'
   );
  INSERT INTO public.pag_cnkb_operacoes_2027 (
    atleta_id, ano, modalidade, processo_cobranca_id, valor, data_pagamento,
    forma, pagador, comprovante_ref, registrado_por
  ) VALUES (v_c.atleta_id,2027,'processo_dan',p_cobranca,v_c.cnkb_valor,v_ultimo,
            NULL,'Pagamentos vinculados ao processo Dan',btrim(p_referencia),v_uid)
  RETURNING id INTO v_id;
  INSERT INTO public.pag_cnkb_historico_2027 (operacao_id,acao,data_efetiva,referencia,responsavel)
  VALUES (v_id,'conferida',(now() AT TIME ZONE 'America/Sao_Paulo')::date,btrim(p_referencia),v_uid);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pag_cnkb_vincular_dan_2027(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pag_cnkb_vincular_dan_2027(bigint,text) TO authenticated;


CREATE OR REPLACE VIEW public.pag_v_anuidades_inclusas_2027 WITH (security_invoker = true) AS
SELECT c.atleta_id, c.ano, m.tipo, c.id AS cobranca_id,
       CASE WHEN coalesce(pago.total,0) < c.valor_final THEN 'aguardando_confirmacao'
            WHEN m.tipo = 'anuidade_cnkb' AND cnkb.situacao IS DISTINCT FROM 'confirmada' THEN 'coberta_aguardando_cnkb'
            ELSE 'quitada_por_inclusao' END AS status
FROM public.pag_processos_registro_2027 r
JOIN public.pag_cobrancas c ON c.id = r.cobranca_id
LEFT JOIN public.pag_v_cnkb_operacoes_2027 cnkb ON cnkb.processo_cobranca_id = c.id
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
