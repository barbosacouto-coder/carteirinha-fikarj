-- O recebimento e o estorno pertencem às respectivas datas de caixa.
CREATE VIEW public.pag_v_movimentos_caixa WITH (security_invoker = true) AS
SELECT p.id AS movimento_id, p.id AS pagamento_id, p.cobranca_id,
       'pagamento'::text AS natureza, p.data_pagamento AS data, p.valor, p.forma
  FROM public.pag_pagamentos p
UNION ALL
SELECT e.id, p.id, p.cobranca_id, 'estorno'::text,
       (e.decidido_em AT TIME ZONE 'America/Sao_Paulo')::date, -e.valor, p.forma
  FROM public.pag_estornos e
  JOIN public.pag_pagamentos p ON p.id = e.pagamento_id
 WHERE e.status = 'aprovado';

REVOKE ALL ON public.pag_v_movimentos_caixa FROM PUBLIC, anon;
GRANT SELECT ON public.pag_v_movimentos_caixa TO authenticated;
