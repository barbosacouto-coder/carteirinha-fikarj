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
  const tipos = { fikarj: 'Anuidade FIKARJ', cnkb: 'Anuidade CNKB' };
  return tipos[cobranca.tipo] || cobranca.tipo || 'Outro';
}

async function carregarTudo(sb) {
  const consultas = await Promise.all([
    sb.from('pag_eventos').select('id,nome,tipo,data').order('data', { ascending: false }),
    carregarCobrancas(sb),
  ]);
  const [eventosResposta, cobrancas] = consultas;
  if (eventosResposta.error) throw eventosResposta.error;
  return {
    eventos: new Map((eventosResposta.data || []).map(evento => [String(evento.id), evento])),
    cobrancas,
  };
}

async function carregarCobrancas(sb) {
  const resultado = [];
  for (let inicio = 0; ; inicio += LIMITE_PAGINA) {
    const { data, error } = await sb.from('pag_v_cobrancas')
      .select('id,atleta_id,tipo,ano,evento_id,descricao,valor_final,vencimento,cancelada,criado_em,atleta_nome,associacao,valor_pago,saldo,status,ultimo_pagamento')
      .order('criado_em', { ascending: false })
      .order('id', { ascending: false })
      .range(inicio, inicio + LIMITE_PAGINA - 1);
    if (error) throw error;
    resultado.push(...(data || []));
    if (!data || data.length < LIMITE_PAGINA) return resultado;
  }
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
        <label class="grid gap-1 text-sm">Ano
          <select data-filtro="ano" class="rounded border border-gray-500 bg-slate-900 px-3 py-2 text-white"><option value="">Todos</option></select>
        </label>
        <button type="button" data-acao="atualizar" class="rounded bg-sky-700 px-4 py-2 font-semibold text-white hover:bg-sky-600">Atualizar</button>
      </div>

      <p data-papel="status" role="status" aria-live="polite" class="text-sm text-slate-300">Abra a seção para consultar o financeiro.</p>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Cobranças ativas</p><strong data-total="quantidade" class="text-xl">—</strong></article>
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Valor lançado</p><strong data-total="lancado" class="text-xl">—</strong></article>
        <article class="rounded border border-slate-700 bg-slate-900 p-3"><p class="text-xs text-slate-300">Recebido</p><strong data-total="recebido" class="text-xl">—</strong></article>
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
    </section>`;

  const campo = nome => container.querySelector(`[data-filtro="${nome}"]`);
  const linhasEl = container.querySelector('[data-papel="linhas"]');
  const statusEl = container.querySelector('[data-papel="status"]');
  const botaoAnterior = container.querySelector('[data-acao="anterior"]');
  const botaoProxima = container.querySelector('[data-acao="proxima"]');
  const paginaEl = container.querySelector('[data-papel="contagem"]');
  let dados = { cobrancas: [], eventos: new Map() };
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

  function renderizar() {
    const filtradas = filtrar();
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
    const anos = [...new Set(dados.cobrancas.map(c => String(c.ano || dados.eventos.get(String(c.evento_id))?.data?.slice(0, 4) || '')).filter(Boolean))].sort().reverse();
    for (const [nome, valores, valueOf, labelOf] of [
      ['tipo', tipos, value => value, value => value],
      ['evento', eventos, value => value.id, value => `${value.nome} · ${dataFormatada(value.data)}`],
      ['ano', anos, value => value, value => value],
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
      statusEl.textContent = `Atualizado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())}.`;
    } catch (erro) {
      if (pedido === pedidoAtual) statusEl.textContent = erro?.message || 'Não foi possível carregar a visão financeira.';
    } finally {
      emCurso = false;
      container.querySelector('[data-acao="atualizar"]').disabled = false;
    }
  }

  for (const controle of container.querySelectorAll('[data-filtro]')) {
    controle.addEventListener('input', () => { pagina = 0; renderizar(); });
    controle.addEventListener('change', () => { pagina = 0; renderizar(); });
  }
  container.querySelector('[data-acao="atualizar"]').addEventListener('click', atualizar);
  botaoAnterior.addEventListener('click', () => { pagina = Math.max(0, pagina - 1); renderizar(); });
  botaoProxima.addEventListener('click', () => { pagina++; renderizar(); });

  const detalhe = container.closest('details');
  if (!detalhe || detalhe.open) void atualizar();
  else detalhe.addEventListener('toggle', () => { if (detalhe.open && !carregada) void atualizar(); });
}
