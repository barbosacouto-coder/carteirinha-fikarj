function quadro(canvas, titulo, corpo, numero, total) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const margem = 86;
  ctx.fillStyle = '#091b32';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#32b9ca';
  ctx.fillRect(margem, 135, 95, 8);
  ctx.font = 'bold 32px system-ui';
  ctx.fillText('FIKARJ', margem, 110);
  ctx.fillStyle = '#f5f8fc';
  ctx.font = 'bold 66px system-ui';
  let y = escrever(ctx, titulo, margem, 270, width - 2 * margem, 78);
  ctx.fillStyle = '#d4e3f2';
  ctx.font = '46px system-ui';
  y = escrever(ctx, corpo, margem, y + 80, width - 2 * margem, 59);
  if (y > height - 160) throw new Error('Reduza o texto de cada slide para caber na arte.');
  ctx.fillStyle = '#32b9ca';
  ctx.font = '32px system-ui';
  ctx.fillText(numero + ' / ' + total, margem, height - 90);
}

function escrever(ctx, texto, x, y, largura, altura) {
  let linha = '';
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    if (ctx.measureText(palavra).width > largura) throw new Error('Há uma palavra maior que a largura da arte.');
    const candidata = linha ? linha + ' ' + palavra : palavra;
    if (ctx.measureText(candidata).width > largura) {
      ctx.fillText(linha, x, y);
      y += altura;
      linha = palavra;
    } else {
      linha = candidata;
    }
  }
  ctx.fillText(linha, x, y);
  return y + altura;
}

function baixar(blob, nome) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function gerarVideo(canvas, slides, titulo) {
  const formato = ['video/mp4;codecs=avc1.42001f', 'video/mp4'].find(tipo => globalThis.MediaRecorder?.isTypeSupported(tipo));
  if (!formato || typeof canvas.captureStream !== 'function') {
    throw new Error('Este navegador não oferece gravação MP4. Use um vídeo MP4 já produzido.');
  }
  quadro(canvas, titulo, slides[0], 1, slides.length);
  for (const [i, slide] of slides.entries()) quadro(canvas, titulo, slide, i + 1, slides.length);
  quadro(canvas, titulo, slides[0], 1, slides.length);
  const fluxo = canvas.captureStream(30);
  let gravador;
  try {
    gravador = new MediaRecorder(fluxo, { mimeType: formato, videoBitsPerSecond: 4500000 });
  } catch (erro) {
    fluxo.getTracks().forEach(track => track.stop());
    throw erro;
  }
  return new Promise((resolve, reject) => {
    const partes = [];
    const inicio = performance.now();
    let frame;
    function limpar() {
      cancelAnimationFrame(frame);
      fluxo.getTracks().forEach(track => track.stop());
    }
    gravador.ondataavailable = evento => { if (evento.data.size) partes.push(evento.data); };
    gravador.onerror = () => { limpar(); reject(new Error('Falha na geração do vídeo.')); };
    gravador.onstop = () => {
      limpar();
      if (!partes.length) reject(new Error('O navegador não gerou dados de vídeo.'));
      else resolve(new Blob(partes, { type: 'video/mp4' }));
    };
    function desenhar(agora) {
      const indice = Math.floor((agora - inicio) / 4000);
      if (indice >= slides.length) {
        if (gravador.state === 'recording') gravador.stop();
        return;
      }
      quadro(canvas, titulo, slides[indice], indice + 1, slides.length);
      frame = requestAnimationFrame(desenhar);
    }
    try {
      gravador.start();
      frame = requestAnimationFrame(desenhar);
    } catch (erro) { limpar(); reject(erro); }
  });
}

export function iniciarArquivosMidias() {
  const raiz = document.getElementById('midiasGerarArquivos');
  if (!raiz || raiz.dataset.iniciado) return;
  raiz.dataset.iniciado = 'true';
  const formulario = raiz.closest('form');
  raiz.innerHTML = `
    <fieldset class="space-y-2 rounded border border-slate-700 p-3">
      <legend class="px-2 font-semibold">Criar arquivos da peça</legend>
      <label class="block">Conteúdo dos slides, um por linha
        <textarea class="inp" data-arquivos-texto rows="3" maxlength="2800"></textarea>
      </label>
      <p class="text-sm text-slate-300">Use o tema como título. O Reel será um vídeo vertical de texto sem áudio.</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded border border-slate-500 px-3 py-2" data-arquivos-jpg>Preparar imagens JPG</button>
        <button type="button" class="rounded border border-slate-500 px-3 py-2" data-arquivos-mp4>Gerar Reel MP4</button>
      </div>
      <p role="status" data-arquivos-status></p>
      <div class="flex flex-wrap gap-2" data-arquivos-saida></div>
    </fieldset>`;
  const status = raiz.querySelector('[data-arquivos-status]');
  const saida = raiz.querySelector('[data-arquivos-saida]');
  const botoes = raiz.querySelectorAll('button');
  function adicionarDownload(blob, nome) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'rounded border border-slate-500 px-3 py-2';
    botao.textContent = 'Baixar ' + nome;
    botao.addEventListener('click', () => baixar(blob, nome));
    saida.append(botao);
  }
  async function gerar(video) {
    const titulo = formulario.elements.tema.value.trim();
    const slides = raiz.querySelector('[data-arquivos-texto]').value.split(/\r?\n/).map(texto => texto.trim()).filter(Boolean);
    if (!titulo || slides.length < 2 || slides.length > 10) {
      status.textContent = 'Preencha o tema e informe de dois a dez slides.';
      return;
    }
    saida.replaceChildren();
    botoes.forEach(botao => { botao.disabled = true; });
    status.textContent = video ? 'Gerando vídeo. Mantenha esta aba visível.' : 'Preparando as imagens.';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = video ? 1920 : 1350;
      if (video) {
        adicionarDownload(await gerarVideo(canvas, slides, titulo), 'reel-fikarj.mp4');
      } else {
        const imagens = [];
        for (const [indice, slide] of slides.entries()) {
          quadro(canvas, titulo, slide, indice + 1, slides.length);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
          if (!blob) throw new Error('Não foi possível gerar a imagem.');
          imagens.push(blob);
        }
        imagens.forEach((blob, indice) => adicionarDownload(blob, 'slide-' + (indice + 1) + '.jpg'));
      }
      status.textContent = 'Arquivos prontos para baixar e revisar.';
    } catch (erro) {
      status.textContent = erro.message;
    } finally {
      botoes.forEach(botao => { botao.disabled = false; });
    }
  }
  botoes[0].addEventListener('click', () => gerar(false));
  botoes[1].addEventListener('click', () => gerar(true));
}
