const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function iniciarCobrancas(sb, obterAtletas) {
  const form = document.getElementById('criarCobrancaPortal');
  const status = document.getElementById('statusCobrancaPortal');
  const campos = form.elements;
  const botao = form.querySelector('button[type=submit]');
  let eventos = [];
  let tarifas = [];
  let revisao = 0;

  function selecionarTarifa() {
    const evento = eventos.find(item => String(item.id) === campos.evento.value);
    const tarifa = tarifas.find(item => String(item.id) === campos.valor.value);
    campos.descricao.value = evento && tarifa ? evento.nome + ' · ' + tarifa.categoria : '';
    botao.disabled = !evento || !tarifa;
  }

  async function carregarTarifas() {
    const pedido = ++revisao;
    const evento = campos.evento.value;
    const selecionada = campos.valor.value;
    tarifas = [];
    campos.valor.replaceChildren(new Option('Selecione', ''));
    selecionarTarifa();
    if (!evento) return;
    const { data, error } = await sb.from('pag_evento_valores').select('id,categoria,valor').eq('evento_id', evento).order('categoria');
    if (pedido !== revisao) return;
    if (error) { status.textContent = 'Não foi possível consultar os valores aprovados.'; return; }
    tarifas = data;
    campos.valor.replaceChildren(new Option('Selecione', ''), ...tarifas.map(item =>
      new Option(item.categoria + ' · ' + reais.format(item.valor), String(item.id))));
    if (tarifas.some(item => String(item.id) === selecionada)) campos.valor.value = selecionada;
    selecionarTarifa();
    if (!tarifas.length) status.textContent = 'Cadastre primeiro um valor aprovado para este evento ou curso.';
    else status.textContent = '';
  }

  async function carregarEventos() {
    if (!form.closest('details').open) return;
    const { data, error } = await sb.from('pag_eventos').select('id,nome,tipo,data').order('data', { ascending: false });
    if (error) { status.textContent = 'Não foi possível consultar eventos e cursos.'; return; }
    const selecionado = campos.evento.value;
    eventos = data;
    campos.evento.replaceChildren(new Option('Selecione', ''), ...eventos.map(item =>
      new Option([item.nome,item.tipo,item.data].filter(Boolean).join(' · '), String(item.id))));
    if (eventos.some(item => String(item.id) === selecionado)) campos.evento.value = selecionado;
    await carregarTarifas();
  }

  form.closest('details').addEventListener('toggle', carregarEventos);
  document.addEventListener('financeiro:eventos-atualizados', carregarEventos);
  document.addEventListener('financeiro:tarifas-atualizadas', carregarTarifas);
  campos.evento.addEventListener('change', carregarTarifas);
  campos.valor.addEventListener('change', selecionarTarifa);
  selecionarTarifa();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (botao.disabled) return;
    const atleta = obterAtletas().find(item => item.registro === Number(campos.registro.value));
    const evento = eventos.find(item => String(item.id) === campos.evento.value);
    const tarifa = tarifas.find(item => String(item.id) === campos.valor.value);
    if (!atleta || !evento || !tarifa || !evento.data || !campos.vencimento.value) {
      status.textContent = 'Confira a matrícula, o evento, o valor aprovado e o vencimento.';
      return;
    }
    const descricao = evento.nome + ' · ' + tarifa.categoria;
    const valor = Number(tarifa.valor);
    if (!Number.isFinite(valor) || valor < 0) { status.textContent = 'O valor cadastrado é inválido.'; return; }
    const cobranca = {
      atleta_id: atleta.id, tipo: 'evento', ano: Number(evento.data.slice(0, 4)), evento_id: evento.id,
      descricao, valor_bruto: valor, valor_final: valor, vencimento: campos.vencimento.value,
    };
    for (const campo of campos) campo.disabled = true;
    try {
      const consulta = await sb.from('pag_cobrancas').select('id').eq('atleta_id', atleta.id)
        .eq('evento_id', evento.id).eq('descricao', descricao).eq('cancelada', false).limit(1);
      if (consulta.error) throw consulta.error;
      if (consulta.data.length) {
        status.textContent = 'Já existe uma cobrança ativa deste tipo para o filiado.';
        return;
      }
      const resposta = await sb.from('pag_cobrancas').insert(cobranca);
      if (resposta.error) throw resposta.error;
      status.textContent = 'Cobrança criada para ' + atleta.nome + ' · ' + reais.format(valor) + '.';
      campos.registro.value = '';
    } catch (erro) {
      status.textContent = erro.message || 'Não foi possível criar a cobrança.';
    } finally {
      for (const campo of campos) campo.disabled = false;
      selecionarTarifa();
    }
  });
}
