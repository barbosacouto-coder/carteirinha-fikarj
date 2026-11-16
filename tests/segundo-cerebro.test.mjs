import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../segundo-cerebro.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261116170000_segundo_cerebro_protegido.sql', import.meta.url), 'utf8');
const hardening = readFileSync(new URL('../supabase/migrations/20261116171000_segundo_cerebro_security_invoker.sql', import.meta.url), 'utf8');
const catalogo = readFileSync(new URL('../supabase/migrations/20261116172000_segundo_cerebro_catalogo_local.sql', import.meta.url), 'utf8');
const categorias = readFileSync(new URL('../supabase/migrations/20261116174000_segundo_cerebro_categorias.sql', import.meta.url), 'utf8');

test('Portal oferece o atalho e a região protegida do Segundo Cérebro', () => {
  assert.match(html, /href="#presidencia-segundo-cerebro"/);
  assert.match(html, /id="presidencia-segundo-cerebro"/);
  assert.match(html, /import\('\.\/segundo-cerebro\.js\?v=1'\)/);
});

test('cliente usa apenas bucket privado, RPC e DOM seguro', () => {
  assert.match(js, /const BUCKET = 'segundo-cerebro'/);
  assert.match(js, /segundo_cerebro_buscar/);
  assert.match(js, /createSignedUrl\(documento\.storage_path, 120/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
  assert.doesNotMatch(js, /service_role/i);
});

test('migração nega por padrão e autoriza somente administradores autenticados', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.segundo_cerebro_documentos from anon, authenticated/i);
  assert.match(migration, /to authenticated[\s\S]+is_admin\(\)/i);
  assert.match(migration, /public = false/i);
  assert.match(migration, /revoke all on function public\.segundo_cerebro_buscar/i);
  assert.match(hardening, /security invoker/i);
  assert.match(hardening, /usuario_id = \(select auth\.uid\(\)\)/i);
  assert.match(catalogo, /arquivo_disponivel boolean generated always/i);
  assert.match(catalogo, /caminho_relativo !~ '\^\[A-Za-z\]:'/i);
  assert.match(categorias, /segundo_cerebro_categorias/i);
  assert.match(js, /carregarCategorias/);
});

