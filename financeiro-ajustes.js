const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const situacoesEstorno = {
  sem_solicitacao: 'Sem solicitação',
  pendente: 'Pendente de decisão',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
};

function inserirOpcao(select, value, label) {
  const opcao = document.createElement('option');
  opcao.value = value;
  opcao.textContent = label;
  select.append(opcao);
}

function criarLinha(tabela, valores) {
  const linha = tabela.insertRow();
  for (const valor of valores) {
    const celula = linha.insertCell();
    celula.className = 'p-2';
    celula.textContent = valor ?? '—';
  }
  return linha;
}

export function iniciarAjustesFinanceiros(sb, podeOperar = true) {
  const raiz = document.getElementById('financeiroAjustes');
  if (!raiz || raiz.dataset.iniciado) return;
  raiz.dataset.iniciado = 'true';
  raiz.innerHTML = `
    <form data-ajuste="consulta" class="mb-3 flex flex-wrap items-end gap-2">
      <label>Matrícula <input class="inp" name="matricula" inputmode="numeric" pattern="[0-9]+" required maxlength="10"></label>
      <button type="submit" class="rounded bg-sky-700 px-3 py-2">Buscar pagamentos</button>
    </form>
    <p data-ajuste="status" role="status" class="mb-3"></p>
    <div data-ajuste="pagamentos" hidden>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">Pagamentos registrados</caption>
          <thead><tr><th>Pagamento</th><th>Atleta e cobrança</th><th>Data</th><th>Valor</th><th>Meio</th><th>Conciliação</th><th>Estorno</th></tr></thead>
          <tbody data-ajuste="pagamentoLinhas"></tbody>
        </table>
      </div>
      <form data-ajuste="conciliacao" class="my-4 space-y-2 border-t border-gray-700 pt-3">
        <h3 class="font-semibold">Registrar conciliação</h3>
        <label class="block">Pagamento <select name="pagamento" required class="inp"></select></label>
        <label class="block">Situação <select name="situacao" required class="inp">
          <option value="">Selecione</option><option value="conciliado">Conciliado</option><option value="divergente">Divergente</option><option value="pendente">Pendente</option>
        </select></label>
        <label class="block">Motivo ou referência <textarea name="motivo" class="inp" maxlength="500"></textarea></label>
        <button type="submit" class="rounded bg-sky-700 px-3 py-2">Salvar conciliação</button>
      </form>
      <form data-ajuste="solicitacao" class="my-4 space-y-2 border-t border-gray-700 pt-3">
        <h3 class="font-semibold">Solicitar estorno integral</h3>
        <label class="block">Pagamento <select name="pagamento" required class="inp"></select></label>
        <label class="block">Motivo <textarea name="motivo" class="inp" required maxlength="500"></textarea></label>
        <button type="submit" class="rounded bg-gray-700 px-3 py-2">Solicitar estorno</button>
      </form>
    </div>
    <section class="mt-4 space-y-2 border-t border-gray-700 pt-3">
      <h3 class="font-semibold">Solicitações de estorno</h3>
      <button type="button" data-ajuste="estornoAtualizar" class="rounded bg-gray-700 px-3 py-2">Consultar solicitações</button>
      <p data-ajuste="estornoStatus" role="status"></p>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">Solicitações de estorno integral</caption>
          <thead><tr><th>Pagamento</th><th>Valor</th><th>Motivo</th><th>Situação</th></tr></thead>
          <tbody data-ajuste="estornoLinhas"></tbody>
        </table>
      </div>
      <form data-ajuste="decisao" hidden class="my-4 space-y-2">
        <h4 class="font-semibold">Decisão da Presidência</h4>
        <label class="block">Solicitação <select name="solicitacao" required class="inp"></select></label>
        <label class="block">Decisão <select name="decisao" required class="inp">
          <option value="">Selecione</option><option value="aprovar">Aprovar estorno integral</option><option value="rejeitar">Rejeitar estorno</option>
        </select></label>
        <label class="block">Motivo <textarea name="motivo" class="inp" required maxlength="500"></textarea></label>
        <button type="submit" class="rounded bg-sky-700 px-3 py-2">Registrar decisão</button>
      </form>
    </section>
  `;
  const obter = (chave) => raiz.querySelector(`[data-ajuste="${chave}"]`);
  const consulta = obter('consulta');
  if (!podeOperar) {
    obter('conciliacao').hidden = true;
    obter('solicitacao').hidden = true;
  }
  const conciliacao = obter('conciliacao');
  const solicitacao = obter('solicitacao');
  const decisao = obter('decisao');
  const status = obter('status');
  const estornoStatus = obter('estornoStatus');

  async function rpc(nome, parametros) {
    const { data, error } = await sb.rpc(nome, parametros);
    if (error) throw new Error(error.message || 'A consulta ao Portal falhou.');
    return data;
  }

  function acao(elemento, evento, mensagem, executar) {
    elemento.addEventListener(evento, async (evt) => {
      evt.preventDefault();
      if (raiz.getAttribute('aria-busy') === 'true') return;
      raiz.setAttribute('aria-busy', 'true');
      const controles = [...raiz.querySelectorAll('button:not(:disabled)')];
      controles.forEach(botao => { botao.disabled = true; });
      mensagem.textContent = 'Aguarde…';
      try {
        mensagem.textContent = await executar();
      } catch (erro) {
        mensagem.textContent = erro.message || 'Não foi possível concluir a operação.';
      } finally {
        controles.forEach(botao => { botao.disabled = false; });
        raiz.removeAttribute('aria-busy');
      }
    });
  }
  function selecionar(select, pagamentos) {
    select.replaceChildren();
    inserirOpcao(select, '', 'Selecione');
    for (const pagamento of pagamentos) {
      inserirOpcao(select, pagamento.pagamento_id,
        pagamento.pagamento_id + ' · ' + moeda.format(pagamento.valor) + ' · ' + (pagamento.data_pagamento ?? ''));
    }
  }

  async function consultarPagamentos(matricula) {
    obter('pagamentos').hidden = true;
    const { data: linhas, error } = await sb.from('pag_v_pagamentos_conciliacao')
      .select('pagamento_id,atleta_nome,descricao,valor,data_pagamento,forma,conciliacao_status,conciliacao_motivo')
      .eq('registro', Number(matricula)).order('data_pagamento', { ascending: false }).order('pagamento_id', { ascending: false });
    if (error) throw new Error(error.message || 'A consulta ao Portal falhou.');
    const estornos = await rpc('pag_estornos_listar', { p_registro: Number(matricula) }).then(pagamentos =>
      new Map(pagamentos.map(pagamento => [String(pagamento.pagamento_id), pagamento.estorno_status])));
    const tabela = obter('pagamentoLinhas');
    tabela.replaceChildren();
    for (const linha of linhas) {
      criarLinha(tabela, [linha.pagamento_id, [linha.atleta_nome, linha.descricao].filter(Boolean).join(' · '), linha.data_pagamento, moeda.format(linha.valor),
        linha.forma, [linha.conciliacao_status, linha.conciliacao_motivo].filter(Boolean).join(' · '),
        situacoesEstorno[estornos.get(String(linha.pagamento_id))]]);
    }
    selecionar(conciliacao.elements.pagamento, linhas.filter(linha => estornos.get(String(linha.pagamento_id)) !== 'aprovado'));
    selecionar(solicitacao.elements.pagamento, linhas.filter(linha => ['sem_solicitacao', 'recusado'].includes(estornos.get(String(linha.pagamento_id)))));
    obter('pagamentos').hidden = linhas.length === 0;
    return linhas.length ? linhas.length + ' pagamento(s) encontrado(s).' : 'Nenhum pagamento encontrado.';
  }

  async function consultarEstornos() {
    decisao.hidden = true;
    const linhas = await rpc('pag_estornos_listar', { p_somente_solicitacoes: true });
    const tabela = obter('estornoLinhas');
    tabela.replaceChildren();
    decisao.elements.solicitacao.replaceChildren();
    inserirOpcao(decisao.elements.solicitacao, '', 'Selecione');
    for (const linha of linhas) {
      criarLinha(tabela, [linha.pagamento_id, moeda.format(linha.valor), linha.motivo ?? linha.motivo_solicitacao, situacoesEstorno[linha.estorno_status]]);
      if (linha.estorno_status === 'pendente' && linha.pode_decidir === true) {
        inserirOpcao(decisao.elements.solicitacao, linha.id,
          linha.pagamento_id + ' · ' + moeda.format(linha.valor));
      }
    }
    decisao.hidden = decisao.elements.solicitacao.options.length < 2;
    return linhas.length ? linhas.length + ' solicitação(ões) encontrada(s).' : 'Nenhum estorno solicitado.';
  }

  async function refrescar(lista, consultar) {
    try {
      lista.textContent = await consultar();
    } catch (erro) {
      lista.textContent = 'Atualize a consulta para conferir os dados.';
    }
  }

  let matriculaConsultada = '';
  acao(consulta, 'submit', status, async () => {
    matriculaConsultada = consulta.elements.matricula.value.trim();
    if (!matriculaConsultada) throw new Error('Informe a matrícula.');
    return consultarPagamentos(matriculaConsultada);
  });
  acao(conciliacao, 'submit', status, async () => {
    const motivo = conciliacao.elements.motivo.value.trim();
    if (conciliacao.elements.situacao.value === 'divergente' && !motivo) throw new Error('Informe o motivo da divergência.');
    await rpc('pag_conciliar_pagamento', {
      p_pagamento_id: conciliacao.elements.pagamento.value,
      p_status: conciliacao.elements.situacao.value,
      p_motivo: motivo || null,
    });
    conciliacao.reset();
    await refrescar(status, () => consultarPagamentos(matriculaConsultada));
    return 'Conciliação registrada. ' + status.textContent;
  });
  acao(solicitacao, 'submit', estornoStatus, async () => {
    const motivo = solicitacao.elements.motivo.value.trim();
    if (!motivo) throw new Error('Informe o motivo do estorno.');
    await rpc('pag_estorno_solicitar', { p_pagamento_id: solicitacao.elements.pagamento.value, p_motivo: motivo });
    solicitacao.reset();
    await refrescar(estornoStatus, consultarEstornos);
    if (matriculaConsultada) await refrescar(status, () => consultarPagamentos(matriculaConsultada));
    return 'Solicitação de estorno registrada. ' + estornoStatus.textContent;
  });
  acao(obter('estornoAtualizar'), 'click', estornoStatus, consultarEstornos);
  acao(decisao, 'submit', estornoStatus, async () => {
    const motivo = decisao.elements.motivo.value.trim();
    if (!motivo) throw new Error('Informe o motivo da decisão.');
    const aprovar = decisao.elements.decisao.value === 'aprovar';
    if (aprovar && !window.confirm('Confirma o estorno integral deste pagamento?')) return 'Decisão cancelada.';
    await rpc('pag_estorno_decidir', { p_id: decisao.elements.solicitacao.value, p_aprovar: aprovar, p_motivo: motivo });
    decisao.reset();
    await refrescar(estornoStatus, consultarEstornos);
    if (matriculaConsultada) await refrescar(status, () => consultarPagamentos(matriculaConsultada));
    return 'Decisão registrada. ' + estornoStatus.textContent;
  });
}
