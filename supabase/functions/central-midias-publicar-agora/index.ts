const origin = 'https://portalfikarj.com.br';
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Vary': 'Origin',
};
function reply(status: number, body: object) {
  return Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const destinos = ['instagram_carousel', 'instagram_reel', 'facebook_reel'];
const targets: Record<string, { repository: string; secret: string }> = {
  'https://jhvbpssigakvhjfjqazc.supabase.co': {
    repository: 'fikarj-cartoes-diarios', secret: 'CENTRAL_MIDIAS_GITHUB_DISPATCH_TOKEN',
  },
  'https://zrfribgwjjcyikabwxpo.supabase.co': {
    repository: 'fikarj-editorial-homologacao', secret: 'CENTRAL_MIDIAS_STAGE_GITHUB_DISPATCH_TOKEN',
  },
};

Deno.serve(async (request) => {
  if (request.headers.get('origin') !== origin) return reply(403, { error: 'origem_indisponivel' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'metodo_indisponivel' });

  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^ ]+$/i.test(authorization)) return reply(401, { error: 'sessao_necessaria' });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const target = targets[supabaseUrl];
  const githubToken = target ? Deno.env.get(target.secret) : undefined;
  const apiKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!target || !githubToken || !apiKey) {
    return reply(503, { error: 'envio_manual_indisponivel' });
  }

  try {
    const text = await request.text();
    if (text.length > 2048) return reply(413, { error: 'pedido_invalido' });
    let input;
    try { input = JSON.parse(text); }
    catch { return reply(400, { error: 'pedido_invalido' }); }
    if (!input || typeof input.midia_id !== 'string' || !uuid.test(input.midia_id) ||
        !Number.isSafeInteger(input.versao) || input.versao < 1 || input.versao > 2147483647 ||
        !destinos.includes(input.destino)) {
      return reply(400, { error: 'pedido_invalido' });
    }

    // PostgREST validates the caller JWT. The RPC checks the caller's admin
    // status, item version, approval and selected destination in one transaction.
    const rpcHeaders = { apikey: apiKey, authorization, 'Content-Type': 'application/json' };
    const reservation = await fetch(supabaseUrl + '/rest/v1/rpc/central_midias_reservar_publicacao', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: rpcHeaders,
      body: JSON.stringify({ p_id: input.midia_id, p_versao: input.versao, p_destino: input.destino }),
    });
    if (!reservation.ok) {
      const error = await reservation.json().catch(() => ({}));
      if (reservation.status === 401 || reservation.status === 403 || error.code === '42501') {
        return reply(403, { error: 'acesso_restrito' });
      }
      if (error.code === '55000') return reply(409, { error: 'solicitacao_em_andamento' });
      if (error.code === '40001' || error.code === '22023') {
        return reply(409, { error: 'pauta_ou_destino_indisponivel' });
      }
      return reply(502, { error: 'fila_indisponivel' });
    }
    const { destino_id: destinationId, reserva_id: reservationId } = await reservation.json();
    if (typeof destinationId !== 'string' || !uuid.test(destinationId) ||
        typeof reservationId !== 'string' || !uuid.test(reservationId)) {
      return reply(502, { error: 'envio_nao_confirmado' });
    }

    const dispatchUrl = 'https://api.github.com/repos/barbosacouto-coder/' + target.repository +
      '/actions/workflows/central-midias.yml/dispatches';
    const dispatch = await fetch(dispatchUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: 'Bearer ' + githubToken,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { destination_id: destinationId } }),
    });
    if ([400, 401, 403, 404, 422].includes(dispatch.status)) {
      const reverted = await fetch(supabaseUrl + '/rest/v1/rpc/central_midias_reverter_reserva', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: rpcHeaders,
        body: JSON.stringify({ p_destino_id: destinationId, p_reserva_id: reservationId }),
      });
      if (reverted.ok && await reverted.json() === true) {
        return reply(502, { error: 'disparo_rejeitado_reserva_liberada', retryable: true });
      }
      return reply(502, { error: 'envio_nao_confirmado' });
    }
    if (!dispatch.ok) return reply(502, { error: 'envio_nao_confirmado' });
    return reply(202, { accepted: true });
  } catch {
    return reply(502, { error: 'envio_nao_confirmado' });
  }
});
