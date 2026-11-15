import { eventos } from './ranking-categorias.js?v=2';

export const chaveNome = texto => texto.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase();

function chaveAssociacao(sigla) {
  const chave = String(sigla ?? '').trim().toUpperCase();
  return chave === 'AKATZUKI' ? 'AKATSUKI' : chave;
}

function novoResumo(atleta) {
  return {
    Atleta: atleta.nome, Pontos: 0, Ouro: 0, Prata: 0, Bronze: 0, '4º': 0,
    Eventos: new Set(), Modalidades: new Set(),
  };
}

function somar(resumo, resultado) {
  const medalha = ['Ouro', 'Prata', 'Bronze', '4º'][resultado.colocacao - 1];
  if (medalha) resumo[medalha]++;
  resumo.Pontos += resultado.pontos;
  resumo.Eventos.add(eventos[resultado.ev].curto);
  resumo.Modalidades.add(resultado.modalidade);
}

function consolidar(resumos) {
  return Array.from(resumos.values(), resumo => ({
    ...resumo,
    Eventos: [...resumo.Eventos].join(', '),
    Modalidades: [...resumo.Modalidades].join(', '),
  }));
}

export function calcularLote(pontuados, atletas) {
  const cadastro = new Map();
  for (const atleta of atletas) {
    if (atleta.registro == null || !['2026', '2027'].includes(String(atleta.anuidade))) continue;
    const chave = chaveNome(atleta.nome);
    const candidatos = cadastro.get(chave) ?? [];
    candidatos.push(atleta);
    cadastro.set(chave, candidatos);
  }
  const geral = new Map();
  const sessenta = new Map();
  for (const resultado of pontuados) {
    if (resultado.modalidade === 'Kata em equipe' || (resultado.st && resultado.st !== 'A')) continue;
    const origem = resultado.eq === 'AFCDF' ? resultado.or_ : resultado.eq;
    const candidatos = (cadastro.get(chaveNome(resultado.atl)) ?? []).filter(a => chaveAssociacao(a.associacao) === chaveAssociacao(origem));
    if (candidatos.length > 1) throw new Error('Há mais de um cadastro correspondente ao atleta ' + resultado.atl + '.');
    const [atleta] = candidatos;
    if (!atleta) continue;
    const evento = eventos[resultado.ev];
    if (!evento) throw new Error('Evento sem data cadastrada: ' + resultado.ev + '.');
    const nascimento = atleta.nascimento;
    const limite60 = String(Number(evento.data.slice(0, 4)) - 60) + evento.data.slice(4);
    for (const resumo of [geral, ...(nascimento && nascimento <= limite60 ? [sessenta] : [])]) {
      if (!resumo.has(atleta.registro)) resumo.set(atleta.registro, novoResumo(atleta));
      somar(resumo.get(atleta.registro), resultado);
    }
  }
  return {
    atletas: consolidar(geral),
    cadastro: Array.from(geral.keys(), registro => ({
      Registro: registro, Nome: geral.get(registro).Atleta,
    })),
    sessenta: consolidar(sessenta),
  };
}
