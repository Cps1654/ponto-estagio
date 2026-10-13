/* Ponto Estágio — app do aluno (PWA). Funciona offline: batidas ficam numa fila local
   e são enviadas ao Google Apps Script quando houver internet. */
(function () {
  'use strict';

  var API = window.PONTO_CONFIG.API_URL;
  var QR_PREFIXO = 'PONTOEST';
  var K = { sessao: 'ponto.sessao', fila: 'ponto.fila', hist: 'ponto.historico' };
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------ armazenamento local

  function ler(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, valor) { localStorage.setItem(chave, JSON.stringify(valor)); }

  var sessao = ler(K.sessao, null);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // ------------------------------------------------------------ API

  function chamar(corpo) {
    // text/plain evita o "preflight" CORS, que o Apps Script não suporta
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(corpo) })
      .then(function (r) { return r.json(); });
  }

  // ------------------------------------------------------------ telas

  function mostrar(tela) {
    ['tela-login', 'tela-principal'].forEach(function (t) { $(t).hidden = t !== tela; });
  }

  function iniciar() {
    atualizarRede();
    if (sessao && sessao.precisaLogin) pedirRelogin();
    else if (sessao) { mostrar('tela-principal'); renderizar(); sincronizar(); }
    else mostrar('tela-login');
    dicaInstalar();
  }

  // sessão expirou (ex.: PIN trocado): pede o PIN de novo para a MESMA matrícula, mantendo a fila
  function pedirRelogin() {
    $('matricula').value = sessao.matricula;
    $('matricula').readOnly = true;
    mostrar('tela-login');
  }

  function atualizarRede() {
    var on = navigator.onLine;
    $('rede').textContent = on ? 'online' : 'offline';
    $('rede').classList.toggle('offline', !on);
  }

  function fmtHora(ms) {
    return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderizar() {
    $('nome-aluno').textContent = sessao.nome;
    var hist = ler(K.hist, []);
    var fila = ler(K.fila, []);
    var ultima = hist[0];
    var sugerido = ultima && ultima.tipo === 'entrada' ? 'saida' : 'entrada';
    $('btn-entrada').classList.toggle('sugerido', sugerido === 'entrada');
    $('btn-saida').classList.toggle('sugerido', sugerido === 'saida');
    $('estado').textContent = ultima
      ? 'Última batida: ' + (ultima.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + ' em ' + fmtHora(ultima.deviceTime) + (ultima.localNome ? ' (' + ultima.localNome + ')' : '')
      : 'Nenhuma batida registrada neste celular ainda.';
    $('pendentes').textContent = fila.length
      ? fila.length + ' registro(s) aguardando internet para enviar.'
      : 'Todos os registros foram enviados.';

    var ul = $('historico');
    ul.innerHTML = '';
    hist.slice(0, 30).forEach(function (b) {
      var li = document.createElement('li');
      var tag = document.createElement('span');
      tag.className = 'tag ' + b.tipo;
      tag.textContent = b.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA';
      var meio = document.createElement('span');
      meio.textContent = fmtHora(b.deviceTime);
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = (b.localNome || '') + (b.distancia != null ? ' · ' + b.distancia + ' m' : '') + (b.lat == null ? ' · sem GPS' : '');
      meio.appendChild(sub);
      var st = document.createElement('span');
      st.className = 'sync' + (b.enviado ? '' : ' pendente');
      st.textContent = b.enviado ? '✓ enviado' : '⏳ pendente';
      li.appendChild(tag); li.appendChild(meio); li.appendChild(st);
      ul.appendChild(li);
    });
  }

  function resultado(ok, titulo, detalhe) {
    $('res-icone').textContent = ok ? '✅' : '⚠️';
    $('res-titulo').textContent = titulo;
    $('res-detalhe').textContent = detalhe || '';
    $('tela-resultado').hidden = false;
  }

  function dicaInstalar() {
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('instalar').textContent = ios
      ? 'Dica: no Safari, toque em Compartilhar → "Adicionar à Tela de Início" para usar como app.'
      : 'Dica: no menu do navegador, toque em "Instalar app" ou "Adicionar à tela inicial".';
  }

  // ------------------------------------------------------------ login

  $('form-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('erro-login').textContent = '';
    if (!navigator.onLine) { $('erro-login').textContent = 'Sem internet. O primeiro acesso precisa de conexão.'; return; }
    var btn = ev.submitter || $('form-login').querySelector('button');
    btn.disabled = true;
    chamar({ action: 'login', matricula: $('matricula').value.trim(), pin: $('pin').value.trim() })
      .then(function (r) {
        if (!r.ok) throw new Error(r.erro || 'Falha no login');
        sessao = { matricula: r.matricula, nome: r.nome, token: r.token, locais: r.locais, lastServerTime: r.serverTime };
        gravar(K.sessao, sessao);
        $('pin').value = '';
        $('matricula').readOnly = false;
        mostrar('tela-principal');
        renderizar();
        sincronizar();
      })
      .catch(function (e) { $('erro-login').textContent = e.message === 'Failed to fetch' ? 'Não foi possível conectar.' : e.message; })
      .then(function () { btn.disabled = false; });
  });

  $('btn-sair').addEventListener('click', function () {
    var fila = ler(K.fila, []);
    if (fila.length && !confirm('Há ' + fila.length + ' registro(s) ainda não enviados. Se sair agora, eles serão perdidos. Sair mesmo assim?')) return;
    if (!fila.length && !confirm('Sair desta conta?')) return;
    localStorage.removeItem(K.sessao); localStorage.removeItem(K.fila); localStorage.removeItem(K.hist);
    sessao = null;
    mostrar('tela-login');
  });

  // ------------------------------------------------------------ batida

  var tipoAtual = null, gpsPromessa = null;

  function obterGps() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve({ erro: 'sem suporte a GPS' });
      var melhor = null, fim = false;
      var terminar = function (x) { if (fim) return; fim = true; navigator.geolocation.clearWatch(w); resolve(x); };
      var w = navigator.geolocation.watchPosition(function (p) {
        if (!melhor || p.coords.accuracy < melhor.acc) {
          melhor = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), gpsTime: p.timestamp };
        }
        if (melhor.acc <= 30) terminar(melhor); // já está bom
      }, function (e) {
        terminar(melhor || { erro: e.code === 1 ? 'permissão de localização negada' : e.code === 3 ? 'tempo esgotado' : 'GPS indisponível' });
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 });
      setTimeout(function () { terminar(melhor || { erro: 'tempo esgotado' }); }, 25000);
    });
  }

  function baterPonto(tipo) {
    var hist = ler(K.hist, []);
    if (hist[0] && hist[0].tipo === tipo && Date.now() - hist[0].deviceTime < 2 * 60000) {
      resultado(false, 'Já registrado', 'Você registrou ' + (tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA') + ' há menos de 2 minutos.');
      return;
    }
    tipoAtual = tipo;
    gpsPromessa = obterGps(); // começa o GPS junto com a câmera para ganhar tempo
    abrirScanner();
  }

  $('btn-entrada').addEventListener('click', function () { baterPonto('entrada'); });
  $('btn-saida').addEventListener('click', function () { baterPonto('saida'); });

  function localDoQr(texto) {
    var p = String(texto || '').trim().split(':');
    if (p.length !== 3 || p[0] !== QR_PREFIXO) return null;
    var local = (sessao.locais || []).filter(function (l) { return l.id === p[1]; })[0];
    return local ? { local: local, texto: texto } : { local: null, texto: texto };
  }

  function distanciaM(lat1, lng1, lat2, lng2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function registrar(qrTexto) {
    var info = localDoQr(qrTexto);
    if (!info) { resultado(false, 'QR inválido', 'Este QR code não é de um local de estágio.'); return; }
    if (!info.local) { resultado(false, 'Local desconhecido', 'Este QR não está na sua lista de locais. Entre com internet e faça login de novo, ou fale com o professor.'); return; }
    var deviceTime = Date.now(); // hora do momento em que o QR foi lido
    $('res-icone').textContent = '📍';
    $('res-titulo').textContent = 'Obtendo localização…';
    $('res-detalhe').textContent = 'Fique parado alguns segundos.';
    $('btn-ok').hidden = true;
    $('tela-resultado').hidden = false;

    gpsPromessa.then(function (gps) {
      var b = {
        id: uuid(), tipo: tipoAtual, deviceTime: deviceTime, qr: info.texto,
        localNome: info.local.nome, lat: gps.lat, lng: gps.lng, acc: gps.acc, gpsTime: gps.gpsTime,
        gpsErro: gps.erro || '', lastServerTime: sessao.lastServerTime, offline: !navigator.onLine
      };
      if (gps.lat != null) b.distancia = Math.round(distanciaM(gps.lat, gps.lng, info.local.lat, info.local.lng));

      var fila = ler(K.fila, []); fila.push(b); gravar(K.fila, fila);
      var hist = ler(K.hist, []); hist.unshift(b); gravar(K.hist, hist.slice(0, 200));
      renderizar();
      $('btn-ok').hidden = false;

      var aviso = [];
      if (gps.erro) aviso.push('Localização não obtida (' + gps.erro + '). O registro foi salvo, mas o professor verá o alerta.');
      else if (b.distancia > info.local.raio + Math.min(gps.acc, 150)) aviso.push('Você parece estar a ' + b.distancia + ' m do local (limite ' + info.local.raio + ' m). O registro será marcado para revisão.');
      var texto = (tipoAtual === 'entrada' ? 'ENTRADA' : 'SAÍDA') + ' · ' + fmtHora(deviceTime) + '\n' + info.local.nome +
        (gps.acc ? ' · GPS ±' + gps.acc + ' m' : '') +
        (navigator.onLine ? '' : '\n\nVocê está offline: o registro será enviado quando houver internet.') +
        (aviso.length ? '\n\n' + aviso.join('\n') : '');
      resultado(!aviso.length, 'Ponto registrado', texto);
      sincronizar();
    });
  }

  // ------------------------------------------------------------ leitor de QR

  var stream = null, lendo = false;
  var video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });

  function abrirScanner() {
    $('scanner-titulo').textContent = 'Aponte para o QR do local (' + (tipoAtual === 'entrada' ? 'ENTRADA' : 'SAÍDA') + ')';
    $('scanner-status').textContent = 'Abrindo câmera…';
    $('tela-scanner').hidden = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('scanner-status').textContent = 'Câmera ao vivo indisponível. Use "Tirar foto do QR".';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(function (s) {
        stream = s; video.srcObject = s;
        return video.play();
      })
      .then(function () { $('scanner-status').textContent = 'Procurando QR…'; lendo = true; requestAnimationFrame(quadro); })
      .catch(function () { $('scanner-status').textContent = 'Não consegui abrir a câmera. Permita o acesso ou use "Tirar foto do QR".'; });
  }

  function fecharScanner() {
    lendo = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; video.srcObject = null;
    $('tela-scanner').hidden = true;
  }

  function decodificar(fonte, w, h) {
    var escala = Math.min(1, 800 / Math.max(w, h));
    canvas.width = Math.round(w * escala); canvas.height = Math.round(h * escala);
    ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return r && r.data;
  }

  function quadro() {
    if (!lendo) return;
    if (video.readyState >= 2 && video.videoWidth) {
      var txt = decodificar(video, video.videoWidth, video.videoHeight);
      if (txt) { if (navigator.vibrate) navigator.vibrate(80); fecharScanner(); registrar(txt); return; }
    }
    setTimeout(function () { requestAnimationFrame(quadro); }, 120);
  }

  $('foto-qr').addEventListener('change', function () {
    var arq = this.files && this.files[0];
    this.value = '';
    if (!arq) return;
    var img = new Image();
    img.onload = function () {
      var txt = decodificar(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(img.src);
      if (txt) { fecharScanner(); registrar(txt); }
      else $('scanner-status').textContent = 'Não encontrei QR na foto. Tente de mais perto e com boa luz.';
    };
    img.src = URL.createObjectURL(arq);
  });

  $('btn-cancelar').addEventListener('click', fecharScanner);
  $('btn-ok').addEventListener('click', function () { $('tela-resultado').hidden = true; });

  // ------------------------------------------------------------ sincronização

  var sincronizando = false;
  function sincronizar() {
    var fila = ler(K.fila, []);
    if (!sessao || !fila.length || sincronizando || !navigator.onLine) { if (sessao) renderizar(); return; }
    sincronizando = true;
    $('btn-sync').disabled = true;
    chamar({ action: 'sync', matricula: sessao.matricula, token: sessao.token, clientNow: Date.now(), registros: fila })
      .then(function (r) {
        if (!r.ok) {
          if (r.relogin) {
            sessao.precisaLogin = true; gravar(K.sessao, sessao);
            pedirRelogin();
            resultado(false, 'Entre novamente', r.erro + '\nSeus registros pendentes continuam guardados.');
          }
          return;
        }
        var ok = {}; (r.aceitos || []).forEach(function (id) { ok[id] = true; });
        gravar(K.fila, ler(K.fila, []).filter(function (b) { return !ok[b.id]; }));
        gravar(K.hist, ler(K.hist, []).map(function (b) { if (ok[b.id]) b.enviado = true; return b; }));
        sessao.lastServerTime = r.serverTime; gravar(K.sessao, sessao);
      })
      .catch(function () { /* sem conexão de verdade; tenta depois */ })
      .then(function () { sincronizando = false; $('btn-sync').disabled = false; renderizar(); });
  }

  $('btn-sync').addEventListener('click', function () {
    if (!navigator.onLine) { resultado(false, 'Sem internet', 'Os registros serão enviados quando o celular se conectar.'); return; }
    sincronizar();
  });

  // relogin sem perder a fila: se a sessão for inválida, a tela de login aparece e a fila é preservada
  window.addEventListener('online', function () { atualizarRede(); sincronizar(); });
  window.addEventListener('offline', atualizarRede);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sincronizar(); });
  setInterval(sincronizar, 60000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

  iniciar();
})();
