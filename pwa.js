// Registro do service worker + aviso de nova versao. Falhas sao silenciosas.
(function () {
  if (!('serviceWorker' in navigator)) return;

  function avisar(worker) {
    if (document.getElementById('pwaUpdate')) return;
    var b = document.createElement('div');
    b.id = 'pwaUpdate';
    b.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;display:flex;gap:12px;align-items:center;padding:10px 16px;border-radius:12px;background:#111827;color:#f3f4f6;border:1px solid #009FE3;font:600 13px Montserrat,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    b.innerHTML = '<span>Nova versão disponível</span><button style="border:0;border-radius:8px;padding:6px 12px;background:#009FE3;color:#fff;font:700 12px inherit;cursor:pointer">Atualizar</button>';
    b.querySelector('button').onclick = function () { worker.postMessage({ type: 'SKIP_WAITING' }); };
    document.body.appendChild(b);
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) avisar(nw);
        });
      });
      // Procura versao nova ao voltar para o app (PWA instalado quase nunca recarrega sozinho)
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
    }).catch(function () {});

    // So recarrega em atualizacao (ja havia um SW no controle); na 1a instalacao nao.
    var recarregando = false;
    var haviaControle = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (recarregando || !haviaControle) return;
      recarregando = true;
      location.reload();
    });
  });
})();
