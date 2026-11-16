// LOCAL integration only: real PostgREST/SQL, synthetic token, no Meta calls.
import { createHandler } from '../../supabase/functions/central-midias-worker/handler.mjs';
const fixtureBase = 'https://fixture.supabase.co';
const localPostgrest = 'http://fikarj-broker-postgrest-test:3000';
const localFetch = (url: string, init: RequestInit) => {
  if (!url.startsWith(fixtureBase + '/rest/v1/rpc/central_midias_worker_')) {
    throw new Error('Nonlocal request forbidden');
  }
  return fetch(localPostgrest + url.slice(fixtureBase.length).replace('/rest/v1', ''), init);
};
Deno.serve({ port: 9000 }, createHandler({
  SUPABASE_URL: fixtureBase,
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('LOCAL_TEST_JWT'),
  CENTRAL_MIDIAS_BROKER_TOKEN: 'local-test-only-broker-token-not-a-real-secret',
}, localFetch));
