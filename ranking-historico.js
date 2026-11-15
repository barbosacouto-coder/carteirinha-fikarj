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

export function iniciarHistoricoRanking(sb) {
  const arquivo = document.getElementById('historicoRankingArquivo');
  const status = document.getElementById('historicoRankingStatus');
  const salvar = document.getElementById('salvarHistoricoRanking');
  const consultar = document.getElementById('consultarHistoricoRanking');
  let dados;

  function mostrar(backup, mensagem) {
    const resumo = conferirHistorico(backup);
    status.textContent = [
      `${resumo.resultados} resultados em ${resumo.eventos.size} eventos.`,
      mensagem,
    ].join('\n');
  }

  arquivo.addEventListener('change', async () => {
    const selecionado = arquivo.files[0];
    dados = undefined;
    salvar.disabled = true;
    status.textContent = '';
    if (!selecionado) return;
    try {
      const backup = JSON.parse((await selecionado.text()).replace(/^\uFEFF/, ''));
      if (arquivo.files[0] !== selecionado) return;
      mostrar(backup, 'Arquivo conferido. Você pode guardar esta versão no Portal.');
      const { resultados, esquemas, pesos, k4, catsExtra } = backup.P;
      dados = { resultados, esquemas, pesos, k4, catsExtra };
      salvar.disabled = false;
    } catch (erro) {
      if (arquivo.files[0] === selecionado) {
        status.textContent = erro instanceof SyntaxError ? 'O arquivo não contém JSON válido.' : erro.message;
      }
    }
  });

  salvar.addEventListener('click', async () => {
    if (!dados) return;
    arquivo.disabled = salvar.disabled = consultar.disabled = true;
    try {
      const { error } = await sb.from('ranking_historico_fikarj').insert({ dados });
      if (error?.code === '23505') {
        mostrar({ P: dados }, 'Esta versão já está guardada no Portal.');
      } else if (error) {
        throw error;
      } else {
        mostrar({ P: dados }, 'Histórico guardado. O ranking publicado permanece com a versão atual.');
      }
    } catch {
      status.textContent = 'O Portal não conseguiu guardar o histórico. Você pode tentar novamente.';
    } finally {
      arquivo.disabled = salvar.disabled = consultar.disabled = false;
    }
  });

  consultar.addEventListener('click', async () => {
    consultar.disabled = true;
    try {
      const { data, error } = await sb.from('ranking_historico_fikarj')
        .select('dados').order('criado_em', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (data) mostrar({ P: data.dados }, 'Último histórico guardado no Portal.');
      else status.textContent = 'Ainda não há histórico guardado.';
    } catch {
      status.textContent = 'O Portal não conseguiu consultar o histórico.';
    } finally {
      consultar.disabled = false;
    }
  });
}
