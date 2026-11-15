const estados = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};
const campos = ['titulo', 'modulo', 'responsavel', 'status', 'prazo', 'link'];
const iniciadas = new WeakSet();
const diaBrasilia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });

function formatarPrazo(prazo) {
  return /^\d{4}-\d{2}-\d{2}$/.test(prazo ?? '') ? prazo.split('-').reverse().join('/') : 'Sem prazo definido';
}

function linkSeguro(link) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function texto(tag, valor, classe = '') {
  const elemento = document.createElement(tag);
  elemento.textContent = valor;
  elemento.className = classe;
  return elemento;
}

export function iniciarAgendaInstitucional(sb) {
  const painel = document.getElementById('presidencia-agenda');
  if (!painel || iniciadas.has(painel)) return;
  iniciadas.add(painel);

  const form = painel.querySelector('form');
  const editor = form.querySelector('fieldset');
  const tituloForm = form.querySelector('legend');
  const lista = painel.querySelector('ul');
  const mensagem = painel.querySelector('[role="status"]');
  const filtro = painel.querySelector('#agendaFiltroEstado');
  const atualizar = painel.querySelector('#agendaAtualizar');
  const nova = painel.querySelector('#agendaNova');
  let registros = [];
  let emEdicao;
  let carregada = false;
  let ocupada = false;

  function renderizar() {
    const hoje = diaBrasilia.format(Date.now());
    const estado = filtro.value;
    const filtrados = registros.filter(item => estado === 'todos'
      || (estado === 'ativos' ? ['pendente', 'em_andamento'].includes(item.status) : item.status === estado));
    lista.replaceChildren();
    if (!filtrados.length) {
      if (carregada) lista.append(texto('li', 'Nenhum compromisso neste filtro.', 'text-sm text-slate-300'));
      return;
    }
    for (const item of filtrados) {
      const linha = texto('li', '', 'rounded-xl border border-slate-700 p-3');
      const vencida = item.prazo && item.prazo < hoje && ['pendente', 'em_andamento'].includes(item.status);
      linha.append(
        texto('h3', item.titulo, 'font-semibold break-words'),
        texto('p', [item.modulo, item.responsavel || 'Sem responsável definido'].filter(Boolean).join(' · '), 'text-sm text-slate-300 break-words'),
        texto('p', [estados[item.status] || 'Situação indisponível', formatarPrazo(item.prazo), vencida && 'Prazo vencido'].filter(Boolean).join(' · '),
          vencida ? 'text-sm text-amber-200' : 'text-sm text-slate-300')
      );
      const acoes = texto('div', '', 'mt-2 flex flex-wrap gap-2');
      const editar = texto('button', 'Editar', 'rounded border border-slate-600 px-3 py-1 text-sm text-sky-200');
      editar.type = 'button';
      editar.setAttribute('aria-label', `Editar ${item.titulo}`);
      editar.addEventListener('click', () => abrirEditor(item));
      acoes.append(editar);
      const origem = linkSeguro(item.link);
      if (origem) {
        const atalho = texto('a', 'Abrir origem', 'rounded border border-slate-600 px-3 py-1 text-sm text-sky-200');
        atalho.href = origem;
        atalho.target = '_blank';
        atalho.rel = 'noopener noreferrer';
        acoes.append(atalho);
      }
      linha.append(acoes);
      lista.append(linha);
    }
  }

  function abrirEditor(item) {
    if (ocupada) return;
    emEdicao = item;
    tituloForm.textContent = item ? 'Editar compromisso' : 'Novo compromisso';
    form.reset();
    if (item) for (const campo of campos) form.elements.namedItem(campo).value = item[campo] ?? '';
    form.classList.remove('hidden');
    form.elements.namedItem('titulo').focus();
  }

  async function consultar(aviso) {
    ocupada = true;
    atualizar.disabled = nova.disabled = editor.disabled = true;
    mensagem.textContent = 'Consultando a agenda institucional…';
    try {
      const { data, error } = await sb.rpc('agenda_institucional_listar');
      if (error || !Array.isArray(data)) throw new Error();
      registros = data;
      carregada = true;
      renderizar();
      mensagem.textContent = aviso || 'Agenda atualizada.';
    } catch {
      mensagem.textContent = [aviso, carregada
        ? 'Falha ao atualizar. A lista mostra a última consulta bem-sucedida.'
        : 'Agenda indisponível. Tente atualizar novamente.'].filter(Boolean).join(' ');
    } finally {
      ocupada = false;
      atualizar.disabled = nova.disabled = editor.disabled = false;
    }
  }

  painel.addEventListener('toggle', () => {
    if (painel.open && !carregada && !ocupada) void consultar();
  });
  atualizar.addEventListener('click', () => { if (!ocupada) void consultar(); });
  nova.addEventListener('click', () => abrirEditor());
  filtro.addEventListener('change', renderizar);
  form.querySelector('#agendaFecharEditor').addEventListener('click', () => {
    if (!ocupada) {
      form.classList.add('hidden');
      nova.focus();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (ocupada) return;
    const dados = new FormData(form);
    const parametros = Object.fromEntries(campos.map(campo => [`p_${campo}`, String(dados.get(campo) || '').trim() || null]));
    const link = parametros.p_link ? linkSeguro(parametros.p_link) : null;
    if (!parametros.p_titulo || !parametros.p_modulo || (parametros.p_link && !link)) {
      mensagem.textContent = 'Informe título e módulo. Para o link da origem, use um endereço HTTPS.';
      return;
    }
    parametros.p_link = link;
    parametros.p_id = emEdicao?.id ?? null;
    parametros.p_atualizado_em = emEdicao?.atualizado_em ?? null;
    ocupada = true;
    atualizar.disabled = nova.disabled = editor.disabled = true;
    mensagem.textContent = 'Salvando compromisso…';
    try {
      const { error } = await sb.rpc('agenda_institucional_salvar', parametros);
      if (error) throw error;
      form.classList.add('hidden');
      await consultar('Compromisso salvo.');
      nova.focus();
    } catch (erro) {
      mensagem.textContent = erro?.code === '40001'
        ? 'O compromisso mudou desde que foi aberto. Atualize a lista e abra a versão mais recente para editar.'
        : 'Não foi possível confirmar a gravação. Confira na lista antes de tentar novamente.';
    } finally {
      ocupada = false;
      atualizar.disabled = nova.disabled = editor.disabled = false;
    }
  });
  if (painel.open) return consultar();
}
