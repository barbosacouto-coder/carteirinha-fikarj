const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBrasilia = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const centavos = valor => Math.round(Number(valor) * 100);

export function iniciarPagamentos(sb, obterAtletas) {
  const form = document.getElementById('lancarPagamentoPortal');
  const status = document.getElementById('statusPagamentoPortal');
  const confirmar = document.getElementById('confirmarPagamentoPortal');
  const ano = document.getElementById('anoPagamentoPortal');
  const cobranca = document.getElementById('cobrancaPagamentoPortal');
  const campos = form.elements;
  let revisado;
  let revisao = 0;
  let ocupado = false;

  function invalidar() {
    revisao++;
    revisado = undefined;
    confirmar.disabled = true;
  }

  function mostrarTipo() {
    const evento = ['evento', 'curso'].includes(campos.tipo.value);
    ano.hidden = evento;
    campos.ano.disabled = evento;
    cobranca.hidden = !evento || !campos.cobranca.options.length;
  }

  function atletaAtual() {
    const atleta = obterAtletas().find(a => a.registro === Number(campos.registro.value));
    if (!atleta) throw new Error('Matrícula não encontrada no Cadastro Central.');
    return atleta;
  }

  campos.data.value = dataBrasilia();
  mostrarTipo();
  form.addEventListener('input', invalidar);
  form.addEventListener('change', event => {
    if ([campos.tipo, campos.registro].includes(event.target)) campos.cobranca.replaceChildren();
    mostrarTipo();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (ocupado) return;
    invalidar();
    const pedido = revisao;
    try {
      const atleta = atletaAtual();
      const tipo = campos.tipo.value;
      const data = campos.data.value;
      const valor = Number(campos.valor.value);
      const forma = campos.forma.value;
      const obs = campos.observacao.value.trim() || null;
      if (data > dataBrasilia()) throw new Error('A data do pagamento está no futuro.');
      if (!Number.isFinite(valor) || centavos(valor) <= 0) throw new Error('Informe o valor recebido.');
      if (['evento', 'curso'].includes(tipo)) {
        const rotulo = tipo === 'curso' ? 'curso' : 'evento';
        const { data: linhas, error } = await sb.from('pag_v_cobrancas')
          .select('id,descricao,saldo,evento_id').eq('atleta_id', atleta.id).eq('tipo', 'evento')
          .eq('cancelada', false).gt('saldo', 0).order('id');
        if (pedido !== revisao) return;
        if (error) throw error;
        const { data: eventos, error: erroEventos } = await sb.from('pag_eventos').select('id,tipo');
        if (pedido !== revisao) return;
        if (erroEventos) throw erroEventos;
        const relacionados = new Set(eventos.filter(evento => (evento.tipo === 'curso') === (tipo === 'curso')).map(evento => evento.id));
        const opcoes = linhas.filter(linha => relacionados.has(linha.evento_id));
        const selecionada = campos.cobranca.value;
        campos.cobranca.replaceChildren(new Option('Selecione a cobrança', ''), ...opcoes.map(linha =>
          new Option((linha.descricao || 'Cobrança de ' + rotulo) + ' · saldo ' + moeda.format(linha.saldo), String(linha.id))));
        mostrarTipo();
        if (!opcoes.length) throw new Error('O filiado não tem cobrança de ' + rotulo + ' aberta.');
        const item = opcoes.find(linha => String(linha.id) === selecionada);
        if (!item) {
          status.textContent = 'Selecione a cobrança de ' + rotulo + ' e revise novamente.';
          return;
        }
        campos.cobranca.value = selecionada;
        if (centavos(valor) > centavos(item.saldo)) throw new Error('O valor recebido excede o saldo da cobrança.');
        revisado = { rpc: 'pag_registrar_pagamento', params: {
          p_cobranca: item.id, p_valor: valor, p_data: data, p_forma: forma, p_obs: obs,
        }, descricao: item.descricao || 'Pagamento de ' + rotulo };
      } else {
        const anoAnuidade = Number(campos.ano.value);
        const { data: cobrancas, error: erroCobrancas } = await sb.from('pag_v_cobrancas')
          .select('valor_pago').eq('atleta_id', atleta.id).eq('tipo', tipo)
          .eq('ano', anoAnuidade).eq('cancelada', false);
        if (pedido !== revisao) return;
        if (erroCobrancas) throw erroCobrancas;
        if (cobrancas.some(item => centavos(item.valor_pago) > 0)) {
          throw new Error('Esta anuidade já tem pagamento registrado.');
        }
        const { data: calculo, error } = await sb.rpc('pag_calcular_anuidade', {
          p_atleta: atleta.id, p_tipo: tipo, p_ano: anoAnuidade, p_data: data,
        });
        if (pedido !== revisao) return;
        if (error) throw error;
        const linha = Array.isArray(calculo) ? calculo[0] : calculo;
        if (linha?.valor_final == null) throw new Error('O sistema não encontrou o valor da anuidade.');
        if (centavos(valor) !== centavos(linha.valor_final)) {
          throw new Error('O valor devido é ' + moeda.format(linha.valor_final) + '. Confira o valor recebido.');
        }
        revisado = { rpc: 'pag_lancar_anuidade', params: {
          p_atleta: atleta.id, p_tipo: tipo, p_ano: anoAnuidade, p_data: data,
          p_valor_pago: valor, p_forma: forma, p_obs: obs,
        }, descricao: campos.tipo.selectedOptions[0].text + ' ' + anoAnuidade };
      }
      status.textContent = [atleta.nome, revisado.descricao, moeda.format(valor),
        data.split('-').reverse().join('/'), campos.forma.selectedOptions[0].text].join(' · ');
      confirmar.disabled = false;
    } catch (erro) {
      if (pedido === revisao) status.textContent = erro.message || 'Não foi possível revisar o lançamento.';
    }
  });

  confirmar.addEventListener('click', async () => {
    if (!revisado || ocupado) return;
    const { rpc, params } = revisado;
    invalidar();
    ocupado = true;
    for (const campo of campos) campo.disabled = true;
    status.textContent = 'Registrando pagamento…';
    try {
      const { error } = await sb.rpc(rpc, params);
      if (error) throw error;
      form.reset();
      campos.data.value = dataBrasilia();
      campos.cobranca.replaceChildren();
      status.textContent = 'Pagamento registrado.';
    } catch (erro) {
      status.textContent = erro.message || 'Não foi possível confirmar o registro. Confira o lançamento antes de repetir.';
    } finally {
      ocupado = false;
      for (const campo of campos) campo.disabled = false;
      confirmar.disabled = true;
      mostrarTipo();
    }
  });
}
