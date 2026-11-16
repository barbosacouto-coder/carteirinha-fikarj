import { createHandler } from './handler.mjs';

// Deployment must explicitly disable platform JWT verification; this handler
// authenticates its own narrowly scoped worker token before every queue call.
Deno.serve(createHandler({
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  CENTRAL_MIDIAS_BROKER_TOKEN: Deno.env.get('CENTRAL_MIDIAS_BROKER_TOKEN'),
}));
