const formatar = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'}).format(new Date());

export function iniciarCnkb2027(sb, obterAtletas) {
  const secao = document.createElement('details');
  secao.className = 'my-4 rounded-xl border border-gray-700 bg-gray-900 p-4 text-white';
  secao.innerHTML = `
    <summary>Financeiro · Anuidade e repasses CNKB 2027</summary>
    <form class="grid gap-2 mt-3">
      <label>Matrícula <input class="inp" name="matricula" type="number" min="1" required></label>
      <label>Modalidade <select class="inp" name="modalidade"><option value="direto">Pagamento direto à CNKB</option><option value="intermediado">Intermediado pela FIKARJ</option></select></label>
      <p data-pix></p>
      <label>Pagador <input class="inp" name="pagador" required maxlength="150"></label>
      <label>Data efetiva <input class="inp" name="data" type="date" min="2026-12-01" required></label>
      <label>Valor <input class="inp" name="valor" type="number" required min="0.01" step="0.01"></label>
      <label>Forma <select class="inp" name="forma"><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option></select></label>
      <label>Referência do comprovante protegido <input class="inp" name="referencia" required maxlength="500"></label>
      <label data-credito><input type="checkbox" name="credito"> Conferi o crédito no caixa ou no extrato FIKARJ</label>
      <button type="submit" class="rounded bg-sky-700 p-2">Registrar pagamento CNKB</button>
    </form>
    <form class="grid gap-2 mt-5">
      <label>Operação <select class="inp" name="operacao" required></select></label>
      <button type="button" data-consultar class="rounded bg-gray-700 p-2">Atualizar operações CNKB</button>
      <label>Ação <select class="inp" name="acao"><option value="conferida">Conferir comprovante direto</option><option value="repassada">Registrar repasse</option><option value="confirmada">Registrar confirmação da CNKB</option><option value="cancelada">Cancelar pagamento direto</option></select></label>
      <label>Data efetiva <input class="inp" name="data" type="date" required></label>
      <label>Comprovante, protocolo ou justificativa <input class="inp" name="referencia" required maxlength="500"></label>
      <button type="submit" class="rounded bg-sky-700 p-2">Registrar movimentação</button>
    </form>
    <form class="grid gap-2 mt-5">
      <label>Número da cobrança Dan quitada <input class="inp" name="cobranca" type="number" min="1" required></label>
      <label>Referência da conferência <input class="inp" name="referencia" required maxlength="500"></label>
      <button type="submit" class="rounded bg-sky-700 p-2">Vincular parcela CNKB para repasse</button>
    </form>
    <p role="status" class="mt-2"></p>`;
  document.getElementById('presidencia-anuidades').before(secao);
  const [registro, movimento, processo] = secao.querySelectorAll('form');
  const status = secao.querySelector('[role=status]');
  const campos = registro.elements;
  for (const form of [registro, movimento]) {
    form.elements.data.value = hoje();
    form.elements.data.max = hoje();
  }

  function destinatario() {
    const intermediado = campos.modalidade.value === 'intermediado';
    secao.querySelector('[data-pix]').textContent = intermediado
      ? 'PIX FIKARJ: CNPJ 47.669.249/0001-58 · Banco C6'
      : 'PIX CNKB: telefone 61 98636-6166';
    secao.querySelector('[data-credito]').hidden = !intermediado;
    campos.credito.required = intermediado;
  }
  destinatario();
  campos.modalidade.addEventListener('change', destinatario);

  async function consultar() {
    const { data, error } = await sb.from('pag_v_cnkb_operacoes_2027')
      .select('id,atleta_id,modalidade,valor,situacao').order('id', { ascending: false });
    if (error) throw error;
    const atletas = new Map(obterAtletas().map(a => [String(a.id), a.nome]));
    const linhas = data.filter(item => !['cancelada','estornada'].includes(item.situacao));
    movimento.elements.operacao.replaceChildren(new Option('Selecione a operação', ''), ...linhas.map(item =>
      new Option([atletas.get(String(item.atleta_id)) || 'Filiado', item.modalidade.replaceAll('_',' '),
        formatar.format(item.valor), item.situacao.replaceAll('_',' ')].join(' · '), item.id)));
  }

  function executar(botao, acao) {
    return async event => {
      event.preventDefault();
      if (botao.disabled) return;
      botao.disabled = true;
      status.textContent = '';
      try { await acao(); }
      catch (erro) { status.textContent = erro.message || 'Não foi possível concluir a operação CNKB.'; }
      finally { botao.disabled = false; }
    };
  }

  const atualizar = secao.querySelector('[data-consultar]');
  atualizar.addEventListener('click', executar(atualizar, consultar));
  registro.addEventListener('submit', executar(registro.querySelector('button'), async () => {
    const atleta = obterAtletas().find(a => a.registro === Number(campos.matricula.value));
    if (!atleta) throw new Error('Matrícula não encontrada no Cadastro Central.');
    const { error } = await sb.rpc('pag_cnkb_registrar_2027', {
      p_atleta: atleta.id, p_modalidade: campos.modalidade.value, p_data: campos.data.value,
      p_valor: Number(campos.valor.value), p_forma: campos.forma.value, p_pagador: campos.pagador.value,
      p_comprovante_ref: campos.referencia.value, p_credito_conferido: campos.credito.checked,
    });
    if (error) throw error;
    registro.reset();
    campos.data.value = hoje();
    destinatario();
    status.textContent = 'Pagamento CNKB registrado. Atualize as operações para movimentá-lo.';
  }));
  processo.addEventListener('submit', executar(processo.querySelector('button'), async () => {
    const { cobranca, referencia } = processo.elements;
    const { error } = await sb.rpc('pag_cnkb_vincular_dan_2027', {
      p_cobranca: Number(cobranca.value), p_referencia: referencia.value,
    });
    if (error) throw error;
    processo.reset();
    status.textContent = 'Parcela Dan vinculada. Atualize as operações para registrar o repasse.';
  }));
  movimento.addEventListener('submit', executar(movimento.querySelector('[type=submit]'), async () => {
    const { operacao, acao, data, referencia } = movimento.elements;
    const { error } = await sb.rpc('pag_cnkb_movimentar_2027', {
      p_operacao: Number(operacao.value), p_acao: acao.value, p_data: data.value,
      p_referencia: referencia.value,
    });
    if (error) throw error;
    referencia.value = '';
    status.textContent = 'Movimentação CNKB registrada. Atualize a lista para conferir a situação.';
  }));
}
