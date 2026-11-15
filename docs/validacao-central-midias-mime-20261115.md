# Validação da restrição MIME — Central de Mídias

Data: 15/11/2026.

## Mudança

O formulário e o worker agora concordam: carrossel usa 2–10 JPEG; Reel usa um MP4. A migração nova substitui apenas a função de transição para rejeitar carrossel incompatível na aprovação e no agendamento. Não altera os rascunhos existentes, histórico nem permissões.

Migração gerada por `npx --yes supabase@3.1.0 migration new central_midias_validar_mime_aprovacao`:
`supabase/migrations/20261115203002_central_midias_validar_mime_aprovacao.sql`.

## Testes executados

- PostgreSQL Supabase local: container `supabase_db_fikarj-restauracao`, WSL `FIKARJ-Restauracao`.
- Database temporária vazia `central_midias_test`, independente das bases de restauração.
- `tests/central-midias-mime-isolado.sql` aplicou a migração base e a nova dentro de BEGIN/ROLLBACK.
- Identidade/admin simulados por funções locais; nenhuma credencial real utilizada.
- Bloqueou aprovação de carrossel JPEG+MP4 sem alterar status ou auditoria.
- Bloqueou agendamento de carrossel misto previamente aprovado, sem alterar destino.
- Aceitou carrossel JPEG válido e Reel MP4 com Instagram e Facebook.
- Conferiu trilha de auditoria, privilégios da função preservados, rejeição de versão obsoleta e não-admin.
- Resultado: PASS. Após ROLLBACK, `to_regclass('public.central_midias_itens') IS NULL` retornou true. Database temporária removida.
- Formulário: `node --check` e quatro verificações isoladas de JPEG/MP4 e rejeições passaram.
- Worker: 10 testes offline passaram, incluindo gate, MIME, falha e resultado incerto sem retry.

## Limites

Não aplicada à produção. Não houve publicação em redes. O teste local usa stubs de identidade e valida a permanência da proteção administrativa existente; não substitui teste com sessões reais do Portal. Validação de codec/arquivo pela Meta segue separada.
