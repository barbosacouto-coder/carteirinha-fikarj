// Service worker do Portal FIKARJ.
// A cada publicacao relevante, mude VERSION: o navegador detecta o sw.js diferente,
// baixa tudo de novo e avisa o usuario para atualizar.
const VERSION = 'v4';
const CACHE = 'fikarj-' + VERSION;

const PRECACHE = [
  './',
  './index.html',
  './admin.html',
  './validar.html',
  './offline.html',
  './cartao.css',
  './cartao.js',
  './config.js',
  './pwa.js',
  './manifest.json',
  './manifest-admin.json',
  './icons/admin-icon-192.png',
  './icons/admin-icon-512.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' garante arquivos novos, e nao copias do cache HTTP do navegador
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    )
  );
  // Sem skipWaiting aqui: a nova versao espera o usuario aceitar (ver pwa.js),
  // para nao recarregar no meio de um upload de planilha.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fikarj-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Bibliotecas com versao fixa na URL e fontes: nunca mudam, cache-first e seguro.
function ehImutavel(url) {
  return url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    (url.hostname === 'cdn.jsdelivr.net' && /@\d/.test(url.pathname));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase (dados de atletas, anuidades, ranking, login): nunca interceptar nem guardar em cache.
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return;

  // Paginas: rede primeiro (sempre a versao mais nova); sem internet usa a copia ou a tela offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.origin === location.origin) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./offline.html'))
        )
    );
    return;
  }

  // Arquivos estaticos versionados e fontes: cache-first.
  if (ehImutavel(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      }))
    );
    return;
  }

  // Demais estaticos (cartao.js/css, config.js, Tailwind CDN, imagens): usa o cache na hora
  // e atualiza em segundo plano, assim nada fica preso numa versao antiga.
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const rede = fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || rede;
      })
    )
  );
});
