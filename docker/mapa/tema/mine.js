/*
  O tema do mapa, e a ponte com a Mesa do Mestre.

  O mapa ocupa quase toda a tela do painel e, até aqui, respondia a uma
  pergunta só: "como é a superfície vista de cima". Este arquivo é o que
  transforma ele de figura em terreno de trabalho — clicar vira comando,
  o cursor diz onde está, dá para medir distância, marcar lugar e ver
  quem se moveu.

  A divisão de tarefas é sempre a mesma: o mapa REPORTA e DESENHA, o
  painel DECIDE. Menu, histórico e a lista de marcadores vivem lá, onde
  já existe a linguagem visual e a linha de comando. Aqui ficam só as
  coisas que dependem de estar dentro do OpenLayers.
*/

/* ═══════════════════════════════════════════════════════════════════
   O papel de parede de terra
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  var c = document.createElement("canvas");
  c.width = 16; c.height = 16;
  var ctx = c.getContext("2d");
  if (!ctx) return;

  var paleta = ["#2b2019", "#33261c", "#3b2c20", "#2f231a", "#372a1f", "#261c15"];

  // Ruído determinístico: mesmo padrão a cada carregamento.
  var seed = 1337;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

  for (var y = 0; y < 16; y++) {
    for (var x = 0; x < 16; x++) {
      ctx.fillStyle = paleta[Math.floor(rnd() * paleta.length)];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  document.documentElement.style.setProperty("--mc-dirt-url", "url(" + c.toDataURL() + ")");
  document.body.classList.add("mc-dirt");
})();

/* ═══════════════════════════════════════════════════════════════════
   FERRAMENTAS DO MAPA

   Tudo daqui para baixo precisa da instância do OpenLayers, que o
   aplicar.py publica em window.unmined. Se ela não estiver lá (versão
   nova do uNmINeD que mudou a linha), nada disto liga e o mapa continua
   sendo um mapa — nunca uma página quebrada.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  var EMBUTIDO = /[?&]embutido=1/.test(location.search) || window.self !== window.top;

  /* ── Esperar o mapa existir ──
     O uNmINeD monta o OpenLayers logo depois do load, e não avisa. */
  function quandoPronto(fazer) {
    var tentativas = 0;
    var relogio = setInterval(function () {
      var u = window.unmined;
      if (u && u.olMap && typeof u.center === "function") {
        clearInterval(relogio);
        fazer(u);
      } else if (++tentativas > 100) {
        clearInterval(relogio);   // 20 s sem mapa: desiste em silêncio
      }
    }, 200);
  }

  quandoPronto(function (u) {
    var mapa = u.olMap;
    var vista = mapa.getView();

    /* ── A página sozinha pode nascer medindo 0×0 ──
       O OpenLayers mede o tamanho do container uma vez, no instante em
       que o mapa nasce. Se nesse instante a aba estava em segundo plano,
       ou a fonte ainda não tinha trocado, ou o layout ainda não tinha
       assentado, a medida errada gruda: nada dispara uma remedida
       sozinho, e a grade fica vazia para sempre - é exatamente a "grade
       preta sem mundo" na abertura. Isto força uma remedida em cada
       janela de oportunidade plausível; todas são baratas e idempotentes,
       então não custa nada chamar de mais.
       Dentro do painel isto não muda nada: lá o iframe já nasce com
       tamanho certo, então updateSize() só confirma o que já estava bom.

       updateSize() sozinho só recalcula o tamanho e AGENDA um novo
       quadro - não pinta nada na hora. Debaixo de carga (a máquina
       ocupada com outro build, por exemplo) esse quadro agendado às
       vezes nunca chega a acontecer, e o mapa fica preso na medida
       errada mesmo depois de corrigida: por isso o renderSync() logo
       em seguida, forçando o repintar de verdade em vez de confiar
       que o agendamento do OpenLayers vai vencer a corrida. */
    function remedir() { mapa.updateSize(); mapa.renderSync(); }
    remedir();
    window.addEventListener("load", remedir);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) remedir();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(remedir).observe(mapa.getTargetElement());
    }
    setTimeout(remedir, 300);
    setTimeout(remedir, 1200);

    /* ── E se o tile chegar DEPOIS da última remedida? ──
       Os timers acima cobrem "o container tinha o tamanho errado";
       isto cobre um segundo jeito de nascer em branco, visto numa
       máquina ocupada (outro build rodando ao mesmo tempo): a medida
       corrige a tempo, mas os tiles ainda estão a caminho da rede e do
       decode do WebP quando o último remedir() roda - o quadro que ele
       força fica em branco, e nada pede um quadro novo depois que o
       tile realmente chega. Ouvir o fim de carga de cada tile e mandar
       repintar de novo fecha essa brecha, sem custar nada quando não
       faz falta - remedir() é barato e idempotente. */
    mapa.getLayers().forEach(function (camada) {
      var fonte = camada.getSource && camada.getSource();
      if (fonte && typeof fonte.on === "function" && typeof fonte.getTileLoadFunction === "function") {
        fonte.on("tileloadend", remedir);
      }
    });

    /* Converte bloco → coordenada do OpenLayers e vice-versa. */
    function doBloco(x, z) {
      return ol.proj.transform([x, z], u.dataProjection, u.viewProjection);
    }
    function paraBloco(coord) {
      var v = ol.proj.transform(coord, u.viewProjection, u.dataProjection);
      return { x: Math.round(v[0]), z: Math.round(v[1]) };
    }

    /* ───────────────────────────────────────────────────────────────
       CAMADAS DE DESENHO

       Uma função só monta todas: mobs, rastro, régua e marcadores
       compartilham a mesma mecânica, e a ordem em que empilham é o
       zIndex — o que se move por cima do que fica parado.
       ─────────────────────────────────────────────────────────────── */
    function novaCamada(zIndex) {
      var fonte = new ol.source.Vector({ features: [] });
      var camada = new ol.layer.Vector({ source: fonte, zIndex: zIndex });
      mapa.addLayer(camada);
      return { fonte: fonte, camada: camada };
    }

    var CAMADA_MOBS = novaCamada(8900);
    var CAMADA_RASTRO = novaCamada(8800);
    var CAMADA_REGUA = novaCamada(9200);
    var CAMADA_PINOS = novaCamada(9100);

    function estiloDeLinha(cor, largura, tracejado) {
      return new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: cor, width: largura,
          lineDash: tracejado || undefined, lineCap: "round", lineJoin: "round",
        }),
      });
    }

    function estiloDePino(cor, rotulo) {
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 5,
          fill: new ol.style.Fill({ color: cor }),
          stroke: new ol.style.Stroke({ color: "#0c0b0a", width: 2 }),
        }),
        text: rotulo ? new ol.style.Text({
          text: rotulo, offsetY: -16,
          font: "600 12px Barlow, sans-serif",
          fill: new ol.style.Fill({ color: "#f0ece6" }),
          stroke: new ol.style.Stroke({ color: "#0c0b0a", width: 3 }),
        }) : undefined,
      });
    }

    /* ───────────────────────────────────────────────────────────────
       BARRA DE ESCALA

       Sem ela não dá para saber se aquele lago tem cinquenta blocos ou
       quinhentos. O número escolhido é sempre redondo: 1, 2, 5, 10, 20,
       50… — uma barra de "137 blocos" não ajuda ninguém a estimar.
       ─────────────────────────────────────────────────────────────── */
    var escala = document.createElement("div");
    escala.className = "mc-escala";
    escala.innerHTML = '<span class="mc-escala-barra"></span><span class="mc-escala-texto"></span>';
    document.body.appendChild(escala);

    var LARGURA_ALVO = 120;   // px, mais ou menos
    function atualizarEscala() {
      // A resolução é "unidades de projeção por pixel"; o transform diz
      // quantos blocos cabem nela.
      var centro = vista.getCenter();
      var res = vista.getResolution();
      if (!centro || !res) return;

      var a = paraBloco(centro);
      var b = paraBloco([centro[0] + res * LARGURA_ALVO, centro[1]]);
      var blocosNaLargura = Math.abs(b.x - a.x);
      if (!blocosNaLargura) return;

      var passo = escolherRedondo(blocosNaLargura);
      var pixels = LARGURA_ALVO * (passo / blocosNaLargura);

      escala.querySelector(".mc-escala-barra").style.width = Math.round(pixels) + "px";
      escala.querySelector(".mc-escala-texto").textContent =
        passo >= 1000 ? (passo / 1000) + " mil blocos" : passo + " blocos";
    }

    function escolherRedondo(valor) {
      var potencia = Math.pow(10, Math.floor(Math.log10(valor)));
      for (var i = 0; i < 3; i++) {
        for (var _i = 0, _a = [1, 2, 5]; _i < 3; _i++) {
          var fator = _a[_i];
          if (potencia * fator >= valor) return potencia * fator;
        }
        potencia *= 10;
      }
      return Math.round(valor);
    }

    vista.on("change:resolution", atualizarEscala);
    vista.on("change:center", atualizarEscala);
    atualizarEscala();

    /* ───────────────────────────────────────────────────────────────
       SELETOR DE CAMADAS (só na página sozinha)

       Dentro do painel o seletor é o dele - por isso isto nem roda
       quando EMBUTIDO. Aqui fora, camadas.json é a mesma origem
       (localhost:8081 servindo o próprio arquivo): sem CORS, sem porta
       trocada, só um fetch. Cada botão troca de página; o centro atual
       viaja na âncora "#rx=X&rz=Z", que o unmined.js já sabe ler sozinho
       (RedDotMarker.centerOnRedDotMarker, chamado no construtor do
       mapa) - reaproveita o mecanismo dele em vez de inventar um novo.
       ─────────────────────────────────────────────────────────────── */
    function construirSeletorDeCamadas() {
      fetch("/camadas.json", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var camadas = (d && d.camadas) || [];
          if (camadas.length < 2) return; // uma camada só: nada para escolher

          // Em qual camada esta página está, a partir do próprio caminho.
          var aqui = location.pathname.replace(/^\//, "").replace(/index\.html$/, "");
          if (aqui && aqui.slice(-1) !== "/") aqui += "/";
          var atual = camadas.filter(function (c) { return c.caminho === aqui; })[0] || camadas[0];

          var caixa = document.createElement("div");
          caixa.className = "mc-seletor";
          for (var i = 0; i < camadas.length; i++) {
            (function (c) {
              var botao = document.createElement("button");
              botao.type = "button";
              botao.textContent = c.rotulo;
              botao.className = "mc-seletor-item" + (c.id === atual.id ? " ativo" : "");
              if (c.id === atual.id) botao.disabled = true;
              botao.addEventListener("click", function () {
                var centro = paraBloco(vista.getCenter());
                location.href = "/" + c.caminho + "#rx=" + centro.x + "&rz=" + centro.z;
              });
              caixa.appendChild(botao);
            })(camadas[i]);
          }
          document.body.appendChild(caixa);
        })
        .catch(function () { /* sem seletor, o mapa continua servindo */ });
    }
    if (!EMBUTIDO) construirSeletorDeCamadas();

    /* ───────────────────────────────────────────────────────────────
       A PONTE COM O PAINEL
       ─────────────────────────────────────────────────────────────── */
    function avisar(mensagem) {
      if (!EMBUTIDO) return;
      try { parent.postMessage(mensagem, "*"); } catch (e) { /* sem pai que escute */ }
    }

    if (EMBUTIDO) document.documentElement.classList.add("mc-embutido");

    var tela = mapa.getViewport();

    /* Onde o cursor está, contado a cada quadro no máximo. Mandar a cada
       mousemove entupia a fila de mensagens sem melhorar nada. */
    var pendente = null;
    tela.addEventListener("pointermove", function (ev) {
      var coord = mapa.getEventCoordinate(ev);
      if (!coord) return;
      pendente = paraBloco(coord);
      if (pendente) {
        pendente.cx = ev.clientX;
        pendente.cy = ev.clientY;
      }
    });
    tela.addEventListener("pointerleave", function () {
      pendente = null;
      avisar({ tipo: "mapa:saiu" });
    });
    (function contarQuadro() {
      if (pendente) { avisar({ tipo: "mapa:mover", x: pendente.x, z: pendente.z, cx: pendente.cx, cy: pendente.cy }); }
      requestAnimationFrame(contarQuadro);
    })();

    /* Arrastar o mapa também termina num clique: sem esta distância
       mínima, mover o mapa abriria o menu sem querer. */
    var partiuDe = null;
    tela.addEventListener("pointerdown", function (ev) {
      partiuDe = { x: ev.clientX, y: ev.clientY };
    });

    var modo = "normal";      // "normal" ou "regua"
    var pontaDaRegua = null;

    tela.addEventListener("click", function (ev) {
      if (partiuDe) {
        var andou = Math.abs(ev.clientX - partiuDe.x) + Math.abs(ev.clientY - partiuDe.y);
        partiuDe = null;
        if (andou > 6) return;
      }
      var coord = mapa.getEventCoordinate(ev);
      if (!coord) return;
      var onde = paraBloco(coord);

      if (modo === "regua") { medir(onde); return; }
      avisar({ tipo: "mapa:clique", x: onde.x, z: onde.z, cx: ev.clientX, cy: ev.clientY });
    });

    /* ── A régua ──
       Dois cliques: o primeiro fixa a ponta, o segundo fecha a medida e
       manda a distância para o painel contar. */
    function medir(onde) {
      if (!pontaDaRegua) {
        pontaDaRegua = onde;
        CAMADA_REGUA.fonte.clear();
        var ponto = new ol.Feature({ geometry: new ol.geom.Point(doBloco(onde.x, onde.z)) });
        ponto.setStyle(estiloDePino("#d99a45", null));
        CAMADA_REGUA.fonte.addFeature(ponto);
        avisar({ tipo: "mapa:regua", fase: "inicio", x: onde.x, z: onde.z });
        return;
      }

      var dx = onde.x - pontaDaRegua.x, dz = onde.z - pontaDaRegua.z;
      var distancia = Math.round(Math.sqrt(dx * dx + dz * dz));

      var linha = new ol.Feature({
        geometry: new ol.geom.LineString([
          doBloco(pontaDaRegua.x, pontaDaRegua.z), doBloco(onde.x, onde.z),
        ]),
      });
      linha.setStyle([
        estiloDeLinha("#d99a45", 2, [6, 5]),
        new ol.style.Style({
          text: new ol.style.Text({
            text: distancia + " blocos",
            font: "700 13px Barlow, sans-serif",
            fill: new ol.style.Fill({ color: "#d99a45" }),
            stroke: new ol.style.Stroke({ color: "#0c0b0a", width: 4 }),
            placement: "line", textBaseline: "bottom", offsetY: -6,
          }),
        }),
      ]);
      CAMADA_REGUA.fonte.addFeature(linha);

      var fim = new ol.Feature({ geometry: new ol.geom.Point(doBloco(onde.x, onde.z)) });
      fim.setStyle(estiloDePino("#d99a45", null));
      CAMADA_REGUA.fonte.addFeature(fim);

      avisar({
        tipo: "mapa:regua", fase: "fim", distancia: distancia,
        de: pontaDaRegua, ate: onde,
        // Caminhando (4,3 blocos por segundo) e correndo (5,6).
        andando: Math.round(distancia / 4.3),
        correndo: Math.round(distancia / 5.6),
      });
      pontaDaRegua = null;
    }

    /* ── Ordens que chegam do painel ── */
    window.addEventListener("message", function (ev) {
      var m = ev.data;
      if (!m || typeof m !== "object") return;

      if (m.tipo === "mapa:ir" && isFinite(m.x) && isFinite(m.z)) {
        u.center([m.x, m.z]);
        if (m.zoom != null) vista.setZoom(m.zoom);
        return;
      }

      if (m.tipo === "mapa:modo") {
        modo = m.modo === "regua" ? "regua" : "normal";
        pontaDaRegua = null;
        if (modo !== "regua") CAMADA_REGUA.fonte.clear();
        document.documentElement.classList.toggle("mc-medindo", modo === "regua");
        return;
      }

      if (m.tipo === "mapa:limparRegua") {
        CAMADA_REGUA.fonte.clear();
        pontaDaRegua = null;
        return;
      }

      /* Os marcadores são do painel: ele guarda, ele manda a lista
         inteira, o mapa só desenha o que chegou. */
      if (m.tipo === "mapa:marcadores" && Array.isArray(m.pinos)) {
        CAMADA_PINOS.fonte.clear();
        for (var i = 0; i < m.pinos.length; i++) {
          var p = m.pinos[i];
          if (!isFinite(p.x) || !isFinite(p.z)) continue;
          var f = new ol.Feature({ geometry: new ol.geom.Point(doBloco(p.x, p.z)) });
          f.setStyle(estiloDePino(p.cor || "#d99a45", p.nome || ""));
          CAMADA_PINOS.fonte.addFeature(f);
        }
        return;
      }

      /* O rastro é o caminho que cada jogador fez nos últimos minutos —
         serve para ver de onde a pessoa veio, não só onde ela parou. */
      if (m.tipo === "mapa:rastros" && m.rastros) {
        CAMADA_RASTRO.fonte.clear();
        for (var nome in m.rastros) {
          var pontos = m.rastros[nome];
          if (!pontos || pontos.length < 2) continue;
          var linha = new ol.Feature({
            geometry: new ol.geom.LineString(pontos.map(function (p) { return doBloco(p.x, p.z); })),
          });
          linha.setStyle(estiloDeLinha("rgba(159,138,208,.55)", 2));
          CAMADA_RASTRO.fonte.addFeature(linha);
        }
      }
    });

    /* ───────────────────────────────────────────────────────────────
       MOBS AO VIVO

       A varredura acontece no script do mundo, perto de quem está
       jogando. Aqui só desenha: vermelho para hostil, cinza para o
       resto, e um anel a mais nos hostis para achar no meio do verde.
       ─────────────────────────────────────────────────────────────── */
    var ESTILO_HOSTIL = new ol.style.Style({
      image: new ol.style.Circle({
        radius: 3.5,
        fill: new ol.style.Fill({ color: "rgba(224,82,82,.95)" }),
        stroke: new ol.style.Stroke({ color: "rgba(224,82,82,.3)", width: 4 }),
      }),
    });
    var ESTILO_NEUTRO = new ol.style.Style({
      image: new ol.style.Circle({
        radius: 3,
        fill: new ol.style.Fill({ color: "rgba(163,156,146,.75)" }),
      }),
    });

    function desenharMobs(mobs) {
      CAMADA_MOBS.fonte.clear();
      for (var i = 0; i < mobs.length; i++) {
        var m = mobs[i];
        if (!isFinite(m.x) || !isFinite(m.z)) continue;
        var f = new ol.Feature({ geometry: new ol.geom.Point(doBloco(m.x, m.z)) });
        f.setStyle(m.hostil ? ESTILO_HOSTIL : ESTILO_NEUTRO);
        CAMADA_MOBS.fonte.addFeature(f);
      }
    }

    var ultimosMobs = "";
    function buscarMobs() {
      fetch("/api/mobs", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var mobs = (d && d.mobs) || [];
          var assinatura = JSON.stringify(mobs);
          if (assinatura === ultimosMobs) return;
          ultimosMobs = assinatura;
          desenharMobs(mobs);
        })
        .catch(function () { /* painel fora do ar: o mapa segue */ });
    }
    buscarMobs();
    setInterval(buscarMobs, 2000);

    /* Avisa o painel de que a ponte está de pé — sem isso ele não sabe
       se manda ordens ou se o mapa é a versão velha. */
    avisar({ tipo: "mapa:pronto" });
  });
})();

