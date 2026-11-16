const BUCKET = 'segundo-cerebro';
const LIMITE = 60;
const TAMANHO_MAXIMO = 25 * 1024 * 1024;
const TIPOS_PERMITIDOS = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/html', 'text/markdown', 'text/plain',
  'image/jpeg', 'image/png',
]);

const EXTENSOES = new Set(['pdf', 'docx', 'xlsx', 'html', 'htm', 'md', 'txt', 'jpg', 'jpeg', 'png']);

function elemento(id) {
  const no = document.getElementById(id);
  if (!no) throw new Error(`Elemento ausente: ${id}`);
  return no;
}

function texto(value) {
  return String(value ?? '').trim();
}

function extensao(nome) {
  return texto(nome).split('.').pop().toLowerCase();
}

function nomeSeguro(nome) {
  const ext = extensao(nome);
  const base = texto(nome).replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'documento';
  return `${base}.${ext}`;
}

async function sha256(arquivo) {
  const digest = await crypto.subtle.digest('SHA-256', await arquivo.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function formatarData(value) {
  if (!value) return '';
  const [ano, mes, dia] = String(value).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : '';
}

function cartão(documento, abrir) {
  const artigo = document.createElement('article');
  artigo.className = 'rounded-xl border border-slate-700 bg-slate-800 p-4';
  const titulo = document.createElement('h3');
  titulo.className = 'font-semibold text-white';
  titulo.textContent = documento.titulo;
  const meta = document.createElement('p');
  meta.className = 'mt-1 text-xs text-slate-300';
  meta.textContent = [documento.categoria, documento.tipo, formatarData(documento.data_documento)].filter(Boolean).join(' · ');
  artigo.append(titulo, meta);
  if (documento.resumo) {
    const resumo = document.createElement('p');
    resumo.className = 'mt-2 text-sm text-slate-200';
    resumo.textContent = documento.resumo;
    artigo.append(resumo);
  }
  if (documento.arquivo_disponivel) {
    const botão = document.createElement('button');
    botão.type = 'button';
    botão.className = 'mt-3 rounded-lg border border-sky-400 px-3 py-2 text-sm font-semibold text-sky-200 hover:bg-sky-900';
    botão.textContent = 'Abrir cópia protegida';
    botão.addEventListener('click', () => abrir(documento, botão));
    artigo.append(botão);
  } else {
    const aviso = document.createElement('p');
    aviso.className = 'mt-3 text-xs text-amber-200';
    aviso.textContent = 'Catalogado; arquivo disponível somente no Segundo Cérebro local.';
    artigo.append(aviso);
  }
  return artigo;
}

export function validarArquivo(arquivo) {
  if (!arquivo) throw new Error('Selecione um arquivo.');
  if (arquivo.size <= 0 || arquivo.size > TAMANHO_MAXIMO) throw new Error('O arquivo deve ter até 25 MB.');
  const ext = extensao(arquivo.name);
  if (!EXTENSOES.has(ext)) throw new Error('Formato de arquivo não permitido.');
  if (arquivo.type && !TIPOS_PERMITIDOS.has(arquivo.type)) throw new Error('Tipo de arquivo não permitido.');
  return ext;
}

export async function iniciarSegundoCerebro(sb) {
  const formBusca = elemento('segundoCerebroBusca');
  const termo = elemento('segundoCerebroTermo');
  const categoria = elemento('segundoCerebroCategoria');
  const status = elemento('segundoCerebroStatus');
  const resultados = elemento('segundoCerebroResultados');
  const formUpload = elemento('segundoCerebroUpload');
  const enviar = elemento('segundoCerebroEnviar');
  const mais = elemento('segundoCerebroMais');
  let offset = 0;
  let totalExibido = 0;

  async function abrirDocumento(documento, botão) {
    botão.disabled = true;
    status.textContent = 'Preparando acesso protegido...';
    const novaAba = window.open('', '_blank', 'noopener,noreferrer');
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(documento.storage_path, 120, { download: documento.nome_original });
      if (error || !data?.signedUrl) throw error || new Error('Link indisponível.');
      const { error: erroAuditoria } = await sb.rpc('segundo_cerebro_registrar_acesso', { p_documento: documento.id });
      if (erroAuditoria) throw erroAuditoria;
      if (novaAba) novaAba.location.replace(data.signedUrl);
      else window.location.assign(data.signedUrl);
      status.textContent = 'Documento aberto em link temporário.';
    } catch {
      if (novaAba) novaAba.close();
      status.textContent = 'Não foi possível abrir o documento. Entre novamente ou procure a administração.';
    } finally {
      botão.disabled = false;
    }
  }

  async function buscar({ acrescentar = false } = {}) {
    if (!acrescentar) {
      offset = 0;
      totalExibido = 0;
    }
    status.textContent = 'Consultando o acervo protegido...';
    if (!acrescentar) resultados.replaceChildren();
    const { data, error } = await sb.rpc('segundo_cerebro_buscar', {
      p_busca: texto(termo.value),
      p_categoria: texto(categoria.value),
      p_limite: LIMITE,
      p_offset: offset,
    });
    if (error) {
      status.textContent = 'Consulta indisponível. Entre novamente ou procure a administração.';
      return;
    }
    const itens = Array.isArray(data) ? data : [];
    resultados.append(...itens.map(item => cartão(item, abrirDocumento)));
    totalExibido += itens.length;
    offset += itens.length;
    mais.classList.toggle('hidden', itens.length < LIMITE);
    status.textContent = totalExibido
      ? `${totalExibido} documento(s) exibido(s).${itens.length === LIMITE ? ' Há mais resultados.' : ''}`
      : 'Nenhum documento autorizado encontrado.';

  }

  async function carregarCategorias() {
    const { data, error } = await sb.rpc('segundo_cerebro_categorias');
    if (error) return;
    const valores = (Array.isArray(data) ? data : []).map(item => item.categoria).filter(Boolean);
    categoria.replaceChildren(new Option('Todas as categorias', ''), ...valores.map(valor => new Option(valor, valor)));
  }

  formBusca.addEventListener('submit', evento => {
    evento.preventDefault();
    buscar();
  });
  mais.addEventListener('click', () => buscar({ acrescentar: true }));

  formUpload.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (!elemento('segundoCerebroConfirmacao').checked) return;
    const arquivo = elemento('segundoCerebroArquivo').files?.[0];
    enviar.disabled = true;
    status.textContent = 'Protegendo e enviando o documento...';
    let caminho = '';
    try {
      const ext = validarArquivo(arquivo);
      const hash = await sha256(arquivo);
      const id = crypto.randomUUID();
      caminho = `${new Date().getUTCFullYear()}/${id}/${nomeSeguro(arquivo.name)}`;
      const { error: erroUpload } = await sb.storage.from(BUCKET).upload(caminho, arquivo, {
        cacheControl: '0',
        contentType: arquivo.type || undefined,
        upsert: false,
      });
      if (erroUpload) throw erroUpload;
      const registro = {
        id,
        titulo: texto(elemento('segundoCerebroTitulo').value),
        categoria: texto(elemento('segundoCerebroNovaCategoria').value),
        resumo: texto(elemento('segundoCerebroResumo').value) || null,
        data_documento: elemento('segundoCerebroData').value || null,
        tipo: ext.toUpperCase(),
        nome_original: arquivo.name,
        storage_path: caminho,
        tamanho_bytes: arquivo.size,
        sha256: hash,
      };
      const { error: erroRegistro } = await sb.from('segundo_cerebro_documentos').insert(registro);
      if (erroRegistro) {
        await sb.storage.from(BUCKET).remove([caminho]);
        throw erroRegistro;
      }
      formUpload.reset();
      status.textContent = 'Documento adicionado ao acervo protegido.';
      await buscar();
    } catch {
      status.textContent = 'Não foi possível enviar a cópia. Confira o formato, o tamanho e sua sessão administrativa.';
    } finally {
      enviar.disabled = false;
    }
  });

  await carregarCategorias();
  await buscar();
}

