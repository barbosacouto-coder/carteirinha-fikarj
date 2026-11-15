const indicadores = {
  presidenciaFiliados: 'filiados',
  presidenciaFotos: 'fotos_pendentes',
  presidenciaCobrancas: 'cobrancas_abertas',
  presidenciaVencidas: 'cobrancas_vencidas',
  presidenciaDocumentos: 'documentos_rascunho',
};

const formatoNumero = new Intl.NumberFormat('pt-BR');
const formatoData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
});

let consultaEmCurso;
let ultimaConsulta;

function formatarContagem(valor) {
  if (typeof valor !== 'number' && (typeof valor !== 'string' || !/^\d+$/.test(valor))) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? formatoNumero.format(numero) : null;
}

async function consultarResumo(sb, status, botao) {
  status.textContent = 'Consultando indicadores…';
  if (botao) botao.disabled = true;

  try {
    const { data, error } = await sb.rpc('presidencia_resumo_fikarj');
    const resumo = Array.isArray(data) ? data[0] : data;
    if (error || !resumo || typeof resumo !== 'object') throw new Error('Resumo indisponível.');

    let indisponiveis = 0;
    for (const [id, campo] of Object.entries(indicadores)) {
      const elemento = document.getElementById(id);
      const valor = formatarContagem(resumo[campo]);
      if (valor === null) indisponiveis++;
      if (elemento) elemento.textContent = valor ?? '—';
    }

    const registro = typeof resumo.consultado_em === 'string' ? Date.parse(resumo.consultado_em) : NaN;
    ultimaConsulta = Number.isFinite(registro) ? formatoData.format(registro) : undefined;
    status.textContent = [
      ultimaConsulta ? `Consulta em ${ultimaConsulta} (Brasília).` : 'Horário da consulta indisponível.',
      indisponiveis ? 'Indicadores com traço estão indisponíveis.' : '',
    ].filter(Boolean).join(' ');
  } catch {
    status.textContent = ultimaConsulta
      ? `Falha ao atualizar. Última consulta em ${ultimaConsulta} (Brasília).`
      : 'Não foi possível consultar os indicadores. Tente novamente.';
  } finally {
    if (botao) botao.disabled = false;
  }
}

export function atualizarVisaoPresidencia(sb) {
  if (consultaEmCurso) return consultaEmCurso;
  const status = document.getElementById('presidenciaStatus');
  if (!status) return Promise.resolve();
  const botao = document.getElementById('presidenciaAtualizar');
  consultaEmCurso = consultarResumo(sb, status, botao).finally(() => {
    consultaEmCurso = undefined;
  });
  return consultaEmCurso;
}

const botoesIniciados = new WeakSet();

export function iniciarVisaoPresidencia(sb) {
  const botao = document.getElementById('presidenciaAtualizar');
  if (botao && !botoesIniciados.has(botao)) {
    botoesIniciados.add(botao);
    botao.addEventListener('click', () => void atualizarVisaoPresidencia(sb));
  }
  return atualizarVisaoPresidencia(sb);
}
