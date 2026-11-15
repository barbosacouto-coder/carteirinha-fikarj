import { chaveAssociacao } from './ranking-publicacao.js?v=2';

/**
 * Consolida resultados já pontuados para relatórios por evento, categoria ou
 * associação. Não altera os resultados de entrada nem depende do DOM.
 *
 * @param {Array<object>} resultadosPontuados resultados de pontuarHistorico()
 * @param {'evento'|'categoria'|'associacao'} agrupamento dimensão do resumo
 * @param {string} [eventoOpcional] limita o cálculo a este código de evento
 * @returns {Array<{chave:string,resultados:number,ouro:number,prata:number,bronze:number,quarto:number,pontos:number}>}
 */
export function resumirRelatorio(resultadosPontuados, agrupamento, eventoOpcional) {
  const campos = {
    evento: 'ev',
    categoria: 'ck',
    associacao: null,
  };
  if (!Object.hasOwn(campos, agrupamento)) {
    throw new Error('Agrupamento inválido. Use evento, categoria ou associacao.');
  }
  if (!Array.isArray(resultadosPontuados)) {
    throw new Error('Os resultados pontuados devem ser fornecidos em uma lista.');
  }
  if (eventoOpcional != null && (typeof eventoOpcional !== 'string' || !eventoOpcional.trim())) {
    throw new Error('O filtro de evento deve ser um código não vazio.');
  }

  const grupos = new Map();
  for (const resultado of resultadosPontuados) {
    if (!resultado || typeof resultado !== 'object') {
      throw new Error('Há um resultado pontuado inválido.');
    }
    if (eventoOpcional != null && resultado.ev !== eventoOpcional) continue;
    if (typeof resultado.pontos !== 'number' || !Number.isFinite(resultado.pontos)) {
      throw new Error('Há um resultado com pontuação inválida.');
    }

    let chave;
    if (agrupamento === 'associacao') {
      // AFCDF registra a equipe responsável pelo resultado; or_ guarda a
      // associação de origem do atleta, usada no ranking individual.
      chave = chaveAssociacao(resultado.eq === 'AFCDF' ? resultado.or_ : resultado.eq) || 'Sem associação informada';
    } else {
      chave = resultado[campos[agrupamento]];
    }
    if (typeof chave !== 'string' || !chave.trim()) {
      throw new Error('Há um resultado sem chave para o agrupamento solicitado.');
    }

    let resumo = grupos.get(chave);
    if (!resumo) {
      resumo = {
        chave,
        resultados: 0,
        ouro: 0,
        prata: 0,
        bronze: 0,
        quarto: 0,
        pontos: 0,
      };
      grupos.set(chave, resumo);
    }
    resumo.resultados++;
    resumo.pontos += resultado.pontos;
    if (resultado.colocacao === 1) resumo.ouro++;
    else if (resultado.colocacao === 2) resumo.prata++;
    else if (resultado.colocacao === 3) resumo.bronze++;
    else if (resultado.colocacao === 4) resumo.quarto++;
  }

  return [...grupos.values()].sort((a, b) => b.pontos - a.pontos || a.chave.localeCompare(b.chave));
}
