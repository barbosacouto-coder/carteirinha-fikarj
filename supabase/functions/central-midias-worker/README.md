# Broker restrito da fila editorial

Preparação local; **não implantado nem ativado** por esta alteração.

O GitHub recebe um token próprio, que permite apenas retirar uma entrega aprovada
e registrar seu resultado com o lease correspondente. A chave `service_role` fica
no ambiente servidor do Supabase. Nenhum novo GRANT ou papel de banco é necessário.

## Contrato

POST JSON, header `x-fikarj-worker-key`, sem CORS para clientes web.

- `{ "operation": "claim" }`: chama exclusivamente `central_midias_worker_claim(1)`.
- `operation=finalize`: aceita apenas `destination_id`, `lease_token`, `result`,
  `external_id` e `error`; chama exclusivamente a RPC de finalização.
- Valores inválidos, campos extras, token incorreto e métodos distintos são rejeitados.
- A função não publica na Meta e não permite escolher nomes de RPC, SQL ou tabelas.
- A autenticação do broker não substitui o lease: a RPC continua validando prazo e estado.

## Antes da implantação

1. Rever código e executar `node --test tests/central-midias-broker.test.mjs`.
2. Rodar `tests/central-midias-fila-isolada.sql` somente em banco local vazio descartável.
3. Configurar `CENTRAL_MIDIAS_BROKER_TOKEN` com valor aleatório criptográfico de pelo
   menos 32 caracteres, exclusivamente no secret da Edge Function e no secret GitHub
   de mesmo nome. Não colocar em comandos, logs, repositório, navegador ou chat.
4. A função usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` fornecidos no ambiente
   servidor. Não transferir esta chave ao GitHub.
5. O gateway precisa permitir o token próprio: implantação explícita com verificação
   JWT da plataforma desativada **apenas para esta função**, mantendo a validação
   obrigatória do header no handler. Confirmar opção da CLI atual antes de executar.
6. Configurar variável GitHub `CENTRAL_MIDIAS_BROKER_URL` com a URL HTTPS da função
   no projeto institucional. O worker rejeita outros caminhos/hosts e configuração parcial.
7. Repetir validação autenticada após implantar em ambiente de homologação.
   HTTP local já passou no Edge Runtime real com fila simulada; integração Edge →
   PostgREST real continua pendente. As RPCs foram testadas separadamente no PostgreSQL local.
8. Manter `CENTRAL_MIDIAS_ALLOW_PUBLICATION` desligada até revisão de fila e pauta
   institucional aprovada. Não publicar as fixtures.

O token do broker tem menos autoridade que `service_role`, mas pode retirar itens e
registrar resultados da fila; acesso ao GitHub Actions e ao token deve permanecer
restrito. Uma falha de finalização após publicação exige reconciliação, não repetição.

## Testes executados

- 6 testes Node de autenticação, RPC fixa, validação, erros sem segredo e tamanho.
- Teste SQL local revertido: grants, lease errado, finalização duplicada,
  destino distinto, expiração em resultado incerto e preservação do recibo.
- 18 testes Python do publicador/contrato, incluindo modo broker sem chave de banco.
- HTTP local em `supabase/edge-runtime:v1.77.4`, digest
  `sha256:ad45164b7548bf5820ed7be714789c17ac2865edce79a09cfb4c3756c3d365a8`:
  token incorreto 401, claim/finalize autenticados, segundo claim vazio, publicação
  simulada uma única vez. O adaptador de teste bloqueia todas as chamadas externas.
  Container descartável removido ao terminar. Banco/Meta no teste HTTP são simulados.

O modo direto antigo do worker permanece para compatibilidade, mas o workflow usa
somente variáveis/segredo do broker. A publicação automática permanece desativada.
