// Narrow server-side bridge: only two fixed queue RPCs, never arbitrary SQL/RPC.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
async function equalSecret(actual, expected) {
  const encode = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(actual)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(expected)));
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
export function createHandler(env, fetcher = fetch) {
  return async request => {
    if (request.method !== 'POST') return response(405, { error: 'method_not_allowed' });
    const secret = env.CENTRAL_MIDIAS_BROKER_TOKEN;
    if (!secret || secret.length < 32 || !env.SUPABASE_SERVICE_ROLE_KEY ||
        !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL || '')) {
      return response(503, { error: 'not_configured' });
    }
    const provided = request.headers.get('x-fikarj-worker-key') || '';
    if (provided.length > 512 || !await equalSecret(provided, secret)) {
      return response(401, { error: 'unauthorized' });
    }
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) {
      return response(415, { error: 'json_required' });
    }
    if (Number(request.headers.get('content-length') || 0) > 4096) {
      return response(413, { error: 'body_too_large' });
    }
    let input;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 4096) return response(413, { error: 'body_too_large' });
      input = JSON.parse(text);
    } catch { return response(400, { error: 'invalid_json' }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return response(400, { error: 'invalid_request' });
    let rpc, args;
    if (input.operation === 'claim' && Object.keys(input).length === 1) {
      rpc = 'central_midias_worker_claim';
      args = { p_limite: 1 };
    } else if (input.operation === 'finalize') {
      const allowed = new Set(['operation', 'destination_id', 'lease_token', 'result', 'external_id', 'error']);
      if (Object.keys(input).some(k => !allowed.has(k)) ||
          !uuid.test(input.destination_id || '') || !uuid.test(input.lease_token || '') ||
          !['publicado', 'falhou', 'resultado_incerto'].includes(input.result) ||
          (input.external_id != null && (typeof input.external_id !== 'string' || input.external_id.length > 300)) ||
          (input.error != null && (typeof input.error !== 'string' || input.error.length > 500)) ||
          (input.result === 'publicado' && !input.external_id?.trim())) {
        return response(400, { error: 'invalid_finalization' });
      }
      rpc = 'central_midias_worker_finalizar';
      args = { p_destino_id: input.destination_id, p_lease_token: input.lease_token,
        p_resultado: input.result, p_id_externo: input.external_id ?? null, p_erro: input.error ?? null };
    } else return response(400, { error: 'invalid_operation' });
    try {
      const upstream = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!upstream.ok) return response(502, { error: 'queue_operation_failed' });
      if (input.operation === 'finalize') return response(200, { ok: true });
      const jobs = await upstream.json();
      if (!Array.isArray(jobs) || jobs.length > 1) return response(502, { error: 'invalid_queue_response' });
      return response(200, jobs);
    } catch { return response(502, { error: 'queue_unavailable' }); }
  };
}
