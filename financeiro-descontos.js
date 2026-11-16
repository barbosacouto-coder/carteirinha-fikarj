export function iniciarDescontos2027(sb, obterAtletas) {
  const form = document.getElementById('autorizarDesconto2027');
  const status = form.querySelector('[role="status"]');
  const { registro, final, justificativa } = form.elements;
  const botao = form.querySelector('button');

  form.closest('details').addEventListener('toggle', async event => {
    if (!event.currentTarget.open || final.options.length > 1) return;
    try {
      const { data, error } = await sb.from('pag_eventos').select('id,nome')
        .eq('tipo', 'campeonato').eq('conta_para_desconto', true)
        .eq('data', '2026-12-06').ilike('local', '%Volta Redonda%');
      if (error) throw error;
      final.replaceChildren(new Option('Selecione a etapa final', ''), ...data.map(item =>
        new Option(item.nome, String(item.id))));
      botao.disabled = !data.length;
      status.textContent = data.length ? '' : 'A final de Volta Redonda ainda não consta no cadastro financeiro.';
    } catch {
      status.textContent = 'Não foi possível consultar a final. Feche e reabra a seção para tentar novamente.';
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (botao.disabled) return;
    const atleta = obterAtletas().find(item => item.registro === Number(registro.value));
    if (!atleta || !justificativa.value.trim()) {
      status.textContent = 'Confira a matrícula e informe a justificativa.';
      return;
    }
    botao.disabled = true;
    try {
      const { error } = await sb.rpc('pag_autorizar_desconto_2027', {
        p_atleta: atleta.id, p_final: Number(final.value), p_justificativa: justificativa.value.trim(),
      });
      if (error) throw error;
      form.reset();
      status.textContent = 'Desconto autorizado para ' + atleta.nome + '.';
    } catch (erro) {
      status.textContent = erro.code === '23505' ? 'Esta matrícula já tem autorização.'
        : erro.message || 'Não foi possível registrar a autorização.';
    } finally {
      botao.disabled = false;
    }
  });
}
