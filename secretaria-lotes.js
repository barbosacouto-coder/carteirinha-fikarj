const BUCKET = 'secretaria-documentos';
const MAX_DESTINATARIOS = 100;
const CAMPOS = ['nome', 'associacao', 'cargo', 'tratamento', 'endereco'];

function node(tag, text, attributes = {}) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  Object.assign(element, attributes);
  return element;
}

function button(text, action) {
  const element = node('button', text, {type: 'button', className: 'rounded border border-gray-600 px-3 py-2'});
  element.addEventListener('click', action);
  return element;
}

function normalized(value) {
  return String(value ?? '').trim().normalize('NFKC').replace(/\s+/g, ' ');
}

function filename(value) {
  return normalized(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100) || 'documento';
}

async function hash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}

async function resource(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw Error('O modelo institucional não pôde ser carregado.');
  return response.arrayBuffer();
}

let modelPromise;
async function model() {
  modelPromise ??= (async () => {
    const response = await fetch(new URL('./secretaria-modelo-034.json', import.meta.url));
    if (!response.ok) throw Error('Modelo institucional indisponível.');
    const manifest = await response.json();
    const [background, regular, bold] = await Promise.all([
      resource(manifest.background), resource(manifest.fontRegular), resource(manifest.fontBold),
    ]);
    return {...manifest, image: 'data:image/png;base64,' + base64(background), regular: base64(regular), bold: base64(bold)};
  })().catch(error => { modelPromise = undefined; throw error; });
  return modelPromise;
}

export function personalize(text, recipient) {
  return String(text).replace(/\{\{(nome|associacao|cargo|tratamento|endereco)\}\}/g, (_, key) => recipient[key] || '');
}

