const etapas = {
  rascunho: 'Rascunho', planejado: 'Planejado', aprovado: 'Aprovado', agendado: 'Agendado',
  publicando: 'Em publicação', parcial: 'Publicado parcialmente', publicado: 'Publicado',
  falhou: 'Falhou', resultado_incerto: 'Resultado a conferir', cancelado: 'Cancelado', pendente: 'Pendente',
};
const canais = {
  instagram_carousel: 'Carrossel no Instagram',
  instagram_reel: 'Reel no Instagram',
  facebook_reel: 'Reel no Facebook',
};
const formatos = {
  instagram_carousel: ['instagram_carousel'],
  reel: ['instagram_reel', 'facebook_reel'],
};
const tiposDeArquivo = new Set(['image/jpeg', 'video/mp4']);

function linhas(texto) {
  return texto.trim().split(/\r?\n/).map(linha => linha.trim()).filter(Boolean);
}

function tipoPelaExtensao(url) {
  if (/\.jpe?g$/i.test(url)) return 'image/jpeg';
  if (/\.mp4$/i.test(url)) return 'video/mp4';
  return '';
}

export function iniciarCentralMidias(sb) {
  const raiz = document.getElementById('centralMidias');
  if (!raiz || raiz.dataset.iniciado) return;
  raiz.dataset.iniciado = 'true';
  raiz.innerHTML = `
    <div class="flex flex-wrap items-end gap-3">
      <label>Mês do calendário <input class="inp" type="month" data-midia="mes"></label>
      <button type="button" class="rounded bg-gray-700 px-3 py-2" data-midia="atualizar">Atualizar</button>
      <button type="button" class="rounded bg-sky-700 px-3 py-2" data-midia="novo">Novo rascunho</button>
    </div>
    <p class="my-2" data-midia="status" role="status"></p>
    <h3 class="mt-4 font-semibold">Calendário e publicações planejadas</h3>
    <ul class="my-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-midia="calendario"></ul>
    <h3 class="mt-4 font-semibold">Rascunhos e itens sem data</h3>
    <ul class="my-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-midia="rascunhos"></ul>
    <form class="mt-4 space-y-2 rounded border border-gray-700 p-3" data-midia="form" hidden>
      <h3 class="font-semibold" data-midia="tituloForm">Novo rascunho</h3>
      <label class="block">Tema <input class="inp" name="tema" required maxlength="200"></label>
      <fieldset class="space-y-2 border border-gray-700 p-2" data-midia="gerador">
        <legend>Rascunho guiado</legend>
        <label class="block">Fatos conferidos <textarea class="inp" name="fatos" rows="2"></textarea></label>
        <label class="block">Formato <select class="inp" name="formato">
          <option value="legenda">Legenda</option><option value="reel">Roteiro de Reel</option><option value="slides">Estrutura de slides</option>
        </select></label>
      </fieldset>
      <div id="midiasGerarArquivos"></div>
      <label class="block">Formato de publicação <select class="inp" name="formato_publicacao">
        <option value="instagram_carousel">Carrossel</option>
        <option value="reel">Reel</option>
      </select></label>
      <label class="block">Legenda <textarea class="inp" name="legenda" rows="4" maxlength="2200"></textarea></label>
      <p class="text-sm text-slate-300" data-midia="instrucoesFormato"></p>
      <label class="block">Links públicos HTTPS sem parâmetros, um por linha <textarea class="inp" name="midias" rows="3"></textarea></label>
      <label class="block">Tipos de arquivo, na mesma ordem dos links <textarea class="inp" name="mimes" placeholder="Automático para links .jpg, .jpeg e .mp4" rows="2"></textarea></label>
      <fieldset class="flex flex-wrap gap-3">
        <legend>Destinos</legend>
        <label><input type="checkbox" name="destino" value="instagram_carousel"> Carrossel no Instagram</label>
        <label><input type="checkbox" name="destino" value="instagram_reel"> Reel no Instagram</label>
        <label><input type="checkbox" name="destino" value="facebook_reel"> Reel no Facebook</label>
      </fieldset>
      <label class="block">Data e hora previstas em Brasília <input class="inp" name="quando" type="datetime-local"></label>
      <div class="flex flex-wrap gap-2">
        <button class="rounded bg-sky-700 px-3 py-2" type="submit">Salvar conteúdo</button>
        <button class="rounded bg-gray-700 px-3 py-2" type="button" data-midia="cancelar">Fechar</button>
      </div>
    </form>
  `;
  const obter = chave => raiz.querySelector(`[data-midia="${chave}"]`);
  const form = obter('form');
  const mes = obter('mes');
  const status = obter('status');
  const TZ = 'America/Sao_Paulo';
  const dataBrasilia = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const local = valor => valor ? dataBrasilia.format(new Date(valor)).replace(' ', 'T') : '';
  mes.value = local(new Date()).slice(0, 7);
  let itens = [];
  let editando;

  async function rpc(nome, args) {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw new Error(error.message || 'O Portal não respondeu.');
    return data;
  }

  async function executar(acao) {
    if (raiz.getAttribute('aria-busy') === 'true') return;
    raiz.setAttribute('aria-busy', 'true');
    status.textContent = 'Aguarde…';
    try {
      status.textContent = await acao();
    } catch (erro) {
      status.textContent = erro.message || 'Não foi possível concluir.';
    } finally {
      raiz.removeAttribute('aria-busy');
    }
  }

  function botao(label, onclick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rounded bg-gray-700 px-2 py-1';
    el.textContent = label;
    el.addEventListener('click', onclick);
    return el;
  }

  function atualizarFormato() {
    const formato = form.elements.formato_publicacao.value;
    obter('instrucoesFormato').textContent = formato === 'reel'
      ? 'Use um vídeo MP4 com o tipo video/mp4.'
      : 'Use de 2 a 10 arquivos JPEG ou MP4, com os tipos image/jpeg ou video/mp4.';
    for (const campo of form.querySelectorAll('[name="destino"]')) {
      campo.disabled = !formatos[formato].includes(campo.value);
      if (campo.disabled) campo.checked = false;
    }
  }

  function editar(item) {
    editando = item;
    form.reset();
    obter('tituloForm').textContent = item ? 'Editar conteúdo' : 'Novo rascunho';
    form.elements.tema.value = item?.tema ?? '';
    form.elements.legenda.value = item?.legenda ?? '';
    form.elements.midias.value = item?.midias_urls?.join('\n') ?? '';
    form.elements.mimes.value = item?.midias_mime_types?.join('\n') ?? '';
    form.elements.formato_publicacao.value = item?.formato_publicacao ?? 'instagram_carousel';
    const destinos = item?.destinos?.map(info => info.destino) ?? [];
    for (const destino of form.querySelectorAll('[name="destino"]')) {
      destino.checked = destinos.includes(destino.value);
    }
    atualizarFormato();
    form.elements.quando.value = local(item?.agendado_para);
    form.hidden = false;
    form.elements.tema.focus();
  }
  function texto(el, valor) {
    const p = document.createElement('p');
    p.textContent = valor;
    el.append(p);
  }

  function renderizar() {
    const calendario = obter('calendario');
    const rascunhos = obter('rascunhos');
    calendario.replaceChildren();
    rascunhos.replaceChildren();
    for (const item of itens) {
      const quando = local(item.agendado_para);
      const destino = item.status === 'rascunho' || !quando ? rascunhos : calendario;
      if (destino === calendario && mes.value && !quando.startsWith(mes.value)) continue;
      const li = document.createElement('li');
      li.className = 'space-y-2 rounded border border-gray-700 p-3 break-words';
      texto(li, item.tema);
      texto(li, [etapas[item.status] || item.status, quando.replace('T', ' ')].filter(Boolean).join(' · '));
      if (item.legenda) texto(li, item.legenda);
      for (const info of item.destinos ?? []) {
        texto(li, [canais[info.destino] || info.destino, etapas[info.status], info.id_externo, info.erro].filter(Boolean).join(' · '));
      }
      for (const endereco of item.midias_urls ?? []) {
        try {
          const url = new URL(endereco);
          if (url.protocol !== 'https:') continue;
          const link = document.createElement('a');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.className = 'block text-sky-200 underline';
          link.textContent = 'Abrir mídia';
          li.append(link);
        } catch {
          // URLs antigas inválidas não devem virar links.
        }
      }
      destino.append(li);
      if (['rascunho', 'planejado'].includes(item.status)) li.append(botao('Editar', () => editar(item)));
      if (item.status === 'planejado') li.append(botao('Aprovar', () => transicionar(item, 'aprovar', 'Conteúdo aprovado.')));
      if (item.status === 'aprovado') li.append(botao('Agendar', () => {
        if (window.confirm('Agendar nos destinos selecionados para ' + quando.replace('T', ' ') + ' (Brasília)?')) {
          transicionar(item, 'agendar', 'Agendamento registrado.');
        }
      }));
      if (['rascunho', 'planejado', 'aprovado', 'agendado'].includes(item.status)) li.append(botao('Cancelar item', () => {
        if (window.confirm('Cancelar este conteúdo?')) transicionar(item, 'cancelar', 'Conteúdo cancelado.');
      }));
    }
    for (const lista of [calendario, rascunhos]) {
      if (!lista.childElementCount) {
        const vazio = document.createElement('li');
        vazio.textContent = 'Nenhum item neste recorte.';
        lista.append(vazio);
      }
    }
  }

  obter('cancelar').addEventListener('click', () => { form.hidden = true; });
  obter('novo').addEventListener('click', () => editar(null));
  mes.addEventListener('change', renderizar);
  form.elements.formato_publicacao.addEventListener('change', atualizarFormato);

  const gerar = botao('Montar texto de trabalho', () => {
    const tema = form.elements.tema.value.trim();
    if (!tema) { status.textContent = 'Informe o tema primeiro.'; return; }
    if (form.elements.legenda.value.trim()) {
      status.textContent = 'O campo de legenda já está preenchido. Limpe-o se quiser gerar outro texto.';
      return;
    }
    const fatos = form.elements.fatos.value.trim() || '[Preencher com os fatos conferidos]';
    const acao = '[Preencher a ação esperada do público]';
    const formato = form.elements.formato.value;
    const modelos = {
      legenda: [tema, fatos, acao],
      reel: ['Roteiro · ' + tema, 'Abertura · [Indicar imagem ou gancho]', 'Corpo · ' + fatos,
        'Encerramento · ' + acao, 'Texto na tela · [Indicar frases curtas]'],
      slides: ['Slide 1 · ' + tema, 'Slide 2 · ' + fatos, 'Slide 3 · ' + acao],
    };
    const modelo = modelos[formato].join('\n\n');
    if (modelo.length > form.elements.legenda.maxLength) {
      status.textContent = 'Reduza os fatos para caber no campo de legenda.';
      return;
    }
    form.elements.legenda.value = modelo;
    status.textContent = 'Texto de trabalho montado. Revise os campos antes de aprovar.';
  });
  obter('gerador').append(gerar);
  function transicionar(item, acao, mensagem) {
    return executar(async () => {
      await rpc('central_midias_' + acao, { p_id: item.id, p_versao: item.versao });
      return atualizarAposSalvar(mensagem);
    });
  }

  async function atualizar() {
    itens = await rpc('central_midias_listar');
    renderizar();
    return itens.length + ' item(ns) carregado(s).';
  }

  async function atualizarAposSalvar(mensagem) {
    try {
      await atualizar();
      return mensagem;
    } catch {
      return mensagem + ' Clique em Atualizar para recarregar o calendário.';
    }
  }

  obter('atualizar').addEventListener('click', () => executar(atualizar));
  form.addEventListener('submit', evento => {
    evento.preventDefault();
    executar(async () => {
      const { tema, legenda, midias, mimes, formato_publicacao, quando } = form.elements;
      const urls = linhas(midias.value);
      const tipos = mimes.value.trim() ? linhas(mimes.value).map(tipo => tipo.toLowerCase()) : urls.map(tipoPelaExtensao);
      if (!tema.value.trim()) throw new Error('Informe o tema.');
      if (urls.length > 10) throw new Error('Use até 10 links de mídia.');
      if (tipos.length !== urls.length || tipos.some(tipo => !tiposDeArquivo.has(tipo))) {
        throw new Error('Informe um tipo válido para cada link, na mesma ordem.');
      }
      for (const endereco of urls) {
        if (endereco.length > 2048 || !/^https:\/\/[a-zA-Z0-9.-]+(?:\/[^?#\s\\]*)?$/.test(endereco)) {
          throw new Error('Informe links HTTPS públicos sem parâmetros ou credenciais.');
        }
      }
      const destinos = [...form.querySelectorAll('[name="destino"]:checked')].map(campo => campo.value);
      await rpc('central_midias_salvar', {
        p_id: editando?.id ?? null,
        p_versao: editando?.versao ?? null,
        p_tema: tema.value.trim(),
        p_legenda: legenda.value.trim(),
        p_formato_publicacao: formato_publicacao.value,
        p_midias_urls: urls,
        p_midias_mime_types: tipos,
        p_destinos: destinos,
        p_agendado_para: quando.value ? quando.value + ':00-03:00' : null,
      });
      form.hidden = true;
      if (quando.value) mes.value = quando.value.slice(0, 7);
      return atualizarAposSalvar(quando.value ? 'Conteúdo planejado.' : 'Rascunho salvo.');
    });
  });
  executar(atualizar);
}
