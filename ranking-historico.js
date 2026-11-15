import categoriasBase from './ranking-categorias.js';

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

export function pontuarHistorico(dados) {
  conferirHistorico({ P: dados });
  const categorias = new Map(Object.entries(categoriasBase));
  for (const categoria of dados.catsExtra ?? []) {
    if (!categorias.has(categoria.k)) categorias.set(categoria.k, [categoria.mod, categoria.amin]);
  }
  return dados.resultados.map(resultado => {
    const categoria = categorias.get(resultado.ck);
    if (!categoria) throw new Error('Categoria sem modalidade cadastrada: ' + resultado.ck);
    const [modalidade, idadeMinima] = categoria;
    const colocacao = resultado.col === 4 && dados.k4?.[resultado.ev] && modalidade === 'Kumite'
      ? 3
      : resultado.col;
    const base = dados.esquemas?.[resultado.ev]?.[colocacao];
    const peso = dados.pesos?.[resultado.ev]?.[idadeMinima != null && idadeMinima >= 18 ? 'a' : 'g'] ?? 1;
    if (!Number.isFinite(base) || !Number.isFinite(peso)) {
      throw new Error('Pontuação inválida no evento ' + resultado.ev + '.');
    }
    return { ...resultado, modalidade, colocacao, pontos: base * peso };
  });
}

export function iniciarHistoricoRanking(sb) {
  const arquivo = document.getElementById('historicoRankingArquivo');
  const status = document.getElementById('historicoRankingStatus');
  const salvar = document.getElementById('salvarHistoricoRanking');
  const consultar = document.getElementById('consultarHistoricoRanking');
  const busca = document.getElementById('historicoRankingAtleta');
  const pontuacao = document.getElementById('historicoRankingPontuacao');
  let dados;
  let pontuados = [];

  const normalizar = texto => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function mostrarPontuacao() {
    const termo = normalizar(busca.value.trim());
    if (!termo) {
      pontuacao.textContent = '';
      return;
    }
    const encontrados = pontuados.filter(r => normalizar(r.atl).includes(termo));
    pontuacao.textContent = encontrados.length
      ? encontrados.map(r => `${r.atl} · ${r.ck} · ${r.colocacao}º · ${r.pontos} pontos`).join('\n')
      : 'Nenhum resultado encontrado.';
  }
  busca.addEventListener('input', mostrarPontuacao);

  function mostrar(backup, mensagem) {
    const resumo = conferirHistorico(backup);
    pontuados = pontuarHistorico(backup.P);
    busca.disabled = false;
    mostrarPontuacao();
    status.textContent = [
      `${resumo.resultados} resultados em ${resumo.eventos.size} eventos.`,
      mensagem,
    ].join('\n');
  }

  arquivo.addEventListener('change', async () => {
    const selecionado = arquivo.files[0];
    dados = undefined;
    pontuados = [];
    busca.disabled = true;
    pontuacao.textContent = '';
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