export function validateRecipients(recipients, body = '') {
  const seen = new Set();
  return recipients.filter(recipient => {
    const key = CAMPOS.map(field => normalized(recipient[field]).toLocaleLowerCase('pt-BR')).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(recipient => {
    const missing = ['nome', 'cargo', 'tratamento'].filter(field => !normalized(recipient[field]));
    for (const field of CAMPOS) if (body.includes('{{' + field + '}}') && !normalized(recipient[field])) missing.push(field);
    return {recipient, missing: [...new Set(missing)]};
  });
}

export async function createDocumentPdf(content, recipient, protocol = null, template = null) {
  template ??= await model();
  if (template.versao !== content.modelo_versao) throw Error('A versão do modelo deste lote precisa ser recuperada.');
  if (!window.jspdf?.jsPDF) throw Error('Biblioteca PDF indisponível.');
  const page = template.page;
  const pdf = new window.jspdf.jsPDF({unit: 'mm', format: [page.width, page.height]});
  pdf.addFileToVFS('Secretaria-Regular.ttf', template.regular);
  pdf.addFont('Secretaria-Regular.ttf', 'Secretaria', 'normal');
  pdf.addFileToVFS('Secretaria-Bold.ttf', template.bold);
  pdf.addFont('Secretaria-Bold.ttf', 'Secretaria', 'bold');
  const available = page.width - page.left - page.right;
  const lineHeight = 6;
  let y;
  const addPage = (first = false) => {
    if (!first) pdf.addPage();
    pdf.addImage(template.image, 'PNG', 0, 0, page.width, page.height);
    pdf.setFont('Secretaria', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(130, 40, 40);
    pdf.text(protocol?.startsWith('TESTE') ? 'TESTE — SEM VALIDADE OFICIAL' : 'MINUTA — PENDENTE DE APROVAÇÃO E ASSINATURA', page.left, page.top - 5);
    pdf.setTextColor(25, 25, 25);
    pdf.setFontSize(11);
    y = page.top;
  };
  const paragraph = (value, bold = false, gap = 3) => {
    pdf.setFont('Secretaria', bold ? 'bold' : 'normal');
    const lines = pdf.splitTextToSize(String(value), available);
    for (const line of lines) {
      if (y + lineHeight > page.bottom) addPage();
      pdf.setFont('Secretaria', bold ? 'bold' : 'normal');
      pdf.text(line, page.left, y);
      y += lineHeight;
    }
    y += gap;
  };
  addPage(true);
  const documentDate = new Date(content.data + 'T12:00:00-03:00').toLocaleDateString('pt-BR', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'});
  paragraph(content.tipo.toLocaleUpperCase('pt-BR') + ' · ' + (protocol || 'PRÉVIA SEM PROTOCOLO'), true);
  paragraph(content.local + ', ' + documentDate + '.');
  paragraph([recipient.tratamento, recipient.nome].filter(Boolean).join(' '), true);
  if (recipient.cargo) paragraph(recipient.cargo, false, 0);
  if (recipient.associacao) paragraph(recipient.associacao, false, 0);
  if (recipient.endereco) paragraph(recipient.endereco);
  else y += 3;
  paragraph('Assunto: ' + personalize(content.assunto, recipient), true);
  const body = personalize(content.corpo, recipient).trimEnd().split(/\r?\n/);
  for (const [index, text] of body.entries()) {
    if (index === body.length - 1) {
      const height = pdf.splitTextToSize(text || ' ', available).length * lineHeight + 32;
      if (height <= page.bottom - page.top && y + height > page.bottom) addPage();
    }
    paragraph(text || ' ', false, 2);
  }
  if (y + 25 > page.bottom) addPage();
  y += 6;
  paragraph(content.signatario, true, 0);
  paragraph(content.cargo_signatario);
  const count = pdf.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    pdf.setPage(i);
    pdf.setFont('Secretaria', 'normal');
    pdf.setFontSize(8);
    pdf.text(`${i}/${count}`, page.width - page.right, page.bottom + 5, {align: 'right'});
  }
  return pdf.output('blob');
}

// ZIP sem compressão. Cada entrada contém o PDF completo e seu CRC-32.
export async function createZip(files) {
  const local = [], directory = [];
  let offset = 0;
  const encode = new TextEncoder();
  const header = (size, fill) => { const bytes = new Uint8Array(size); fill(new DataView(bytes.buffer)); return bytes; };
  for (const file of files) {
    const name = encode.encode(file.name);
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    local.push(header(30, view => {
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
      view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, name.length, true);
    }), name, bytes);
    directory.push(header(46, view => {
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, 0x800, true);
      view.setUint32(16, crc, true); view.setUint32(20, bytes.length, true); view.setUint32(24, bytes.length, true); view.setUint16(28, name.length, true); view.setUint32(42, offset, true);
    }), name);
    offset += 30 + name.length + bytes.length;
  }
  const directorySize = directory.reduce((total, bytes) => total + bytes.length, 0);
  const end = header(22, view => {
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
    view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
  });
  return new Blob([...local, ...directory, end], {type: 'application/zip'});
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = node('a', '', {href: url, download: name});
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function iniciarSecretariaLotes(sb) {
  const root = document.getElementById('secretariaLotes');
  if (!root || root.dataset.iniciado) return;
  root.dataset.iniciado = 'true';
  root.innerHTML = `
    <h3 class="font-bold text-lg">Criar documentos em lote</h3>
    <form class="grid gap-3 mt-3">
      <label>Modelo <select name="modelo" class="inp block w-full"><option>Ofício 034 · Institucional</option></select></label>
      <label>Tipo <select name="tipo" class="inp block w-full"><option>Ofício</option><option>Convocação</option><option>Declaração</option><option>Carta</option><option>Certificado</option></select></label>
      <label>Assunto <input name="assunto" required maxlength="240" class="inp block w-full"></label>
      <label>Texto <textarea name="corpo" required maxlength="30000" rows="8" class="inp block w-full"></textarea></label>
      <p class="text-sm">Personalize o texto com {{nome}}, {{associacao}}, {{cargo}}, {{tratamento}} e {{endereco}}.</p>
      <div class="grid gap-3 sm:grid-cols-2"><label>Local <input name="local" required maxlength="160" class="inp block w-full"></label><label>Data <input name="data" type="date" required class="inp block w-full"></label></div>
      <label>Signatário <input name="signatario" required maxlength="240" class="inp block w-full"></label>
      <label>Cargo do signatário <input name="cargo_signatario" required maxlength="240" class="inp block w-full"></label>
      <label>Associações <select name="associacoes" multiple size="5" class="inp block w-full"></select></label>
      <div class="flex gap-2 flex-wrap" data-actions></div>
      <p class="text-sm">Complete o nome do responsável, cargo e tratamento de cada destinatário. Endereço é opcional.</p>
      <div class="overflow-x-auto"><table class="w-full"><thead><tr><th>Nome</th><th>Associação</th><th>Cargo</th><th>Tratamento</th><th>Endereço</th><th></th></tr></thead><tbody></tbody></table></div>
      <label><input name="teste" type="checkbox" checked> Usar sequência de teste</label>
      <div class="flex gap-2 flex-wrap" data-review-actions></div>
      <p role="status" aria-live="polite" data-status></p>
      <div data-previews class="grid gap-3"></div>
    </form>
    <div class="mt-5 border-t border-gray-600 pt-4"><h3 class="font-bold">Lotes e documentos</h3><div data-history-actions></div><div data-history class="grid gap-3 mt-3"></div></div>`;
  const form = root.querySelector('form');
  form.addEventListener('submit', event => event.preventDefault());
  form.elements.data.value = new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/Sao_Paulo'}).format(new Date());
  const status = root.querySelector('[data-status]');
  const table = root.querySelector('tbody');
  const previews = root.querySelector('[data-previews]');
  const history = root.querySelector('[data-history]');
  const actions = root.querySelector('[data-actions]');
  const review = root.querySelector('[data-review-actions]');
  let draft = null;
  let lastRequestKey = null;
  let newRequest = false;
  let busy = false;
  const urls = [];
  const clearPreviews = () => { urls.splice(0).forEach(url => URL.revokeObjectURL(url)); previews.replaceChildren(); draft = null; };
  form.addEventListener('input', clearPreviews);
  form.addEventListener('change', clearPreviews);
  const fail = error => { status.textContent = error.message || 'Operação não confirmada. Tente retomar o lote.'; };
  const row = (recipient = {}) => {
    clearPreviews();
    const tr = node('tr');
    for (const field of CAMPOS) {
      const td = node('td');
      const input = node('input', '', {value: recipient[field] || '', className: 'inp w-full', maxLength: field === 'endereco' ? 600 : 240});
      input.dataset.field = field;
      input.setAttribute('aria-label', field + ' do destinatário');
      td.append(input); tr.append(td);
    }
    const td = node('td');
    td.append(button('Remover', () => { tr.remove(); clearPreviews(); }));
    tr.append(td); table.append(tr);
  };
  actions.append(button('Adicionar associações selecionadas', () => {
    for (const option of form.elements.associacoes.selectedOptions) row({associacao: option.textContent});
  }), button('Adicionar outro destinatário', () => row()));
  const recipients = () => [...table.rows].map(tr => Object.fromEntries([...tr.querySelectorAll('input')].map(input => [input.dataset.field, normalized(input.value)])));
  async function preview() {
    if (!form.reportValidity() || busy) return;
    clearPreviews();
    const content = Object.fromEntries(['tipo', 'assunto', 'corpo', 'local', 'data', 'signatario', 'cargo_signatario'].map(field => [field, form.elements[field].value.trim()]));
    const checked = validateRecipients(recipients(), content.corpo + content.assunto);
    if (!checked.length || checked.length > MAX_DESTINATARIOS) throw Error('Informe de 1 a ' + MAX_DESTINATARIOS + ' destinatários.');
    if (checked.some(item => item.missing.length)) throw Error(checked.filter(item => item.missing.length).map(({recipient, missing}) => (recipient.nome || 'Destinatário sem nome') + ': complete ' + missing.join(', ')).join('\n'));
    busy = true;
    try {
      const template = await model();
      content.modelo_versao = template.versao;
      for (const {recipient} of checked) {
        const blob = await createDocumentPdf(content, recipient, null, template);
        const url = URL.createObjectURL(blob); urls.push(url);
        const card = node('div', '', {className: 'border border-gray-600 rounded p-3'});
        card.append(node('p', recipient.nome + ' · ' + recipient.associacao));
        card.append(node('a', 'Abrir prévia PDF', {href: url, target: '_blank', rel: 'noopener', className: 'underline'}));
        previews.append(card);
      }
      draft = {content, recipients: checked.map(item => item.recipient), test: form.elements.teste.checked};
      status.textContent = checked.length + ' prévias prontas. Confira cada documento antes de reservar os protocolos.';
    } finally { busy = false; }
  }
  review.append(button('Preparar prévias', () => preview().catch(fail)));
  async function rpc(name, parameters) {
    const {data, error} = await sb.rpc(name, parameters);
    if (error) throw Error(error.message || 'Operação recusada. Confira o acesso administrativo.');
    return data;
  }
  async function getBatch(id) {
    return rpc('obter_lote_documentos_fikarj', {p_lote: id});
  }
  async function storedFile(path, expectedHash) {
    const {data, error} = await sb.storage.from(BUCKET).download(path);
    if (error) throw Error('PDF arquivado indisponível.');
    if (await hash(await data.arrayBuffer()) !== expectedHash) throw Error('O PDF arquivado diverge do registro.');
    return data;
  }
  async function itemFile(batch, item) {
    if (item.pdf_sha256) {
      return storedFile(item.arquivo_path, item.pdf_sha256);
    }
    if (item.estado_protocolo === 'cancelado') throw Error('Protocolo cancelado.');
    let blob = await createDocumentPdf(batch.conteudo, item.destinatario, item.protocolo);
    const path = item.arquivo_path;
    const uploaded = await sb.storage.from(BUCKET).upload(path, blob, {contentType: 'application/pdf', upsert: false});
    if (uploaded.error) {
      const existing = await sb.storage.from(BUCKET).download(path);
      if (existing.error) throw Error('Upload não confirmado. Retome este lote para conferir o arquivo.');
      blob = existing.data;
    }
    const sha = await hash(await blob.arrayBuffer());
    await rpc('anexar_pdf_lote_fikarj', {p_item: item.id, p_path: path, p_sha256: sha});
    return blob;
  }
  const pdfName = item => filename(item.protocolo + ' - ' + item.destinatario.nome) + '.pdf';
  async function renderBatch(batch) {
    history.replaceChildren();
    const title = node('p', (batch.teste ? 'Lote de teste' : 'Lote de rascunhos') + ' · ' + batch.conteudo.assunto);
    history.append(title);
    const controls = node('div', '', {className: 'flex gap-2 flex-wrap'});
    controls.append(button('Gerar ou retomar PDFs', () => generate(batch).catch(fail)), button('Baixar ZIP', async () => {
      if (busy) return;
      busy = true;
      try {
        const current = await getBatch(batch.lote_id);
        const files = [];
        for (const item of current.itens) {
          if (item.estado_protocolo === 'cancelado') continue;
          if (!item.pdf_sha256) throw Error('Gere os PDFs pendentes antes de baixar o ZIP.');
          const final = item.final_sha256;
          files.push({name: (final ? 'Emitido - ' : 'Minuta - ') + pdfName(item), blob: final ? await storedFile(item.arquivo_final_path, final) : await itemFile(current, item)});
        }
        if (!files.length) throw Error('Este lote não tem documentos disponíveis para o ZIP.');
        download(await createZip(files), filename('Lote - ' + current.conteudo.assunto) + '.zip');
      } catch (error) { fail(error); } finally { busy = false; }
    }));
    history.append(controls);
    for (const item of batch.itens) {
      const card = node('div', '', {className: 'border border-gray-600 rounded p-3'});
      card.append(node('p', item.protocolo + ' · ' + item.destinatario.nome + ' · ' + (item.estado_protocolo || 'rascunho') + ' · ' + item.estado));
      if (item.motivo_cancelamento) card.append(node('p', 'Cancelamento: ' + item.motivo_cancelamento));
      if (item.pdf_sha256) card.append(button('Baixar PDF', async () => {
        try { download(await itemFile(batch, item), pdfName(item)); } catch (error) { fail(error); }
      }));
      else card.append(node('p', 'PDF pendente. Use Gerar ou retomar PDFs.'));
      if (item.final_sha256) card.append(button('Baixar PDF emitido', async () => {
        try { download(await storedFile(item.arquivo_final_path, item.final_sha256), 'Emitido - ' + pdfName(item)); } catch (error) { fail(error); }
      }));
      if (item.estado_protocolo === 'rascunho' && item.pdf_sha256 && !item.final_sha256) {
        const finalFile = node('input', '', {type: 'file', accept: 'application/pdf,.pdf'});
        finalFile.setAttribute('aria-label', 'PDF final de ' + item.destinatario.nome);
        const signatureReference = node('input', '', {type: 'text', placeholder: 'Referência da assinatura, se houver', maxLength: 500, className: 'inp block w-full'});
        signatureReference.setAttribute('aria-label', 'Referência da assinatura de ' + item.destinatario.nome);
        const confirmation = node('input', '', {type: 'checkbox'});
        const label = node('label', '', {className: 'block'});
        label.append(confirmation, document.createTextNode(' Conferi o PDF final e autorizo registrar a emissão.'));
        card.append(node('p', 'Anexe o PDF final aprovado. O arquivo de minuta será preservado.'), finalFile, signatureReference, label);
        card.append(button('Registrar emissão do PDF final', async () => {
          if (busy) return;
          const file = finalFile.files?.[0];
          if (!file || !confirmation.checked) { status.textContent = 'Selecione o PDF final e confirme a autorização de emissão.'; return; }
          if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 20 * 1024 * 1024 || file.size < 5) { status.textContent = 'Use um PDF de até 20 MB.'; return; }
          busy = true;
          try {
            const bytes = await file.arrayBuffer();
            if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw Error('Arquivo PDF inválido.');
            if (!confirm('Registrar a emissão de ' + item.protocolo + ' para ' + item.destinatario.nome + '?')) return;
            const digest = await hash(bytes);
            const uploaded = await sb.storage.from(BUCKET).upload(item.arquivo_final_path, file, {contentType: 'application/pdf', upsert: false});
            if (uploaded.error) await storedFile(item.arquivo_final_path, digest);
            await rpc('registrar_emissao_lote_fikarj', {p_item: item.id, p_sha256: digest, p_confirmacao: true, p_assinatura_referencia: signatureReference.value.trim() || null});
            await renderBatch(await getBatch(batch.lote_id));
            status.textContent = 'Emissão registrada. Confira o PDF emitido.';
          } catch (error) { fail(error); } finally { busy = false; }
        }));
      }
      if (!batch.teste && item.estado_protocolo !== 'cancelado') card.append(button('Cancelar protocolo', async () => {
        if (busy) return;
        const reason = prompt('Motivo do cancelamento de ' + item.protocolo + ':');
        if (!reason?.trim()) return;
        if (reason.trim().length > 240) { status.textContent = 'Use um motivo de até 240 caracteres.'; return; }
        busy = true;
        try {
          await rpc('cancelar_protocolo_fikarj', {p_ano: item.ano, p_numero: item.numero, p_motivo: reason.trim()});
          await renderBatch(await getBatch(batch.lote_id));
          status.textContent = 'Protocolo cancelado com motivo registrado.';
        } catch (error) { fail(error); } finally { busy = false; }
      }));
      history.append(card);
    }
  }
  async function generate(batch) {
    if (busy) return;
    busy = true;
    const failures = [];
    try {
      const current = await getBatch(batch.lote_id);
      for (let index = 0; index < current.itens.length; index++) {
        const item = current.itens[index];
        if (item.estado_protocolo === 'cancelado') continue;
        status.textContent = 'Conferindo PDF ' + (index + 1) + ' de ' + current.itens.length + '…';
        try { await itemFile(current, item); } catch (error) { failures.push(item.destinatario.nome + ': ' + error.message); }
      }
      await renderBatch(await getBatch(batch.lote_id));
      status.textContent = failures.length ? 'Retome os documentos com falha. ' + failures.join(' · ') : 'PDFs arquivados. Rascunhos aguardam aprovação e assinatura.';
    } finally { busy = false; }
  }
  review.append(button('Confirmar lote e reservar protocolos', async () => {
    if (busy) return;
    if (!draft) { status.textContent = 'Prepare e confira as prévias primeiro.'; return; }
    if (!confirm('Confirmar ' + draft.recipients.length + (draft.test ? ' protocolos de teste?' : ' protocolos oficiais para rascunhos?'))) return;
    const submission = structuredClone(draft);
    busy = true;
    try {
      const {data: auth, error} = await sb.auth.getSession();
      if (error || !auth.session) throw Error('Entre novamente como administrador.');
      const digest = await hash(new TextEncoder().encode(JSON.stringify(submission)));
      const key = 'fikarj-secretaria-lote:' + auth.session.user.id + ':' + digest;
      lastRequestKey = key;
      let request = localStorage.getItem(key);
      if (!request || newRequest) { request = crypto.randomUUID(); localStorage.setItem(key, request); }
      newRequest = false;
      const result = await rpc('preparar_lote_documentos_fikarj', {p_chave: request, p_teste: submission.test, p_conteudo: submission.content, p_destinatarios: submission.recipients});
      const batch = result.itens ? result : await getBatch(result.lote_id || result.id);
      await renderBatch(batch);
      status.textContent = 'Protocolos reservados. Gere os PDFs e confira o resultado.';
    } catch (error) { fail(error); } finally { busy = false; }
  }), button('Novo lote', () => {
    if (busy) return;
    if (lastRequestKey) localStorage.removeItem(lastRequestKey);
    lastRequestKey = null;
    newRequest = true;
    clearPreviews(); table.replaceChildren(); form.reset();
    form.elements.data.value = new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/Sao_Paulo'}).format(new Date());
    status.textContent = 'Preencha os dados do novo lote.';
  }));
  async function list() {
    if (busy) return;
    try {
      const batches = await rpc('listar_lotes_documentos_fikarj', {});
      history.replaceChildren();
      for (const batch of batches || []) history.append(button((batch.teste ? 'TESTE · ' : '') + batch.assunto + ' · ' + new Date(batch.criado_em).toLocaleDateString('pt-BR'), async () => {
        try { await renderBatch(await getBatch(batch.lote_id)); } catch (error) { fail(error); }
      }));
      if (!batches?.length) history.append(node('p', 'Nenhum lote registrado.'));
    } catch (error) { fail(error); }
  }
  root.querySelector('[data-history-actions]').append(button('Consultar lotes', list));
  try {
    const {data, error} = await sb.from('associacoes').select('sigla,nome').order('sigla');
    if (error) throw error;
    for (const association of data) form.elements.associacoes.append(node('option', association.nome + ' (' + association.sigla + ')', {value: association.sigla}));
  } catch { status.textContent = 'Associações indisponíveis. Você pode incluir destinatários manualmente.'; }
}
