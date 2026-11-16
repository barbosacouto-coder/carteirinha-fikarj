// Disposable HTTP integration fixture: no database, Meta, credentials or outbound calls.
import { createHandler } from '../../supabase/functions/central-midias-worker/handler.mjs';

const token = 'local-test-only-broker-token-not-a-real-secret';
let claimed = false;
let finished = false;
const job = {
  midia_id: '11111111-1111-4111-8111-111111111111',
  destino_id: '22222222-2222-4222-8222-222222222222',
  idempotency_key: '22222222-2222-4222-8222-222222222222',
  lease_token: '33333333-3333-4333-8333-333333333333',
  destino: 'instagram_carousel', tema: 'Local fixture', legenda: 'Local fixture',
  formato_publicacao: 'instagram_carousel',
  midias_urls: ['https://cdn.example.test/a.jpg', 'https://cdn.example.test/b.jpg'],
  midias_mime_types: ['image/jpeg', 'image/jpeg'], scheduled: '2020-01-01T00:00:00Z',
};
const mockDatabase = async (url: string, options: RequestInit) => {
  if (url.endsWith('/central_midias_worker_claim')) {
    if (claimed) return new Response('[]');
    claimed = true;
    return Response.json([job]);
  }
  if (url.endsWith('/central_midias_worker_finalizar')) {
    const input = JSON.parse(String(options.body));
    if (finished || input.p_destino_id !== job.destino_id || input.p_lease_token !== job.lease_token ||
        input.p_resultado !== 'publicado' || input.p_id_externo !== 'synthetic-external-id') {
      return new Response('invalid fixture finalization', { status: 409 });
    }
    finished = true;
    return new Response(null, { status: 204 });
  }
  throw new Error('Outbound calls forbidden by local fixture');
};
Deno.serve({ port: 9000 }, createHandler({
  SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-fake-server-key',
  CENTRAL_MIDIAS_BROKER_TOKEN: token,
}, mockDatabase));
