// Guarda o app no celular para abrir sem internet. Ao alterar arquivos, mude a VERSAO.
var VERSAO = 'ponto-v3';
var ARQUIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'vendor/jsQR.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // API passa direto
  // cache primeiro (abre na hora mesmo com sinal fraco) e atualiza em segundo plano
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (cache) {
    var rede = fetch(req).then(function (resp) {
      if (resp.ok) { var copia = resp.clone(); caches.open(VERSAO).then(function (c) { c.put(req, copia); }); }
      return resp;
    }).catch(function () { return cache || caches.match('index.html'); });
    return cache || rede;
  }));
});
