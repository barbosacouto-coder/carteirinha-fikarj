export function conferirHistorico(backup) {
  const resultados = backup?.P?.resultados;
  if (!Array.isArray(resultados) || !resultados.length) {
    throw new Error('O arquivo deve conter o histórico de resultados do Painel Integrado.');
  }
  const ids = new Set();
  const eventos = new Map();
  for (const resultado of resultados) {
    const { id, ev, ck, atl, col } = resultado ?? {};
    if (!Number.isSafeInteger(id) || id < 1 || typeof ev !== 'string' || !ev.trim()
        || typeof ck !== 'string' || !ck.startsWith(ev + '|')
        || !Number.isInteger(col) || col < 1 || typeof atl !== 'string' || !atl.trim()) {
      throw new Error('O arquivo tem um resultado com identificação, categoria ou colocação inválida.');
    }
    if (ids.has(id)) throw new Error('O arquivo tem identificadores de resultados repetidos.');
    ids.add(id);
    eventos.set(ev, (eventos.get(ev) ?? 0) + 1);
  }
  return { resultados: ids.size, eventos };
}

const arquivo = globalThis.document?.getElementById('historicoRankingArquivo');
arquivo?.addEventListener('change', async () => {
  const resultado = document.getElementById('historicoRankingStatus');
  const selecionado = arquivo.files[0];
  resultado.textContent = '';
  if (!selecionado) return;
  try {
    const backup = JSON.parse((await selecionado.text()).replace(/^\uFEFF/, ''));
    if (arquivo.files[0] !== selecionado) return;
    const resumo = conferirHistorico(backup);
    resultado.textContent = [
      `${resumo.resultados} resultados em ${resumo.eventos.size} eventos.`,
      ...Array.from(resumo.eventos, ([evento, total]) => `${evento} · ${total} resultados`),
      'Conferência concluída. Nenhum dado foi gravado.',
    ].join('\n');
  } catch (erro) {
    if (arquivo.files[0] === selecionado) {
      resultado.textContent = erro instanceof SyntaxError ? 'O arquivo não contém JSON válido.' : erro.message;
    }
  }
});
