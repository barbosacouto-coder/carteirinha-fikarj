const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function iniciarProcessosRegistro2027(sb, obterAtletas) {
  const area = document.getElementById('financeiroProcessosRegistro2027');
  if (!area) return;
  area.innerHTML = `
    <details class="my-4 rounded-xl border border-gray-700 bg-gray-900 p-4 text-white">
      <summary>Financeiro · Processos Dan e Dangai 2027</summary>
      <form class="mt-3 grid gap-3" data-processo>
        <label>Matrícula <input name="registro" type="number" min="1" required class="inp"></label>
        <label>Tipo de processo
          <select name="tipo" class="inp">
            <option value="primeiro_registro_dangai">Primeiro registro Dangai</option>
            <option value="diploma_dangai">Diploma Dangai</option>
            <option value="registro_dan">Registro Dan</option>
            <option value="exame_dan">Exame Dan</option>
            <option value="reconhecimento_dan">Reconhecimento Dan</option>
          </select>
        </label>
        <label hidden>Grau Dan <input name="grau" type="number" min="1" max="7" class="inp"></label>
        <button type="submit" class="justify-self-start rounded bg-sky-700 p-2">Criar cobrança</button>
        <p role="status"></p>
      </form>
      <form class="mt-4 grid gap-3" data-recebimento>
        <label>Matrícula para consultar cobranças <input name="registro" type="number" min="1" required class="inp"></label>
        <button type="button" class="justify-self-start rounded bg-gray-700 p-2">Consultar saldo</button>
        <label>Cobrança <select name="cobranca" required class="inp"></select></label>
        <label>Valor recebido <input name="valor" type="number" min="0.01" step="0.01" required class="inp"></label>
        <label>Data do recebimento <input name="data" type="date" min="2026-12-01" required class="inp"></label>
        <label>Forma <select name="forma" class="inp"><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option></select></label>
        <button type="submit" class="justify-self-start rounded bg-sky-700 p-2" disabled>Registrar recebimento</button>
        <p role="status"></p>
      </form>
    </details>`;

  const abrir = area.querySelector('[data-processo]');
  const receber = area.querySelector('[data-recebimento]');
  const atleta = form => obterAtletas().find(item => item.registro === Number(form.elements.registro.value));
  function exibirGrau() {
    const { grau, tipo } = abrir.elements;
    const dan = tipo.value.endsWith('_dan');
    grau.closest('label').hidden = !dan;
    grau.disabled = !dan;
    grau.required = dan;
  }
  abrir.elements.tipo.addEventListener('change', exibirGrau);
  exibirGrau();

  abrir.addEventListener('submit', async event => {
    event.preventDefault();
    const status = abrir.querySelector('[role="status"]');
    const cadastro = atleta(abrir);
    if (!cadastro) { status.textContent = 'Confira a matrícula.'; return; }
    const { tipo, grau } = abrir.elements;
    const botao = abrir.querySelector('button');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      const { data, error } = await sb.rpc('pag_abrir_processo_registro_2027', {
        p_atleta: cadastro.id, p_tipo: tipo.value, p_grau_dan: grau.disabled ? null : Number(grau.value),
      });
      if (error) throw error;
      status.textContent = 'Cobrança ' + data + ' criada para ' + cadastro.nome + '.';
    } catch (erro) {
      status.textContent = erro.message || 'Não foi possível criar a cobrança.';
    } finally { botao.disabled = false; }
  });

  const status = receber.querySelector('[role="status"]');
  const consultar = receber.querySelector('button[type="button"]');
  const registrar = receber.querySelector('button[type="submit"]');
  const campos = receber.elements;
  campos.registro.addEventListener('input', () => {
    campos.cobranca.replaceChildren();
    registrar.disabled = true;
  });

  consultar.addEventListener('click', async () => {
    const cadastro = atleta(receber);
    campos.cobranca.replaceChildren();
    registrar.disabled = true;
    if (!cadastro) { status.textContent = 'Confira a matrícula.'; return; }
    consultar.disabled = true;
    try {
      const { data, error } = await sb.from('pag_v_cobrancas').select('id,descricao,saldo')
        .eq('atleta_id', cadastro.id).eq('ano', 2027).eq('cancelada', false).gt('saldo', 0)
        .in('tipo', [...abrir.elements.tipo.options].map(opcao => opcao.value));
      if (error) throw error;
      if (atleta(receber)?.id !== cadastro.id) return;
      campos.cobranca.replaceChildren(new Option('Selecione a cobrança', ''), ...data.map(linha =>
        new Option(linha.descricao + ' · ' + moeda.format(linha.saldo), String(linha.id))));
      registrar.disabled = data.length === 0;
      status.textContent = data.length ? 'Cobranças de ' + cadastro.nome + '.' : 'Nenhum processo com saldo aberto.';
    } catch (erro) {
      status.textContent = erro.message || 'Não foi possível consultar as cobranças.';
    } finally { consultar.disabled = false; }
  });

  receber.addEventListener('submit', async event => {
    event.preventDefault();
    if (registrar.disabled) return;
    registrar.disabled = true;
    try {
      const { error } = await sb.rpc('pag_registrar_pagamento', {
        p_cobranca: Number(campos.cobranca.value), p_valor: Number(campos.valor.value),
        p_data: campos.data.value, p_forma: campos.forma.value,
      });
      if (error) throw error;
      campos.cobranca.replaceChildren();
      campos.valor.value = '';
      status.textContent = 'Recebimento registrado. Faça a conciliação no Financeiro para confirmar o pagamento.';
    } catch (erro) {
      status.textContent = erro.message || 'Não foi possível registrar o recebimento.';
      registrar.disabled = !campos.cobranca.value;
    }
  });
}
