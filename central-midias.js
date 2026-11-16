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
const bucketPublicacao = 'central-midias-publicacao';

function linhas(texto) {
  return texto.trim().split(/\r?\n/).map(linha => linha.trim()).filter(Boolean);
}

function tipoPelaExtensao(url) {
  if (/\.jpe?g$/i.test(url)) return 'image/jpeg';
  if (/\.mp4$/i.test(url)) return 'video/mp4';
  return '';
}

function lerMidias(form) {
  const urls = linhas(form.elements.midias.value);
  const mimes = form.elements.mimes.value.trim();
  const tipos = mimes ? linhas(mimes).map(tipo => tipo.toLowerCase()) : urls.map(tipoPelaExtensao);
  if (tipos.length !== urls.length || tipos.some(tipo => !tiposDeArquivo.has(tipo))) {
    throw new Error('Informe um tipo válido para cada link, na mesma ordem.');
  }
  const reel = form.elements.formato_publicacao.value === 'reel';
  const esperado = reel ? 'video/mp4' : 'image/jpeg';
  if (tipos.some(tipo => tipo !== esperado)) {
    throw new Error(reel ? 'Reel aceita somente vídeo MP4.' : 'Este carrossel aceita somente imagens JPEG.');
  }
  return { urls, tipos };
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
      <fieldset class="space-y-2 rounded border border-gray-700 p-3">
        <legend>Enviar arquivos para publicação</legend>
        <p class="text-sm text-slate-300">O envio cria links públicos para a Meta acessar os arquivos. Use somente materiais liberados para divulgação.</p>
        <label class="block">JPEG de até 8 MB ou MP4 de até 50 MB <input class="inp" type="file" name="arquivos" accept="image/jpeg,video/mp4,.jpg,.jpeg,.mp4" multiple></label>
        <label class="block"><input type="checkbox" name="autorizarLinks"> Autorizo tornar estes arquivos acessíveis por link público.</label>
        <button type="button" class="rounded bg-gray-700 px-3 py-2" data-midia="enviarArquivos">Enviar arquivos e preencher links</button>
      </fieldset>
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
    form.elements.arquivos.multiple = formato !== 'reel';
    form.elements.arquivos.accept = formato === 'reel' ? 'video/mp4,.mp4' : 'image/jpeg,.jpg,.jpeg';
    obter('instrucoesFormato').textContent = formato === 'reel'
      ? 'Use um vídeo MP4 com o tipo video/mp4.'
      : 'Use de 2 a 10 imagens JPEG, com o tipo image/jpeg.';
    for (const campo of form.querySelectorAll('[name="destino"]')) {
      campo.disabled = !formatos[formato].includes(campo.value);
      if (campo.disabled) campo.checked = false;
    }
  }

  function editar(item) {
    if (raiz.getAttribute('aria-busy') === 'true') return;
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
      if (['aprovado', 'parcial'].includes(item.status)) {
        for (const info of item.destinos ?? []) {
          if (info.status !== 'pendente' || !canais[info.destino]) continue;
          const canal = canais[info.destino];
          li.append(botao('Publicar agora · ' + canal, () => {
            if (li.querySelector('[data-confirmar-publicacao]')) return;
            const confirmar = document.createElement('div');
            confirmar.dataset.confirmarPublicacao = '';
            confirmar.setAttribute('role', 'group');
            confirmar.setAttribute('aria-label', 'Confirmar publicação');
            texto(confirmar, 'Publicar “' + item.tema + '” agora em ' + canal + '?');
            const enviar = botao('Confirmar publicação', () => executar(async () => {
              if (enviar.disabled) return status.textContent;
              enviar.disabled = true;
              const resposta = await sb.functions.invoke('central-midias-publicar-agora', {
                body: { midia_id: item.id, versao: item.versao, destino: info.destino },
              }).catch(() => null);
              const contexto = resposta?.error?.context;
              const detalhe = typeof contexto?.json === 'function'
                ? await contexto.json().catch(() => null)
                : null;
              const reservaLiberada = detalhe?.error === 'disparo_rejeitado_reserva_liberada' &&
                detalhe.retryable === true;
              let atualizada = false;
              try {
                await atualizar();
                atualizada = true;
              } catch {
                // Mantenha a confirmação bloqueada enquanto o estado do envio não é conhecido.
              }
              if (!resposta || resposta.error || resposta.data?.accepted !== true) {
                if (reservaLiberada) {
                  enviar.disabled = false;
                  return 'O GitHub recusou o disparo e a reserva foi liberada. Você pode tentar novamente.';
                }
                if (detalhe?.error === 'solicitacao_em_andamento') {
                  return 'Já existe um envio em andamento. Acompanhe o status no cartão da pauta.';
                }
                return 'Envio não confirmado. Confira o status da pauta antes de tentar novamente.';
              }
              if (!atualizada) return 'Envio aceito. Atualize a lista para acompanhar o resultado.';
              return 'Envio aceito. Acompanhe o status e o recibo no cartão da pauta.';
            }));
            confirmar.append(enviar, botao('Voltar', () => confirmar.remove()));
            li.append(confirmar);
            enviar.focus();
          }));
        }
      }
      if (['rascunho', 'planejado', 'aprovado', 'agendado'].includes(item.status)) li.append(botao('Cancelar item', () => {
        if (li.querySelector('[data-confirmar-cancelamento]')) return;
        const confirmar = document.createElement('div');
        confirmar.dataset.confirmarCancelamento = '';
        confirmar.setAttribute('role', 'group');
        confirmar.setAttribute('aria-label', 'Confirmar cancelamento');
        const aviso = document.createElement('p');
        aviso.textContent = 'Cancelar este conteúdo? O histórico será preservado.';
        confirmar.append(aviso,
          botao('Confirmar cancelamento', () => transicionar(item, 'cancelar', 'Conteúdo cancelado.')),
          botao('Manter item', () => confirmar.remove()));
        li.append(confirmar);
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
  form.elements.arquivos.addEventListener('change', () => { form.elements.autorizarLinks.checked = false; });
  obter('enviarArquivos').addEventListener('click', () => executar(async () => {
    const { arquivos, formato_publicacao, midias, mimes, autorizarLinks } = form.elements;
    const selecionados = Array.from(arquivos.files);
    if (!selecionados.length) throw new Error('Escolha os arquivos primeiro.');
    const { urls, tipos } = lerMidias(form);
    const reel = formato_publicacao.value === 'reel';
    const limite = reel ? 1 : 10;
    if (urls.length + selecionados.length > limite) throw new Error('O formato aceita até ' + limite + ' arquivo(s).');
    const arquivosTipados = selecionados.map(arquivo => {
      const tipo = arquivo.type || tipoPelaExtensao(arquivo.name);
      if (tipo !== (reel ? 'video/mp4' : 'image/jpeg')) {
        throw new Error('Arquivo incompatível com o formato selecionado: ' + arquivo.name);
      }
      const tamanhoMaximo = tipo === 'image/jpeg' ? 8 : 50;
      if (!arquivo.size || arquivo.size > tamanhoMaximo * 1024 * 1024) {
        throw new Error('Arquivo vazio ou maior que ' + tamanhoMaximo + ' MB: ' + arquivo.name);
      }
      return { arquivo, tipo };
    });
    if (!autorizarLinks.checked) throw new Error('Marque a autorização para disponibilizar os arquivos por link público.');
    autorizarLinks.checked = false;
    const falhas = [];
    form.inert = true;
    try {
      const { data, error } = await sb.auth.getUser();
      if (error || !data?.user?.id) throw new Error('Entre novamente no Painel para enviar os arquivos.');
      const bucket = sb.storage.from(bucketPublicacao);
      for (const { arquivo, tipo } of arquivosTipados) {
        const extensao = tipo === 'image/jpeg' ? 'jpg' : 'mp4';
        const caminho = data.user.id + '/' + crypto.randomUUID() + '.' + extensao;
        try {
          const { error: erroEnvio } = await bucket.upload(caminho, arquivo, { contentType: tipo, upsert: false });
          if (erroEnvio) throw erroEnvio;
          urls.push(bucket.getPublicUrl(caminho).data.publicUrl);
          tipos.push(tipo);
        } catch {
          falhas.push(arquivo.name);
        }
      }
      midias.value = urls.join('\n');
      mimes.value = tipos.join('\n');
      arquivos.value = '';
    } finally {
      form.inert = false;
    }
    if (falhas.length) return 'Falha no envio de ' + falhas.join(', ') + '. Confira os links preenchidos antes de tentar novamente.';
    return 'Links preenchidos. Salve o conteúdo para registrar as mídias no rascunho.';
  }));
  form.addEventListener('submit', evento => {
    evento.preventDefault();
    executar(async () => {
      const { tema, legenda, formato_publicacao, quando } = form.elements;
      const { urls, tipos } = lerMidias(form);
      if (!tema.value.trim()) throw new Error('Informe o tema.');
      if (urls.length > 10) throw new Error('Use até 10 links de mídia.');
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
