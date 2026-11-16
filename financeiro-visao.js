const dinheiroBR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
const LIMITE_PAGINA = 1000;
const ITENS_POR_PAGINA = 50;

const STATUS = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  inadimplente: 'Vencida',
  cancelada: 'Cancelada',
};

const escapar = valor => String(valor ?? '').replace(/[&<>"']/g, caractere => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[caractere]));

const centavos = valor => Math.round((Number(valor) || 0) * 100);
const reais = valor => dinheiroBR.format((Number(valor) || 0));

function dataFormatada(valor) {
  if (!valor) return '—';
  const pedacos = String(valor).slice(0, 10).split('-').map(Number);
  if (pedacos.length !== 3 || pedacos.some(Number.isNaN)) return '—';
  return dataBR.format(new Date(Date.UTC(pedacos[0], pedacos[1] - 1, pedacos[2], 12)));
}

function tipoExibido(cobranca, eventos) {
  const evento = eventos.get(String(cobranca.evento_id));
  if (evento) return evento.tipo === 'curso' ? 'Curso' : 'Evento';
  const tipos = {
    anuidade_fikarj: 'Anuidade FIKARJ', anuidade_cnkb: 'Anuidade CNKB',
    fikarj: 'Anuidade FIKARJ', cnkb: 'Anuidade CNKB', exame_dan: 'Exame Dan',
    registro_dan: 'Registro Dan', reconhecimento_dan: 'Reconhecimento Dan',
    registro_dangai: 'Registro Dangai', diploma_dangai: 'Diploma Dangai',
  };
  return tipos[cobranca.tipo] || cobranca.tipo || 'Outro';
}

async function carregarTudo(sb) {
  const consultas = await Promise.all([
    sb.from('pag_eventos').select('id,nome,tipo,data').order('data', { ascending: false }),
    carregarCobrancas(sb),
    carregarPaginado(() => sb.from('pag_v_movimentos_caixa')
      .select('movimento_id,pagamento_id,cobranca_id,natureza,data,valor,forma')
      .order('data').order('natureza').order('movimento_id')),
    carregarPaginado(() => sb.from('pag_v_cnkb_operacoes_2027')
      .select('id,atleta_id,ano,modalidade,valor,data_pagamento,conferencia,repasse_data,confirmacao_data,situacao').order('id')),
    carregarPaginado(() => sb.from('pag_v_anuidades_inclusas_2027')
      .select('atleta_id,ano,tipo,cobranca_id,status').order('cobranca_id').order('tipo')),
    carregarPaginado(() => sb.from('pag_v_anuidades_2027')
      .select('atleta_id,registro,nome,associacao,categoria').order('atleta_id')),
    carregarPaginado(() => sb.from('associacoes').select('sigla,nome').order('sigla')),
  ]);
  const [eventosResposta, cobrancas, movimentos, cnkb, inclusoes, atletas, associacoes] = consultas;
  if (eventosResposta.error) throw eventosResposta.error;
  return {
    eventos: new Map((eventosResposta.data || []).map(evento => [String(evento.id), evento])),
    cobrancas, movimentos, cnkb, inclusoes, atletas, associacoes,
  };
}

function carregarCobrancas(sb) {
  return carregarPaginado(() => sb.from('pag_v_cobrancas')
    .select('id,atleta_id,tipo,ano,evento_id,descricao,valor_final,vencimento,cancelada,criado_em,atleta_nome,associacao,valor_pago,saldo,status,ultimo_pagamento')
    .order('criado_em', { ascending: false })
    .order('id', { ascending: false }));
}

async function carregarPaginado(consulta) {
  const resultado = [];
  for (let inicio = 0; ; inicio += LIMITE_PAGINA) {
    const { data, error } = await consulta().range(inicio, inicio + LIMITE_PAGINA - 1);
    if (error) throw error;
    resultado.push(...(data || []));
    if (!data || data.length < LIMITE_PAGINA) return resultado;
  }
}

export function codificarFinanceiroCsv(linhas) {
  return '\uFEFF' + linhas.map(linha => linha.map(valor => {
    let texto = String(valor ?? '');
    if (typeof valor === 'string' && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(texto)) texto = "'" + texto;
    return '"' + texto.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n');
}

function baixarCsv(nome, linhas) {
  const url = URL.createObjectURL(new Blob([codificarFinanceiroCsv(linhas)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function iniciarVisaoFinanceira(sb, container) {
  if (!container || !sb) return;

  container.innerHTML = `
    <section class="space-y-4" aria-label="Resumo financeiro">
      <div class="flex flex-wrap items-end gap-3">
        <label class="grid gap-1 text-sm">Buscar filiado ou descrição
          <input data-filtro="busca" type="search" autocomplete="off" placeholder="Nome, associação ou descrição" class="rounded border border-gray-500 bg-slate-900 px-3 py-2 text-white">
        </label>
        <label class="grid gap-1 text-sm">Tipo
          <select data-filtro="tipo" class="rounded border border-gray-500 bg-slate-900 px-3 py-2 text-white"><option value="">Todos</option></select>
        </label>
        <label class="grid gap-1 text-sm">Situação
          <select data-filtro="status" class="rounded border border-gray-500 bg-slate-900 px-3 py-2 text-white"><option value="">Todas</option>
            <option value="pendente">Pendente</option><option value="parcial">Parcial</option><option value="pago">Pago</option><option value="inadimplente">Vencida</option><option value="cancelada">Cancelada</option>
          </select>
        </label>
        <label class="grid gap-1 text-sm">Evento ou curso
          <select data-filtro="evento" class="max-w-xs rounded border border-gray-500 bg-slate-900 px-3 py-2 text-white"><option value="">Todos</option></select>
        </label>
        <label class="grid gap-1 text-sm">Competência
          <select data-filtro="ano" class="rounded border border-gray-500 bg-slate-900 px-3 py-2 text-white"><option value="">Todos</option></select>
        </label>
        <button type="button" data-acao="atualizar" class="rounded bg-sky-700 px-4 py-2 font-semibold text-white hover:bg-sky-600">Atualizar</button>
        <button type="button" data-acao="csv-competencia" disabled class="rounded border border-slate-600 px-3 py-2">Exportar cobranças (CSV)</button>
      </div>

      <p data-papel="status" role="status" aria-live="polite" class="text-sm text-slate-300">Abra a seção para consultar o financeiro.</p>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Cobranças ativas</p><strong data-total="quantidade" class="text-xl">—</strong></article>
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Valor lançado</p><strong data-total="lancado" class="text-xl">—</strong></article>
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Pagamentos lançados na competência</p><strong data-total="recebido" class="text-xl">—</strong></article>
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Em aberto</p><strong data-total="aberto" class="text-xl">—</strong></article>
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Saldo vencido</p><strong data-total="vencido" class="text-xl">—</strong></article>
      </div>

      <div class="overflow-x-auto rounded border border-slate-700">
        <table class="min-w-full text-left text-sm">
          <thead class="bg-slate-800 text-slate-200"><tr>
            <th class="p-2">Filiado</th><th class="p-2">Cobrança</th><th class="p-2">Evento / curso</th><th class="p-2">Vencimento</th><th class="p-2">Situação</th><th class="p-2 text-right">Lançado</th><th class="p-2 text-right">Pago</th><th class="p-2 text-right">Saldo</th>
          </tr></thead>
          <tbody data-papel="linhas" class="divide-y divide-slate-700"></tbody>
        </table>
      </div>
      <div class="flex items-center justify-between gap-3 text-sm">
        <span data-papel="contagem" class="text-slate-300"></span>
        <div class="flex gap-2"><button type="button" data-acao="anterior" class="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">Anterior</button><button type="button" data-acao="proxima" class="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">Próxima</button></div>
      </div>
      <details class="rounded border border-slate-700 p-3">
        <summary>Movimentos registrados por data de caixa</summary>
        <div class="my-3 flex flex-wrap items-end gap-3">
          <label class="grid gap-1 text-sm">Ano de caixa
            <select data-filtro="caixa" class="rounded border border-gray-500 bg-slate-900 px-3 py-2 text-white"><option value="">Todos</option></select>
          </label>
          <button type="button" data-acao="csv-caixa" disabled class="rounded border border-slate-600 px-3 py-2">Exportar movimentos (CSV)</button>
        </div>
        <p data-papel="caixa" class="text-sm" aria-live="polite">—</p>
        <p class="mt-2 text-sm text-slate-300">Este quadro considera pagamentos e estornos registrados. Valores vinculados a CNKB e Dan aparecem agrupados para conferência.</p>
      </details>
      <details class="rounded border border-slate-700 p-3">
        <summary>Operações CNKB, anuidades incluídas e alvarás</summary>
        <div class="my-3 flex flex-wrap gap-2">
          <button type="button" data-acao="csv-cnkb" disabled class="rounded border border-slate-600 px-3 py-2">Exportar operações CNKB (CSV)</button>
          <button type="button" data-acao="csv-inclusoes" disabled class="rounded border border-slate-600 px-3 py-2">Exportar anuidades incluídas (CSV)</button>
          <button type="button" data-acao="csv-alvaras" disabled class="rounded border border-slate-600 px-3 py-2">Exportar conferência dos alvarás (CSV)</button>
        </div>
        <p data-papel="cnkb" class="my-2 text-sm" aria-live="polite">—</p>
        <p class="mt-2 text-sm text-slate-300">O relatório de alvarás usa a evidência financeira disponível de 2026 e 2027. Pendências podem refletir ausência de dados. A conferência e a emissão cabem à administração.</p>
        <div class="mt-2 overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead><tr><th class="p-2">Associação</th><th class="p-2">Faixas pretas</th><th class="p-2">FIKARJ 2026 comprovada*</th><th class="p-2">CNKB 2026 registrada*</th><th class="p-2">Coloridas em dia 2027</th><th class="p-2">Conferência</th></tr></thead>
            <tbody data-papel="alvaras"></tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-slate-300">* Entre faixas pretas vinculadas, conforme cobranças registradas no Financeiro. A regularidade junto à CNKB exige confirmação administrativa.</p>
      </details>
    </section>`;

  const campo = nome => container.querySelector(`[data-filtro="${nome}"]`);
  const linhasEl = container.querySelector('[data-papel="linhas"]');
  const statusEl = container.querySelector('[data-papel="status"]');
  const botaoAnterior = container.querySelector('[data-acao="anterior"]');
  const botaoProxima = container.querySelector('[data-acao="proxima"]');
  const paginaEl = container.querySelector('[data-papel="contagem"]');
  let dados = { cobrancas: [], movimentos: [], cnkb: [], inclusoes: [], atletas: [], associacoes: [], eventos: new Map() };
  let pagina = 0;
  let carregada = false;
  let emCurso = false;
  let pedidoAtual = 0;

  function filtrar() {
    const busca = campo('busca').value.trim().toLocaleLowerCase('pt-BR');
    const tipo = campo('tipo').value;
    const status = campo('status').value;
    const evento = campo('evento').value;
    const ano = campo('ano').value;
    return dados.cobrancas.filter(c => {
      const ev = dados.eventos.get(String(c.evento_id));
      const haystack = [c.atleta_nome, c.associacao, c.descricao, ev?.nome].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      const tipoItem = tipoExibido(c, dados.eventos);
      const anoItem = c.ano || ev?.data?.slice(0, 4) || '';
      return (!busca || haystack.includes(busca))
        && (!tipo || tipoItem === tipo)
        && (!status || c.status === status)
        && (!evento || String(c.evento_id || '') === evento)
        && (!ano || String(anoItem) === ano);
    });
  }

  function filtrarCaixa(cobrancas) {
    const porId = new Map(cobrancas.map(c => [String(c.id), c]));
    const anoCaixa = campo('caixa').value;
    return dados.movimentos.flatMap(movimento => {
      const cobranca = porId.get(String(movimento.cobranca_id));
      if (!cobranca || (anoCaixa && movimento.data?.slice(0, 4) !== anoCaixa)) return [];
      return [{ movimento, cobranca }];
    });
  }

  function conferenciasAlvaras() {
    const pagas = new Set(dados.cobrancas.filter(item => !item.cancelada && item.status === 'pago')
      .map(item => `${item.atleta_id}:${item.ano}:${item.tipo}`));
    const incluidas = new Set(dados.inclusoes.filter(item =>
      item.tipo === 'anuidade_fikarj' && item.status === 'quitada_por_inclusao')
      .map(item => `${item.atleta_id}:${item.ano}:${item.tipo}`));
    const atletas = new Map(dados.atletas.map(item => [String(item.atleta_id), item]));
    return dados.associacoes.map(associacao => {
      const vinculados = [...atletas.values()].filter(item => item.associacao === associacao.sigla);
      const pretas = vinculados.filter(item => item.categoria === 'preta');
      const cor = vinculados.filter(item => ['kyu_10_2', '1kyu'].includes(item.categoria));
      const fikarj = pretas.filter(item => pagas.has(`${item.atleta_id}:2026:anuidade_fikarj`)).length;
      const cnkb = pretas.filter(item => pagas.has(`${item.atleta_id}:2026:anuidade_cnkb`)).length;
      const coloridas = cor.filter(item => {
        const chave = `${item.atleta_id}:2027:anuidade_fikarj`;
        return pagas.has(chave) || incluidas.has(chave);
      }).length;
      const pendencias = [
        ...(coloridas < 15 ? [`Faltam ${15 - coloridas} coloridas com quitação registrada`] : []),
        ...(fikarj < pretas.length ? ['Conferir FIKARJ 2026'] : []),
        ...(cnkb < pretas.length ? ['Conferir pagamentos CNKB 2026'] : []),
        ...(pretas.length ? ['Confirmar filiação e regularidade CNKB'] : ['Validar quadro de faixas pretas']),
        ...(vinculados.some(item => !item.categoria) ? ['Conferir graduação no cadastro'] : []),
      ];
      return [associacao.nome, pretas.length, fikarj, cnkb, coloridas, pendencias.join(' · ')];
    });
  }

  function renderizarComplementos() {
    const ano = campo('ano').value;
    const operacoes = dados.cnkb.filter(item => !ano || String(item.ano) === ano);
    const ativos = operacoes.filter(item => !['cancelada', 'estornada'].includes(item.situacao));
    const diretos = ativos.filter(item => item.modalidade === 'direto' && item.conferencia);
    const aRepassar = ativos.filter(item => item.situacao === 'aguardando_repasse');
    const repassados = ativos.filter(item => item.repasse_data);
    const total = itens => reais(itens.reduce((soma, item) => soma + centavos(item.valor), 0) / 100);
    container.querySelector('[data-papel="cnkb"]').textContent =
      `Direto à CNKB conferido: ${total(diretos)} · A repassar: ${total(aRepassar)} · Repassado: ${total(repassados)} · ${ativos.filter(item => item.situacao === 'aguardando_conferencia').length} aguardando conferência`;
    container.querySelector('[data-acao="csv-cnkb"]').disabled = !operacoes.length;
    container.querySelector('[data-acao="csv-inclusoes"]').disabled = !dados.inclusoes.some(item => !ano || String(item.ano) === ano);
    const alvaras = conferenciasAlvaras();
    container.querySelector('[data-acao="csv-alvaras"]').disabled = !alvaras.length;
    container.querySelector('[data-papel="alvaras"]').innerHTML = alvaras.map(linha =>
      '<tr>' + linha.map(valor => `<td class="p-2">${escapar(valor)}</td>`).join('') + '</tr>').join('');
  }

  function renderizar() {
    const filtradas = filtrar();
    const caixa = filtrarCaixa(filtradas);
    const saldoPorGrupo = caixa.reduce((totais, { movimento, cobranca }) => {
      const tipo = tipoExibido(cobranca, dados.eventos);
      const grupo = tipo === 'Anuidade CNKB' ? 'cnkb' : /Dan$/.test(tipo) ? 'dan' : 'institucional';
      totais[grupo] += centavos(movimento.valor);
      return totais;
    }, { cnkb: 0, dan: 0, institucional: 0 });
    container.querySelector('[data-papel="caixa"]').textContent =
      `${caixa.length} movimentos · FIKARJ: ${reais(saldoPorGrupo.institucional / 100)} · CNKB: ${reais(saldoPorGrupo.cnkb / 100)} · Processos Dan: ${reais(saldoPorGrupo.dan / 100)}`;
    container.querySelector('[data-acao="csv-competencia"]').disabled = !filtradas.length;
    container.querySelector('[data-acao="csv-caixa"]').disabled = !caixa.length;
    const ativos = filtradas.filter(c => !c.cancelada && c.status !== 'cancelada');
    const totais = {
      quantidade: ativos.length.toLocaleString('pt-BR'),
      lancado: reais(ativos.reduce((s, c) => s + centavos(c.valor_final), 0) / 100),
      recebido: reais(ativos.reduce((s, c) => s + centavos(c.valor_pago), 0) / 100),
      aberto: reais(ativos.reduce((s, c) => s + (centavos(c.saldo) > 0 ? centavos(c.saldo) : 0), 0) / 100),
      vencido: reais(ativos.filter(c => c.status === 'inadimplente').reduce((s, c) => s + (centavos(c.saldo) > 0 ? centavos(c.saldo) : 0), 0) / 100),
    };
    for (const [nome, valor] of Object.entries(totais)) {
      container.querySelector(`[data-total="${nome}"]`).textContent = valor;
    }

    const paginas = Math.max(1, Math.ceil(filtradas.length / ITENS_POR_PAGINA));
    pagina = Math.min(pagina, paginas - 1);
    const inicio = pagina * ITENS_POR_PAGINA;
    const visiveis = filtradas.slice(inicio, inicio + ITENS_POR_PAGINA);
    linhasEl.innerHTML = visiveis.length ? visiveis.map(c => {
      const ev = dados.eventos.get(String(c.evento_id));
      const eventoTexto = ev ? `${ev.nome} · ${dataFormatada(ev.data)}` : '—';
      const pessoa = c.atleta_nome || 'Filiado';
      const detalhePessoa = c.associacao || '';
      const situacao = STATUS[c.status] || c.status || '—';
      return `<tr class="hover:bg-slate-900/70">
        <td class="p-2"><div class="font-medium">${escapar(pessoa)}</div><div class="text-xs text-slate-400">${escapar(detalhePessoa)}</div></td>
        <td class="p-2"><div>${escapar(c.descricao || tipoExibido(c, dados.eventos))}</div><div class="text-xs text-slate-400">${escapar(tipoExibido(c, dados.eventos))}${c.ano ? ` · ${escapar(c.ano)}` : ''}</div></td>
        <td class="p-2">${escapar(eventoTexto)}</td>
        <td class="p-2 whitespace-nowrap">${dataFormatada(c.vencimento)}</td>
        <td class="p-2">${escapar(situacao)}</td>
        <td class="p-2 text-right whitespace-nowrap">${reais(c.valor_final)}</td>
        <td class="p-2 text-right whitespace-nowrap">${reais(c.valor_pago)}</td>
        <td class="p-2 text-right whitespace-nowrap">${reais(c.saldo)}</td>
      </tr>`;
    }).join('') : '<tr><td class="p-4 text-center text-slate-400" colspan="8">Nenhuma cobrança encontrada.</td></tr>';

    paginaEl.textContent = filtradas.length
      ? `Exibindo ${inicio + 1}–${Math.min(inicio + ITENS_POR_PAGINA, filtradas.length)} de ${filtradas.length.toLocaleString('pt-BR')} cobranças · página ${pagina + 1}/${paginas}`
      : '0 cobranças';
    botaoAnterior.disabled = pagina <= 0;
    botaoProxima.disabled = pagina >= paginas - 1;
  }

  function preencherFiltros() {
    const tipos = [...new Set(dados.cobrancas.map(c => tipoExibido(c, dados.eventos)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const eventos = [...dados.eventos.values()].sort((a, b) => `${a.nome} ${a.data}`.localeCompare(`${b.nome} ${b.data}`, 'pt-BR'));
    const anos = [...new Set([2026, 2027].map(String).concat(dados.cobrancas.map(c => String(c.ano || dados.eventos.get(String(c.evento_id))?.data?.slice(0, 4) || '')).filter(Boolean)))].sort().reverse();
    for (const [nome, valores, valueOf, labelOf] of [
      ['tipo', tipos, value => value, value => value],
      ['evento', eventos, value => value.id, value => `${value.nome} · ${dataFormatada(value.data)}`],
      ['ano', anos, value => value, value => value],
      ['caixa', [...new Set(dados.movimentos.map(item => item.data?.slice(0, 4)).filter(Boolean))].sort().reverse(), value => value, value => value],
    ]) {
      const select = campo(nome);
      const selecionado = select.value;
      const opcaoInicial = select.options[0];
      select.replaceChildren(opcaoInicial, ...valores.map(value => new Option(labelOf(value), String(valueOf(value)))));
      if ([...select.options].some(option => option.value === selecionado)) select.value = selecionado;
    }
  }

  async function atualizar() {
    if (emCurso) return;
    emCurso = true;
    const pedido = ++pedidoAtual;
    container.querySelector('[data-acao="atualizar"]').disabled = true;
    statusEl.textContent = 'Consultando cobranças e pagamentos permitidos pela política de acesso…';
    try {
      const novosDados = await carregarTudo(sb);
      if (pedido !== pedidoAtual) return;
      dados = novosDados;
      carregada = true;
      preencherFiltros();
      renderizar();
      renderizarComplementos();
      statusEl.textContent = `Atualizado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())}.`;
    } catch (erro) {
      if (pedido === pedidoAtual) statusEl.textContent = erro?.message || 'Não foi possível carregar a visão financeira.';
    } finally {
      emCurso = false;
      container.querySelector('[data-acao="atualizar"]').disabled = false;
    }
  }

  campo('ano').addEventListener('change', renderizarComplementos);
  const pessoaPorId = id => dados.atletas.find(item => String(item.atleta_id) === String(id));
  const daCompetencia = item => !campo('ano').value || String(item.ano) === campo('ano').value;
  container.querySelector('[data-acao="csv-cnkb"]').addEventListener('click', () => {
    baixarCsv('fikarj-operacoes-cnkb.csv', [
      ['Competência', 'Matrícula', 'Modalidade', 'Valor (BRL)', 'Data de pagamento', 'Conferência', 'Repasse', 'Confirmação CNKB', 'Situação'],
      ...dados.cnkb.filter(daCompetencia).map(item => [item.ano, pessoaPorId(item.atleta_id)?.registro, item.modalidade,
        Number(item.valor), item.data_pagamento, item.conferencia, item.repasse_data, item.confirmacao_data, item.situacao]),
    ]);
  });
  container.querySelector('[data-acao="csv-inclusoes"]').addEventListener('click', () => {
    baixarCsv('fikarj-anuidades-incluidas.csv', [
      ['Competência', 'Matrícula', 'Obrigação', 'Cobrança de origem', 'Situação'],
      ...dados.inclusoes.filter(daCompetencia).map(item => [item.ano, pessoaPorId(item.atleta_id)?.registro,
        tipoExibido(item, dados.eventos), item.cobranca_id, item.status]),
    ]);
  });
  container.querySelector('[data-acao="csv-alvaras"]').addEventListener('click', () => {
    baixarCsv('fikarj-conferencia-alvaras.csv', [
      ['Associação', 'Faixas pretas', 'FIKARJ 2026 registrada', 'CNKB 2026 registrada', 'Coloridas em dia 2027', 'Conferência'],
      ...conferenciasAlvaras(),
    ]);
  });

  for (const controle of container.querySelectorAll('[data-filtro]')) {
    controle.addEventListener('input', () => { pagina = 0; renderizar(); });
    controle.addEventListener('change', () => { pagina = 0; renderizar(); });
  }
  container.querySelector('[data-acao="atualizar"]').addEventListener('click', atualizar);
  container.querySelector('[data-acao="csv-competencia"]').addEventListener('click', () => {
    baixarCsv('fikarj-cobrancas.csv', [
      ['Competência', 'Filiado', 'Associação', 'Tipo', 'Descrição', 'Vencimento', 'Situação', 'Devido (BRL)', 'Pago (BRL)', 'Saldo (BRL)'],
      ...filtrar().map(c => [c.ano, c.atleta_nome, c.associacao, tipoExibido(c, dados.eventos),
        c.descricao, c.vencimento, STATUS[c.status] ?? c.status, Number(c.valor_final), Number(c.valor_pago), Number(c.saldo)]),
    ]);
  });
  container.querySelector('[data-acao="csv-caixa"]').addEventListener('click', () => {
    baixarCsv('fikarj-movimentos-caixa.csv', [
      ['Data de caixa', 'Competência', 'Natureza', 'Filiado', 'Associação', 'Tipo', 'Descrição', 'Forma', 'Valor (BRL)'],
      ...filtrarCaixa(filtrar()).map(({ movimento, cobranca: c }) => [
        movimento.data, c.ano, movimento.natureza, c.atleta_nome, c.associacao, tipoExibido(c, dados.eventos),
        c.descricao, movimento.forma, Number(movimento.valor),
      ]),
    ]);
  });
  botaoAnterior.addEventListener('click', () => { pagina = Math.max(0, pagina - 1); renderizar(); });
  botaoProxima.addEventListener('click', () => { pagina++; renderizar(); });

  const detalhe = container.closest('details');
  if (!detalhe || detalhe.open) void atualizar();
  else detalhe.addEventListener('toggle', () => { if (detalhe.open && !carregada) void atualizar(); });
}