/* ═══════════════════════════════════════════════════════════════════
   JOGADORES AO VIVO

   O uNmINeD desenha jogadores uma vez só, no carregamento, a partir da
   variável UnminedPlayers — que ele grava quando renderiza o mundo, de
   madrugada. Ou seja: sem isto, o mapa mostrava onde as pessoas estavam
   na última renderização, não onde estão agora.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  var DE_QUANTO_EM_QUANTO = 2000;
  var PASSOS_DE_RASTRO = 40;      // ~80 s de caminho guardado
  var ultimo = "";
  var rastros = {};

  function desenhar(posicoes) {
    var u = window.unmined;
    if (!u || !u.olMap || typeof u.createMarkersLayer !== "function") return false;

    var jogadores = Object.keys(posicoes).map(function (nome) {
      return { name: nome, x: posicoes[nome].x, z: posicoes[nome].z };
    });

    if (u.playerMarkersLayer) {
      u.olMap.removeLayer(u.playerMarkersLayer);
      u.playerMarkersLayer = null;
    }
    if (jogadores.length === 0) return true;

    var marcadores = Unmined.createPlayerMarkers(jogadores);
    u.playerMarkersLayer = u.createMarkersLayer(marcadores);
    u.playerMarkersLayer.setZIndex(9300);
    u.olMap.addLayer(u.playerMarkersLayer);
    return true;
  }

  /* O rastro é montado aqui, do lado de quem já recebe posição a cada
     dois segundos — o painel não precisa guardar histórico para isso. */
  function guardarRastro(posicoes) {
    for (var nome in posicoes) {
      var p = posicoes[nome];
      var fila = rastros[nome] || (rastros[nome] = []);
      var fim = fila[fila.length - 1];
      // Parado não vira ponto novo: senão o rastro vira um borrão.
      if (fim && fim.x === p.x && fim.z === p.z) continue;
      fila.push({ x: p.x, z: p.z });
      if (fila.length > PASSOS_DE_RASTRO) fila.shift();
    }
    // Quem saiu do mundo perde o rastro na volta seguinte.
    for (var velho in rastros) if (!(velho in posicoes)) delete rastros[velho];

    window.postMessage({ tipo: "mapa:rastros", rastros: rastros }, "*");
  }

  function buscar() {
    fetch("/api/pos", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (dados) {
        var posicoes = (dados && dados.posicoes) || {};
        guardarRastro(posicoes);
        var assinatura = JSON.stringify(posicoes);
        if (assinatura === ultimo) return;
        if (desenhar(posicoes)) ultimo = assinatura;
      })
      .catch(function () { /* painel fora do ar: o mapa continua servindo */ });
  }

  window.addEventListener("load", function () {
    setTimeout(buscar, 800);
    setInterval(buscar, DE_QUANTO_EM_QUANTO);
  });
})();
