"use strict";

/* ═══════════════════════════════════════════════════════════════════
   ESTADO
   ═══════════════════════════════════════════════════════════════════ */

const S = {
  alvo: "@a",
  vezes: 1,
  jogadores: [],       // [{nome, x, y, z, dim, vivo}]
  posicoes: {},
  historico: JSON.parse(localStorage.getItem("aether.historico") || "[]"),
  sugestaoAtiva: 0,
  sugestoes: [],
  acontecimentos: [],   // o que este painel viu acontecer, o mais novo na frente
  mudo: localStorage.getItem("aether.mudo") === "1",
  fichaDe: null,
  status: null,
  filtroFita: "tudo",   // tudo · meu · mundo
  abaServidor: localStorage.getItem("aether.abaServidor") || "saude",
  filtroLog: "tudo",    // tudo · erro · entrada_saida · comando
  mapaStatus: null,     // última resposta de /api/mapa/status
};

/* ═══════════════════════════════════════════════════════════════════
   CATÁLOGOS
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   O GLOSSÁRIO

   Documentação viva, não decoração: cada termo que a mesa usa e o que
   ele quer dizer para quem está jogando no Xbox e olhando o painel de
   lado, sem vocabulário de administrador de servidor. Serve de fonte
   para os title/tooltip espalhados pela tela — quando um rótulo curto
   ("camada", "régua") não é óbvio sozinho, o title do elemento vem
   daqui, em vez de reinventar a frase em cada lugar que precisa dela.
   ═══════════════════════════════════════════════════════════════════ */
const GLOSSARIO = {
  bloco: "A unidade do mundo — pedra, terra, água: tudo é feito de blocos.",
  criatura: "Qualquer bicho que anda pelo mundo sozinho, hostil ou não.",
  poder: "Um efeito extra que a mesa dá a um item, além do que o jogo já tem.",
  encantamento: "Um poder de verdade do próprio jogo, aplicado a um item.",
  camada: "Uma versão do mapa — a de cima, a de baixo, a que mostra biomas.",
  base: "O canto do mundo onde alguém construiu e guarda as coisas.",
  mundo: "O save inteiro que o servidor está rodando agora.",
  "pedaço do mundo": "Um quadrado do terreno que o servidor carregou na memória.",
  jogador: "Quem está com o Xbox ligado e o boneco andando pelo mundo.",
  item: "Qualquer coisa que cabe no inventário — ferramenta, bloco, comida.",
  "mão": "Onde o item fica quando não está guardado — pronto para usar.",
  "inventário": "A mochila do jogador: os itens que ele carrega consigo.",
  "chão": "Onde um item cai quando ninguém o segura nem o guarda.",
  fita: "A lista do que aconteceu no mundo, mais novo primeiro.",
  "régua": "Ferramenta do mapa para medir a distância entre dois pontos.",
  marca: "Um alfinete que você deixa no mapa para achar o lugar depois.",
  clima: "Sol, chuva ou tempestade — o estado do céu agora.",
  hora: "Que parte do dia o relógio do mundo está marcando.",
  regra: "Uma configuração do mundo que vale para todo mundo (gamerule).",
  pacote: "Um addon — comportamento ou visual — ligado a este mundo.",
};

/* ═══════════════════════════════════════════════════════════════════
   A GRAMÁTICA

   A ideia é não inventar comandos novos: são os comandos de sempre com
   parâmetros a mais. Você escreve como pensa, e o painel traduz antes de
   mandar — o servidor continua recebendo coisa que ele entende.

     summon tnt at Fulano 1000
     summon zombie at Fulano 77 with full_diamond_armor egg
     give Fulano netherite_sword with sharpness 5 unbreaking 3
     boom at Fulano radius 50 fire
     tp Fulano to Sicrano

   Quem não usa nenhuma palavra a mais passa direto para o servidor, sem
   tradução nenhuma: `time set day` continua sendo `time set day`.
   ═══════════════════════════════════════════════════════════════════ */

/* Palavras que ligam os pedaços. São o sinal de que a linha é nossa. */
const LIGACOES = new Set(["at", "with", "named", "lore", "every", "to", "radius", "fire", "nobreak", "in", "on"]);

/* Conjuntos prontos de armadura, para não digitar quatro peças. */
const KITS = {
  full_leather_armor: "leather", full_chainmail_armor: "chainmail",
  full_iron_armor: "iron", full_golden_armor: "golden",
  full_diamond_armor: "diamond", full_netherite_armor: "netherite",
};

const COMANDOS = [
  { nome: "summon", args: "<criatura> at <quem> <quantas> with <...>", desc: "Invocar criatura equipada" },
  { nome: "give",   args: "<quem> <item> <qtd> with <encanto> <nível>", desc: "Dar item encantado" },
  { nome: "boom",   args: "at <quem> radius <N> [fire] [nobreak]",      desc: "Explosão sob medida" },
  { nome: "tp",     args: "<quem> to <quem|x z>",                       desc: "Teleportar sem sufocar" },
  { nome: "effect", args: "<quem> <efeito> <segundos> <nível>",         desc: "Aplicar efeito" },
  { nome: "gamemode",  args: "<modo> [quem]",           desc: "Trocar o modo de jogo" },
  { nome: "gamerule",  args: "<regra> <valor>",         desc: "Mudar uma regra do mundo" },
  { nome: "time",      args: "set <day|night|noon>",    desc: "Mudar a hora" },
  { nome: "weather",   args: "<clear|rain|thunder>",    desc: "Mudar o clima" },
  { nome: "xp",        args: "<qtd>[L] <quem>",         desc: "Dar experiência" },
  { nome: "kill",      args: "<quem>",                  desc: "Matar" },
  { nome: "clear",     args: "<quem> [item]",           desc: "Limpar o inventário" },
  { nome: "title",     args: "<quem> title <texto>",    desc: "Escrever grande na tela dele" },
  { nome: "playsound", args: "<som> <quem>",            desc: "Tocar um som" },
  { nome: "particle",  args: "<partícula> <x y z>",     desc: "Soltar partícula" },
  { nome: "setblock",  args: "<x y z> <bloco>",         desc: "Colocar um bloco" },
  { nome: "fill",      args: "<x1 y1 z1> <x2 y2 z2>",   desc: "Preencher uma área" },
  { nome: "difficulty",args: "<peaceful|easy|normal|hard>", desc: "Mudar a dificuldade" },
  { nome: "say",       args: "<texto>",                 desc: "Falar no chat de todo mundo" },
  { nome: "list",      args: "",                        desc: "Ver quem está online" },
];

/* Catálogo vindo do servidor: mobs e itens de verdade, addons inclusos. */
const CAT = { mobs: [], itens: [], encantamentos: {}, efeitos: [], pronto: false };

async function carregarCatalogo() {
  try {
    const c = await api("/api/catalogo");
    if (!c.ok) return;
    CAT.mobs = c.mobs || [];
    CAT.itens = c.itens || [];
    CAT.encantamentos = c.encantamentos || {};
    CAT.efeitos = c.efeitos || [];
    CAT.pronto = true;
    _bancoGive = _bancoSummon = null;   // recalculados na próxima busca
  } catch (e) { /* segue com o que der: o comando cru continua funcionando */ }
}

/* ── O tradutor ──
   Devolve {tipo, pedido} quando a linha é nossa, ou null quando ela deve
   seguir crua para o servidor. */
function traduzir(linha) {
  const bruto = linha.trim();
  if (!bruto) return null;

  const partes = bruto.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = partes[0].toLowerCase();
  const resto = partes.slice(1);
  const temLigacao = resto.some((p) => LIGACOES.has(p.toLowerCase()));

  if (cmd === "boom") return { tipo: "boom", pedido: lerBoom(resto) };
  if (!temLigacao) return null;              // comando comum: vai cru
  if (cmd === "summon") return { tipo: "summon", pedido: lerSummon(resto) };
  if (cmd === "give")   return { tipo: "give", pedido: lerGive(resto) };
  if (cmd === "tp")     return { tipo: "tp", pedido: lerTp(resto) };
  return null;
}

const semAspas = (s) => s.replace(/^"|"$/g, "");
const ehNumero = (s) => /^\d+$/.test(s);

/* summon <criatura> [at <quem>] [<quantas>] [with ...] [named "..."] [every <ms>] */
function lerSummon(p) {
  const r = {
    mob: "", qtd: 1, perto_de: S.alvo, armadura: "", mao: "", maoSecundaria: "",
    nome: "", vida: null, efeitos: [], intervalo_ms: 0,
  };
  let i = 0;
  r.mob = p[i++] || "";

  while (i < p.length) {
    const t = p[i].toLowerCase();
    if (t === "at" || t === "in") {
      // Duas formas de dizer onde: um nome, ou uma coordenada do mapa.
      // Com dois números a altura sai do terreno; com três, você manda.
      const a = p[i + 1], b = p[i + 2], c = p[i + 3];
      if (/^-?\d+$/.test(a || "") && /^-?\d+$/.test(b || "")) {
        if (/^-?\d+$/.test(c || "")) { r.x = +a; r.y = +b; r.z = +c; i += 4; }
        else { r.x = +a; r.z = +b; i += 3; }
        delete r.perto_de;
      } else { r.perto_de = semAspas(a || ""); i += 2; }
      continue;
    }
    if (t === "named") { r.nome = semAspas(p[++i] || ""); i++; continue; }
    if (t === "every") { r.intervalo_ms = parseInt(p[++i], 10) || 0; i++; continue; }
    if (t === "with") {
      i++;
      while (i < p.length && !LIGACOES.has(p[i].toLowerCase())) {
        const alvo = p[i].toLowerCase();
        const seguinte = p[i + 1];
        if (KITS[alvo]) { r.armadura = KITS[alvo]; i++; continue; }
        if (alvo === "health" || alvo === "vida") { r.vida = parseInt(seguinte, 10) || null; i += 2; continue; }
        if (CAT.efeitos.includes(alvo)) {
          r.efeitos.push({ id: alvo, nivel: ehNumero(seguinte) ? parseInt(seguinte, 10) : 1, segundos: 600 });
          i += ehNumero(seguinte) ? 2 : 1;
          continue;
        }
        // Qualquer outra coisa é um item: primeiro vai para a mão boa,
        // o segundo para a outra mão.
        if (!r.mao) r.mao = alvo; else if (!r.maoSecundaria) r.maoSecundaria = alvo;
        i++;
      }
      continue;
    }
    if (ehNumero(t)) { r.qtd = parseInt(t, 10); i++; continue; }
    i++;
  }
  return r;
}

/* give <quem> <item> [<qtd>] [with <encanto> <nível> ...] [named "..."]
   [lore "..."] [in hand|in inventory|on ground] — "in hand" é o padrão;
   é a lacuna que a bancada cobria e a linha não tinha como dizer. */
/* Poderes que um item pode carregar. Não passam pelo sistema de
   encantamento, então não têm teto nenhum — é por aqui que sai o
   knockback 4000 que o jogo jamais deixaria escrever num encantamento. */
const PODERES = {
  // No impacto — valem em qualquer arma: espada, arco, machado, graveto.
  damage:      "dano extra por acerto",
  knockback:   "força do arremesso",
  launch:      "arremessa para cima",
  pull:        "traz o alvo para perto",
  explode:     "explode e destrói no alvo",
  nobreak:     "a explosão não quebra bloco",
  fire:        "ateia fogo, em segundos",
  lightning:   "cai um raio no alvo",
  lifesteal:   "vida que volta para você",
  freeze:      "prende o alvo no lugar, em segundos",
  chain:       "o golpe salta para N inimigos perto",
  swap:        "você troca de lugar com o alvo",
  blink:       "você vai parar onde o golpe acertar",
  crater:      "cava uma cratera limpa de raio N",
  pillar:      "ergue uma coluna de N blocos sob o alvo",
  clone:       "o bicho atingido vira N cópias",
  grow:        "aumenta o tamanho do alvo",
  shrink:      "diminui o tamanho do alvo",

  // Só no arco, e valem para cada flecha.
  multishot:   "flechas por disparo, em grade — sem teto",
  arrowrain:   "flechas caindo do céu no impacto",

  // Aura: agem só de o item estar na sua mão, sem você fazer nada.
  aura_range:     "alcance das auras, em blocos (padrão 6)",
  aura_fire:      "queima quem chegar perto",
  aura_damage:    "fere quem chegar perto",
  aura_freeze:    "congela quem chegar perto",
  aura_push:      "empurra tudo para longe de você",
  aura_pull:      "puxa tudo para perto de você",
  aura_magnet:    "atrai os itens do chão",
  aura_speed:     "velocidade enquanto na mão",
  aura_strength:  "força enquanto na mão",
  aura_shield:    "resistência a dano",
  aura_heal:      "regeneração contínua",
  aura_jump:      "super pulo",
  aura_haste:     "pressa para minerar",
  aura_night:     "visão noturna",
  aura_fly:       "levitação",
  aura_water:     "respirar embaixo d'água",
  aura_fireproof: "imune a fogo",
  aura_invisible: "invisibilidade",
};

/* Os que não levam número: são liga/desliga. */
const PODERES_SEM_NUMERO = ["nobreak", "swap", "blink"];

function lerGive(p) {
  const r = { alvo: S.alvo, item: "", qtd: 1, nome: "", lore: "", onde: "mao", livre: true, encantes: {}, poderes: {} };
  let i = 0;
  if (p[i] && !CAT.itens.includes(p[i].toLowerCase())) r.alvo = semAspas(p[i++]);
  r.item = (p[i++] || "").toLowerCase();

  while (i < p.length) {
    const t = p[i].toLowerCase();
    if (t === "named") { r.nome = semAspas(p[++i] || ""); i++; continue; }
    if (t === "lore") { r.lore = semAspas(p[++i] || ""); i++; continue; }
    if (t === "with") {
      i++;
      while (i < p.length && !LIGACOES.has(p[i].toLowerCase())) {
        const encanto = p[i].toLowerCase();
        const seguinte = p[i + 1];
        // "multishot" e "knockback" existem dos dois lados: sao
        // encantamentos de verdade do jogo E poderes nossos. Quem decide e
        // o numero. Dentro do teto do encantamento, e encantamento; acima
        // dele, so pode ser poder - foi essa confusao que fez o jogo
        // recusar "multishot 12" dizendo que arco nao aceita Tiro Multiplo.
        const tetoDele = CAT.encantamentos[encanto];
        const valorPedido = ehNumero(seguinte) ? parseInt(seguinte, 10) : null;
        const ehEncantamento = tetoDele !== undefined &&
          (valorPedido === null || valorPedido <= tetoDele || !(encanto in PODERES));

        if (ehEncantamento) {
          r.encantes[encanto] = valorPedido !== null ? valorPedido : (tetoDele || 1);
          i += ehNumero(seguinte) ? 2 : 1;
        } else if (encanto in PODERES) {
          // "nobreak" é o avesso de um poder: desliga a quebra de blocos
          // da explosão, em vez de ligar alguma coisa.
          if (encanto === "nobreak") {
            r.poderes.breakblocks = false; i++;
          } else if (PODERES_SEM_NUMERO.includes(encanto)) {
            r.poderes[encanto] = true; i++;
          } else {
            r.poderes[encanto] = ehNumero(seguinte) ? parseInt(seguinte, 10) : 1;
            i += ehNumero(seguinte) ? 2 : 1;
          }
        } else if (CAT.efeitos.includes(encanto)) {
          (r.poderes.efeitos = r.poderes.efeitos || []).push({
            id: encanto, nivel: ehNumero(seguinte) ? parseInt(seguinte, 10) : 1, segundos: 10,
          });
          i += ehNumero(seguinte) ? 2 : 1;
        } else { i++; }
      }
      continue;
    }
    // Onde o item aparece: a lacuna que a bancada cobria com três botões
    // ("na mão dele", "no inventário", "cai aos pés dele") e a linha não
    // tinha como dizer. "in hand" é o padrão — dizer só importa para
    // trocar para inventário ou chão.
    if (t === "in" || t === "on") {
      const destino = (p[i + 1] || "").toLowerCase();
      if (destino === "hand") { r.onde = "mao"; i += 2; continue; }
      if (destino === "inventory") { r.onde = "inv"; i += 2; continue; }
      if (destino === "ground") { r.onde = "chao"; i += 2; continue; }
      i++; continue;
    }
    if (ehNumero(t)) { r.qtd = parseInt(t, 10); i++; continue; }
    i++;
  }
  return r;
}

/* boom [at <quem>|<x> <z>] [radius <N>] [fire] [nobreak] */
function lerBoom(p) {
  const r = { raio: 10, fogo: false, quebra: true, perto_de: S.alvo };
  let i = 0;
  while (i < p.length) {
    const t = p[i].toLowerCase();
    if (t === "at" || t === "in") {
      const a = p[i + 1], b = p[i + 2], c = p[i + 3];
      if (/^-?\d+$/.test(a || "") && /^-?\d+$/.test(b || "")) {
        if (/^-?\d+$/.test(c || "")) { r.x = +a; r.y = +b; r.z = +c; i += 4; }
        else { r.x = +a; r.z = +b; i += 3; }
        delete r.perto_de;
      } else { r.perto_de = semAspas(a || ""); i += 2; }
      continue;
    }
    if (t === "radius" || t === "raio") { r.raio = parseInt(p[++i], 10) || 10; i++; continue; }
    if (t === "fire" || t === "fogo") { r.fogo = true; i++; continue; }
    if (t === "nobreak") { r.quebra = false; i++; continue; }
    if (/^-?\d+$/.test(t)) { r.raio = parseInt(t, 10); i++; continue; }
    i++;
  }
  return r;
}

/* tp <quem> to <quem>
   tp <quem> to <x> <z>       - a altura é medida pelo addon
   tp <quem> to <x> <y> <z>   - altura escolhida por você */
function lerTp(p) {
  const r = { quem: p[0] ? semAspas(p[0]) : S.alvo };
  const numeros = [];

  for (let i = 1; i < p.length; i++) {
    const t = p[i].toLowerCase();
    if (t === "to" || t === "para") continue;
    if (/^-?\d+$/.test(t)) { numeros.push(parseInt(t, 10)); continue; }
    if (!r.para) r.para = semAspas(p[i]);
  }

  // Dois números são X e Z: o clique no mapa não tem como saber a altura,
  // e é justamente aí que o addon mede o terreno. Três números é você
  // dizendo exatamente onde quer parar.
  if (numeros.length >= 3) { r.x = numeros[0]; r.y = numeros[1]; r.z = numeros[2]; delete r.para; }
  else if (numeros.length === 2) { r.x = numeros[0]; r.z = numeros[1]; delete r.para; }

  return r;
}

const NOME_ENCANTO = {
  sharpness: "Afiação", smite: "Julgamento", bane_of_arthropods: "Perdição dos Artrópodes",
  fire_aspect: "Aspecto Flamejante", looting: "Pilhagem", knockback: "Repulsão",
  unbreaking: "Inquebrável", mending: "Remendo", efficiency: "Eficiência",
  fortune: "Fortuna", silk_touch: "Toque Suave", protection: "Proteção",
  fire_protection: "Proteção contra Fogo", blast_protection: "Proteção contra Explosão",
  projectile_protection: "Proteção contra Projéteis", thorns: "Espinhos",
  feather_falling: "Queda Suave", depth_strider: "Passos Profundos",
  frost_walker: "Passos Gelados", soul_speed: "Velocidade das Almas",
  respiration: "Respiração", aqua_affinity: "Afinidade Aquática",
  power: "Poder", punch: "Impacto", flame: "Chama", infinity: "Infinidade",
  luck_of_the_sea: "Sorte do Mar", lure: "Isca", impaling: "Perfuração",
  riptide: "Correnteza", loyalty: "Lealdade", channeling: "Canalização",
  quick_charge: "Carga Rápida", multishot: "Tiro Múltiplo", piercing: "Perfurante",
  swift_sneak: "Agachamento Ágil", binding_curse: "Maldição do Vínculo",
  vanishing_curse: "Maldição do Desaparecimento",
};

const EFEITOS = [
  ["strength", "Força"], ["speed", "Velocidade"], ["jump_boost", "Super Pulo"],
  ["regeneration", "Regeneração"], ["resistance", "Resistência"],
  ["fire_resistance", "Resistência ao Fogo"], ["water_breathing", "Respirar na Água"],
  ["invisibility", "Invisibilidade"], ["night_vision", "Visão Noturna"],
  ["haste", "Pressa"], ["absorption", "Absorção"], ["saturation", "Saciedade"],
  ["levitation", "Levitação"], ["slowness", "Lentidão"], ["weakness", "Fraqueza"],
  ["poison", "Veneno"], ["wither", "Definhamento"], ["blindness", "Cegueira"],
  ["nausea", "Náusea"], ["mining_fatigue", "Fadiga de Mineração"],
];

/* ── Céu, tempo e regras ──
   Os seis botões antigos ("Nascer o sol", "Cair a noite", "Limpar o céu"…)
   eram cegos: mandavam o comando e nunca sabiam o que estava valendo. Sol
   e noite, aliás, eram o mesmo controle partido em dois. Aqui cada coisa
   vira um controle com estado, lido do mundo pela rota /api/mundo. */

const CLIMAS = [
  { id: "clear", nome: "Sol",
    svg: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>' },
  { id: "rain", nome: "Chuva",
    svg: '<path d="M17 15.5a3.8 3.8 0 0 0 0-7.6 5.8 5.8 0 0 0-11.2 1.9A3.4 3.4 0 0 0 6 15.5z"/><path d="M8.5 18.5v2M12 18.5v3M15.5 18.5v2"/>' },
  { id: "thunder", nome: "Trovoada",
    svg: '<path d="M17 13a3.8 3.8 0 0 0 0-7.6A5.8 5.8 0 0 0 5.8 7.3 3.4 3.4 0 0 0 6 13z"/><path d="M13 12.5 9.8 17.5h3.4L10 22.5"/>' },
];

/* O Bedrock conta o dia em 0..23999. Estes são os marcos que o comando
   "time set" aceita por nome, com a fração do arco onde cada um cai. */
const HORAS = [
  { id: "sunrise", nome: "Alvor",  tique: 23000,
    svg: '<path d="M5.5 19h13"/><path d="M7 19a5 5 0 0 1 10 0"/><path d="M8.5 9 12 5.5 15.5 9"/>' },
  { id: "day",     nome: "Dia",    tique: 1000,
    svg: '<circle cx="12" cy="11" r="3.4"/><path d="M12 4v2M5.5 11h2M16.5 11h2M7.4 6.4l1.4 1.4M16.6 6.4l-1.4 1.4"/><path d="M4 19h16"/>' },
  { id: "noon",    nome: "Meio",   tique: 6000,
    svg: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/>' },
  { id: "sunset",  nome: "Poente", tique: 12000,
    svg: '<path d="M5.5 19h13"/><path d="M7 19a5 5 0 0 1 10 0"/><path d="M8.5 5.5 12 9 15.5 5.5"/>' },
  { id: "night",   nome: "Noite",  tique: 13000,
    svg: '<path d="M17 13.5A6.5 6.5 0 1 1 10.5 4a5.2 5.2 0 0 0 6.5 9.5z"/><path d="M18.5 6.3v2.2M17.4 7.4h2.2"/>' },
];

const REGRAS_MUNDO = [
  { id: "keepInventory",     rotulo: "Guardar item ao morrer" },
  { id: "mobGriefing",       rotulo: "Mob quebra bloco" },
  { id: "doFireTick",        rotulo: "Fogo se espalha" },
  { id: "showCoordinates",   rotulo: "Mostrar coordenada" },
  { id: "pvp",               rotulo: "Combate entre jogadores" },
  { id: "doDaylightCycle",   rotulo: "O tempo passa" },
  { id: "doWeatherCycle",    rotulo: "O clima muda sozinho" },
  { id: "doImmediateRespawn", rotulo: "Renascer na hora" },
];

/* O que o mundo respondeu da última vez. Enquanto ninguém respondeu, os
   controles ficam apagados em vez de fingir que sabem. */
const MUNDO = { hora: null, clima: "desconhecido", regras: {}, lido: false };

const ROMANOS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const romano = (n) => ROMANOS[n] || String(n);

/* ═══════════════════════════════════════════════════════════════════
   FERRAMENTAS
   ═══════════════════════════════════════════════════════════════════ */

/* ── O som ──
   Tudo sintetizado na hora com osciladores: nenhum arquivo para baixar,
   nada para ficar fora de tom com o resto. Curto e seco - som de mesa de
   controle, não de jogo. A chave de mudo é lembrada entre visitas. */
const SOM = (() => {
  const RECEITAS = {
    tecla:    { vozes: [{ de: 1250, para: 900, dura: .035, forca: .04, tipo: "square" }] },
    aceitar:  { vozes: [{ de: 660, para: 990, dura: .07, forca: .07, tipo: "triangle" }] },
    mandar:   { vozes: [{ de: 420, para: 640, dura: .09, forca: .08, tipo: "sawtooth" },
                        { de: 840, dura: .05, forca: .03, atraso: .05 }] },
    bom:      { vozes: [{ de: 587, dura: .1, forca: .07, tipo: "triangle" },
                        { de: 880, dura: .16, forca: .06, atraso: .07, tipo: "triangle" }] },
    ruim:     { vozes: [{ de: 330, para: 200, dura: .2, forca: .09, tipo: "sawtooth" }] },
    estrondo: { vozes: [{ de: 90, para: 40, dura: .36, forca: .13, tipo: "sine" }],
                ruido: { dura: .4, forca: .12, corte: 620, queda: 2.6 } },
    entrou:   { vozes: [{ de: 523, dura: .09, forca: .05, tipo: "sine" },
                        { de: 784, dura: .13, forca: .045, atraso: .08, tipo: "sine" }] },
  };

  let ac = null;

  function acordar() {
    if (S.mudo) return null;
    if (!ac) {
      const Fabrica = window.AudioContext || window.webkitAudioContext;
      if (!Fabrica) return null;
      ac = new Fabrica();
    }
    // O navegador começa suspenso até o primeiro gesto do usuário.
    if (ac.state === "suspended") ac.resume().catch(() => {});
    return ac;
  }

  function tocar(nome) {
    const receita = RECEITAS[nome];
    if (!receita) return;
    const ctx = acordar();
    if (!ctx || ctx.state !== "running") return;
    const agora = ctx.currentTime;

    for (const voz of receita.vozes) {
      const atraso = voz.atraso || 0;
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = voz.tipo || "sine";
      osc.frequency.setValueAtTime(voz.de, agora + atraso);
      if (voz.para) osc.frequency.exponentialRampToValueAtTime(voz.para, agora + atraso + voz.dura);
      vol.gain.setValueAtTime(.0001, agora + atraso);
      vol.gain.exponentialRampToValueAtTime(voz.forca, agora + atraso + .008);
      vol.gain.exponentialRampToValueAtTime(.0001, agora + atraso + voz.dura);
      osc.connect(vol).connect(ctx.destination);
      osc.start(agora + atraso);
      osc.stop(agora + atraso + voz.dura + .02);
    }

    if (receita.ruido) {
      const n = receita.ruido;
      const quadros = Math.floor(ctx.sampleRate * n.dura);
      const buf = ctx.createBuffer(1, quadros, ctx.sampleRate);
      const dados = buf.getChannelData(0);
      for (let i = 0; i < quadros; i++) {
        dados[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / quadros, n.queda || 2);
      }
      const fonte = ctx.createBufferSource(); fonte.buffer = buf;
      const filtro = ctx.createBiquadFilter(); filtro.type = "lowpass"; filtro.frequency.value = n.corte || 900;
      const vol = ctx.createGain(); vol.gain.value = n.forca;
      fonte.connect(filtro).connect(vol).connect(ctx.destination);
      fonte.start(agora);
    }
  }

  return {
    tocar: tocar,
    mudo: () => S.mudo,
    trocarMudo() {
      S.mudo = !S.mudo;
      localStorage.setItem("aether.mudo", S.mudo ? "1" : "0");
      desenharMudo();
      if (!S.mudo) tocar("aceitar");
      // Efêmero de propósito: ninguém precisa achar "som ligado" na fita
      // daqui a uma hora, então é brinde() e não contar().
      brinde(S.mudo ? "Som desligado" : "Som ligado", S.mudo ? "aviso" : "bom");
    },
  };
})();

const ONDA_LIGADA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 5 6 9H3v6h3l4 4V5z"/><path d="M14.5 8.5a5 5 0 0 1 0 7"/><path d="M17.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ONDA_MUDA  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 5 6 9H3v6h3l4 4V5z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>';

function desenharMudo() {
  const b = $("botao-mudo");
  if (!b) return;
  b.innerHTML = S.mudo ? ONDA_MUDA : ONDA_LIGADA;
  b.setAttribute("aria-pressed", String(!S.mudo));
  b.classList.toggle("ligado", !S.mudo);
  b.title = S.mudo ? "O som está desligado" : "O som está ligado";
}

const $  = (id) => document.getElementById(id);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(rota, corpo) {
  const opcoes = corpo
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }
    : {};
  const r = await fetch(rota, opcoes);
  if (!r.ok && r.status >= 500) throw new Error("O painel respondeu " + r.status);
  return r.json();
}

function brinde(texto, tom) {
  const d = document.createElement("div");
  d.className = "chanfro-p " + (tom || "bom");
  d.textContent = texto;
  $("brindes").appendChild(d);
  setTimeout(() => { d.style.opacity = "0"; d.style.transition = "opacity .4s"; }, 4200);
  setTimeout(() => d.remove(), 4800);
}

/* ── A fita ──
   Todo retorno do mundo entra por aqui, já traduzido. O texto cru que o
   script manda (aquele com "|" e o código de correlação) vai junto, mas
   escondido: clicar no item abre. */

/* Dois tons de voz: um ícone de AÇÃO (o que o painel fez — cheque, aviso,
   x, traço) e um único ícone de EVENTO (o que o mundo fez sozinho, com o
   nome do jogador já em destaque no título). A cor ainda vem do tom. */
const GLIFOS = {
  bom:   '<path d="M20 6L9 17l-5-5"/>',
  morno: '<path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  ruim:  '<path d="M18 6L6 18M6 6l12 12"/>',
  seco:  '<path d="M5 12h14"/>',
};
const GLIFO_EVENTO = '<circle cx="12" cy="12" r="3.3"/><circle cx="12" cy="12" r="8.5"/>';
const TINTAS = {
  bom: "var(--grama)", morno: "var(--tocha)",
  ruim: "var(--redstone)", seco: "var(--texto5)",
};

function relogioCurto(ts) {
  const d = ts ? new Date(ts * 1000) : new Date();
  return String(d.getHours()).padStart(2, "0") + ":" +
         String(d.getMinutes()).padStart(2, "0") + ":" +
         String(d.getSeconds()).padStart(2, "0");
}

/* Conta uma coisa que aconteceu. Só o título é obrigatório. */
function contar(nota) {
  const item = {
    ts: Date.now() / 1000,
    tom: nota.tom || "seco",
    titulo: nota.titulo || "",
    detalhe: nota.detalhe || "",
    cru: nota.cru || "",
    local: true,
  };
  S.acontecimentos.unshift(item);
  if (S.acontecimentos.length > 60) S.acontecimentos.length = 60;
  if (item.tom === "bom") SOM.tocar("bom");
  else if (item.tom === "ruim") SOM.tocar("ruim");
  desenharFita();
}

/* Compatibilidade: as chamadas antigas mandam só uma frase e um tom.
   Elas continuam funcionando, entrando na fita como título solto. */
const TOM_ANTIGO = { meu: "seco", quente: "bom", ruim: "ruim", "": "seco" };
function dizer(texto, tom) {
  contar({ titulo: texto, tom: TOM_ANTIGO[tom || ""] || "seco" });
}

/* ═══════════════════════════════════════════════════════════════════
   O PALCO — o mapa
   ═══════════════════════════════════════════════════════════════════ */

function raizDoMapa() {
  const porta = (S.status && S.status.mapa_porta) || "8081";
  return location.protocol + "//" + location.hostname + ":" + porta + "/";
}

/* ── As camadas ──
   Cada camada é uma renderização inteira do mesmo mundo, servida numa
   pasta própria. Trocar de camada recarrega o quadro — e é por isso que
   o centro vai junto na âncora: sem ele, cada troca jogava você de volta
   para o meio do mundo. */
const CAMADAS = { lista: [], atual: "superficie", centro: null };

function urlDoMapa(id) {
  const camada = CAMADAS.lista.find((c) => c.id === (id || CAMADAS.atual));
  const caminho = camada ? camada.caminho : "";
  let url = raizDoMapa() + caminho + "?embutido=1&t=" + Date.now();
  if (CAMADAS.centro) url += "#rx=" + CAMADAS.centro.x + "&rz=" + CAMADAS.centro.z;
  return url;
}

async function descobrirCamadas() {
  try {
    const r = await fetch(raizDoMapa() + "camadas.json", { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    CAMADAS.lista = (d.camadas || []).filter((c) => c && c.id);
  } catch (e) {
    // Render antigo, sem camadas.json: fica só a superfície, que é o que
    // sempre existiu na raiz.
    CAMADAS.lista = [];
  }
  desenharCamadas();
}

function desenharCamadas() {
  const caixa = $("camadas-mapa");
  // Com uma camada só não há o que escolher, e o seletor seria ruído.
  if (CAMADAS.lista.length < 2) { caixa.hidden = true; return; }

  caixa.hidden = false;
  caixa.innerHTML = CAMADAS.lista.map((c) =>
    `<button data-id="${esc(c.id)}" aria-pressed="${String(c.id === CAMADAS.atual)}">${esc(c.rotulo)}</button>`
  ).join("");

  for (const b of caixa.children) {
    b.onclick = () => trocarCamada(b.dataset.id);
  }
}

function trocarCamada(id) {
  if (id === CAMADAS.atual) return;
  const camada = CAMADAS.lista.find((c) => c.id === id);
  if (!camada) return;
  CAMADAS.atual = id;
  desenharCamadas();
  SOM.tocar("tecla");
  // O centro guardado é o último lugar onde o cursor passou: é a melhor
  // pista que temos de onde você estava olhando.
  $("mapa").src = urlDoMapa(id);
  contar({ tom: "seco", titulo: "Camada <b>" + esc(camada.rotulo) + "</b>",
           detalhe: "o mapa foi redesenhado" });
}

async function recarregarMapa() {
  const url = urlDoMapa();
  const raiz = raizDoMapa();
  $("mapa-ausente").style.display = "none";
  $("mapa").style.display = "block";
  $("mapa").src = url + "?embutido=1&t=" + Date.now();

  // O iframe não dispara erro quando a conexão é recusada — ele só fica
  // em branco. Uma sondagem conta a verdade: mesmo sem poder ler a
  // resposta de outra origem, a promessa falha se não houver ninguém lá.
  try {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), 4000);
    await fetch(raiz, { mode: "no-cors", cache: "no-store", signal: controle.signal });
    clearTimeout(prazo);
    descobrirCamadas();
  } catch (e) {
    $("mapa").style.display = "none";
    $("mapa-ausente").style.display = "flex";
  }
}

/* ═══════════════════════════════════════════════════════════════════
   O MAPA COMO TERRENO DE TRABALHO

   O mapa reporta, o painel decide. De lá chegam a posição do cursor e o
   clique; daqui saem as ordens de centralizar, medir e desenhar pino.

   Enquanto a outra ponta não existir — mapa velho, render antigo — nada
   aqui quebra: as mensagens simplesmente não chegam e o painel segue.
   ═══════════════════════════════════════════════════════════════════ */

const MAPA = {
  pronto: false,
  medindo: false,
  sob: null,                       // {x, z} debaixo do cursor
  pinos: [],                       // marcadores salvos por você
};
try { MAPA.pinos = JSON.parse(localStorage.getItem("aether.pinos") || "[]"); } catch (e) { MAPA.pinos = []; }

function falarComOMapa(mensagem) {
  const janela = $("mapa").contentWindow;
  if (janela) { try { janela.postMessage(mensagem, "*"); } catch (e) { /* iframe fechado */ } }
}

function gravarPinos() {
  localStorage.setItem("aether.pinos", JSON.stringify(MAPA.pinos.slice(0, 60)));
  falarComOMapa({ tipo: "mapa:marcadores", pinos: MAPA.pinos });
}

/* ── O que o mapa conta ── */
window.addEventListener("message", (ev) => {
  const m = ev.data;
  if (!m || typeof m !== "object") return;

  if (m.tipo === "mapa:pronto") {
    MAPA.pronto = true;
    falarComOMapa({ tipo: "mapa:marcadores", pinos: MAPA.pinos });
    return;
  }

  if (m.tipo === "mapa:mover") {
    MAPA.sob = { x: m.x, z: m.z };
    CAMADAS.centro = MAPA.sob;
    const hud = $("hud-mapa");
    // O iframe manda a posição na tela DELE, que começa na origem da
    // nossa: o mapa ocupa a janela inteira, então as duas coincidem.
    hud.style.left = Math.min(m.cx + 16, window.innerWidth - 220) + "px";
    hud.style.top = Math.min(m.cy + 16, window.innerHeight - 44) + "px";
    hud.innerHTML = "x <b>" + m.x + "</b>  z <b>" + m.z + "</b>" +
      (MAPA.medindo ? '  <span class="fraco">· clique para medir</span>' : "");
    hud.classList.add("visivel");
    return;
  }

  if (m.tipo === "mapa:saiu") {
    MAPA.sob = null;
    $("hud-mapa").classList.remove("visivel");
    return;
  }

  if (m.tipo === "mapa:regua") {
    if (m.fase === "inicio") {
      contar({ tom: "seco", titulo: "Régua começada",
               detalhe: "em <b>x " + m.x + " z " + m.z + "</b> — clique no outro ponto" });
    } else {
      contar({ tom: "bom", titulo: "<b>" + m.distancia + "</b> blocos",
               detalhe: "de " + m.de.x + " " + m.de.z + " até " + m.ate.x + " " + m.ate.z +
                        " · " + m.andando + " s andando, " + m.correndo + " s correndo" });
      SOM.tocar("aceitar");
    }
    return;
  }

  if (m.tipo === "mapa:clique" && Number.isFinite(m.x) && Number.isFinite(m.z)) {
    abrirMenuDoMapa(Math.round(m.x), Math.round(m.z), m.cx, m.cy);
  }
});

/* ── O menu do clique ──
   Antes o clique era só teleporte, e para explodir uma casa você tinha
   que escrever "boom at" antes de clicar. Agora a escolha vem depois de
   ver onde você clicou.

   Todas as ações usam as duas coordenadas com altura calculada pelo
   addon — é ele que mede o terreno e pousa em cima do bloco mais alto. */
const ACOES_DO_MAPA = [
  { id: "tp", nome: "Teleportar aqui", tecla: "T",
    svg: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3"/>',
    linha: (x, z) => `tp ${S.alvo} to ${x} ${z}` },
  { id: "boom", nome: "Explodir aqui", tecla: "B", perigo: true,
    svg: '<path d="M12 2v4M5.5 5.5l2.5 2.5M18.5 5.5 16 8M4 15a8 8 0 0 0 16 0z"/>',
    linha: (x, z) => `boom at ${x} ${z} radius 6` },
  { id: "summon", nome: "Invocar aqui", tecla: "S",
    svg: '<path d="M4 20h16M12 4v11M8 8l4-4 4 4"/>',
    linha: (x, z) => `summon zombie at ${x} ${z}` },
  { id: "coord", nome: "Só a coordenada", tecla: "C",
    svg: '<path d="M9 9h10v10H9zM5 15V5h10"/>',
    linha: null },
  { id: "pino", nome: "Marcar este lugar", tecla: "M",
    svg: '<path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>',
    linha: null },
];

let _ondeCliquei = null;

function abrirMenuDoMapa(x, z, cx, cy) {
  _ondeCliquei = { x: x, z: z };
  const menu = $("menu-mapa");

  const jaTemPino = MAPA.pinos.find((p) => p.x === x && p.z === z);
  menu.innerHTML =
    '<div class="onde">x <b>' + x + "</b>   z <b>" + z + "</b></div>" +
    ACOES_DO_MAPA.map((a) => {
      const nome = a.id === "pino" && jaTemPino ? "Tirar a marca daqui" : a.nome;
      return `<button data-id="${a.id}"${a.perigo ? ' class="perigo"' : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">${a.svg}</svg>
        <span>${nome}</span><kbd>${a.tecla}</kbd></button>`;
    }).join("");

  for (const b of menu.querySelectorAll("button")) {
    b.onclick = () => escolherNoMapa(b.dataset.id);
  }

  menu.hidden = false;
  menu.style.left = Math.min(cx, window.innerWidth - menu.offsetWidth - 14) + "px";
  menu.style.top = Math.min(cy, window.innerHeight - menu.offsetHeight - 14) + "px";
  SOM.tocar("tecla");
}

function fecharMenuDoMapa() {
  $("menu-mapa").hidden = true;
}

function escolherNoMapa(id) {
  const onde = _ondeCliquei;
  if (!onde) return;
  const acao = ACOES_DO_MAPA.find((a) => a.id === id);
  fecharMenuDoMapa();
  if (!acao) return;

  if (id === "pino") return alfinetarLugar(onde.x, onde.z);

  if (id === "coord") {
    // Sem linha própria: a coordenada entra onde o cursor está, que é o
    // que serve quando você já começou a escrever um comando.
    const atual = $("entrada").value.trim();
    const precisaDoAt = atual && !/\b(at|in|to)\s*$/i.test(atual);
    $("entrada").value = atual
      ? atual + (precisaDoAt ? " at " : " ") + onde.x + " " + onde.z + " "
      : onde.x + " " + onde.z + " ";
    $("entrada").focus();
    atualizarSugestoes();
    SOM.tocar("aceitar");
    // Também vai para a área de transferência - às vezes o destino é um
    // chat ou um bloco de notas, não a linha de comando. Efêmero, não
    // vira item na fita: por isso brinde() e não contar().
    navigator.clipboard?.writeText(onde.x + " " + onde.z)
      .then(() => brinde("Coordenada copiada", "bom"))
      .catch(() => {});
    return;
  }

  // As outras escrevem a linha inteira e deixam você conferir antes do
  // Enter — a regra da casa é que nada acontece por baixo do pano.
  $("entrada").value = acao.linha(onde.x, onde.z) + " ";
  $("entrada").focus();
  atualizarSugestoes();
  SOM.tocar("aceitar");
}

function alfinetarLugar(x, z) {
  const jaTem = MAPA.pinos.findIndex((p) => p.x === x && p.z === z);
  if (jaTem >= 0) {
    MAPA.pinos.splice(jaTem, 1);
    gravarPinos();
    contar({ tom: "seco", titulo: "Marca tirada", detalhe: "x " + x + " z " + z });
    return;
  }
  const nome = prompt("Nome deste lugar:", "Ponto " + (MAPA.pinos.length + 1));
  if (nome === null) return;
  MAPA.pinos.unshift({ x: x, z: z, nome: nome.trim() || ("x " + x + " z " + z), cor: "#d99a45" });
  gravarPinos();
  contar({ tom: "bom", titulo: "Lugar marcado", detalhe: "<b>" + esc(nome) + "</b> · x " + x + " z " + z });
}

/* ── Ferramentas do mapa ── */
const FERRAMENTAS_MAPA = [
  { id: "regua", titulo: "Medir distância — dois cliques no mapa",
    svg: '<path d="M3 15 15 3l6 6L9 21z"/><path d="M7.5 10.5 9 12M10.5 7.5 12 9M13.5 4.5 15 6"/>' },
  { id: "seguir", titulo: "Centralizar em quem está no mundo",
    svg: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>' },
  { id: "limpar", titulo: "Limpar medidas e marcas do mapa",
    svg: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>' },
  { risca: true },
  { id: "recarregar", titulo: "Recarregar o mapa",
    svg: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>' },
];

function desenharFerramentasDoMapa() {
  const caixa = $("ferramentas-mapa");
  caixa.innerHTML = FERRAMENTAS_MAPA.map((f) =>
    f.risca ? '<div class="risca"></div>'
      : `<button data-id="${f.id}" title="${f.titulo}" aria-label="${f.titulo}" aria-pressed="false">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                stroke-linecap="round" stroke-linejoin="round">${f.svg}</svg>
         </button>`).join("");

  for (const b of caixa.querySelectorAll("button")) {
    b.onclick = () => usarFerramentaDoMapa(b.dataset.id, b);
  }
}

function usarFerramentaDoMapa(id, botao) {
  SOM.tocar("tecla");

  if (id === "regua") {
    MAPA.medindo = !MAPA.medindo;
    botao.setAttribute("aria-pressed", String(MAPA.medindo));
    falarComOMapa({ tipo: "mapa:modo", modo: MAPA.medindo ? "regua" : "normal" });
    if (MAPA.medindo) {
      contar({ tom: "seco", titulo: "Régua ligada", detalhe: "clique em dois pontos do mapa" });
    }
    return;
  }

  if (id === "seguir") {
    const quem = S.jogadores.find((j) => j.nome === S.alvo) || S.jogadores[0];
    if (!quem) {
      contar({ tom: "morno", titulo: "Ninguém para seguir",
               detalhe: "o mapa centraliza em quem está no mundo" });
      return;
    }
    centralizarNoJogador(quem.nome);
    return;
  }

  if (id === "limpar") {
    MAPA.pinos = [];
    gravarPinos();
    falarComOMapa({ tipo: "mapa:limparRegua" });
    contar({ tom: "seco", titulo: "Mapa limpo", detalhe: "medidas e marcas removidas" });
    return;
  }

  if (id === "recarregar") recarregarMapa();
}

/* ═══════════════════════════════════════════════════════════════════
   A LINHA DE COMANDO
   ═══════════════════════════════════════════════════════════════════ */

function ciclarAlvo() {
  const opcoes = ["@a", ...S.jogadores.map((j) => j.nome)];
  const i = opcoes.indexOf(S.alvo);
  S.alvo = opcoes[(i + 1) % opcoes.length] || "@a";
  $("chip-alvo").textContent = S.alvo;
  desenharJogadores();
}

function definirAlvo(nome) {
  S.alvo = nome;
  $("chip-alvo").textContent = nome;
  desenharJogadores();
}

/* ── Repetir ──
   Ciclar às cegas por uma lista invisível fazia você clicar cinco vezes
   para chegar em 50 e passar direto se piscasse. Agora a lista aparece,
   com um campo livre para o número que não estiver nela. */
const PASSOS_VEZES = [
  { n: 1,   porque: "uma vez só" },
  { n: 5,   porque: "" },
  { n: 10,  porque: "" },
  { n: 50,  porque: "" },
  { n: 100, porque: "cuidado com o servidor" },
];

function definirVezes(n) {
  S.vezes = Math.max(1, Math.min(9999, Math.round(n) || 1));
  $("chip-vezes").textContent = S.vezes;
  $("botao-vezes").classList.toggle("forte", S.vezes > 1);
}

function fecharVezes() {
  const pop = $("pop-vezes");
  if (pop) pop.hidden = true;
}

function abrirVezes(ev) {
  ev.stopPropagation();
  const pop = $("pop-vezes");
  if (!pop.hidden) { fecharVezes(); return; }

  pop.innerHTML =
    PASSOS_VEZES.map((v) =>
      `<button class="passo${v.n === S.vezes ? " atual" : ""}" data-n="${v.n}">
         <span>${v.n}×</span>${v.porque ? `<span class="porque">${v.porque}</span>` : ""}
       </button>`).join("") +
    `<div class="campo-livre">
       <input id="vezes-livre" type="number" min="1" max="9999" value="${S.vezes}"
              aria-label="Quantas vezes repetir">
     </div>`;

  for (const b of pop.querySelectorAll(".passo")) {
    b.onclick = () => { definirVezes(Number(b.dataset.n)); SOM.tocar("tecla"); fecharVezes(); };
  }
  const livre = pop.querySelector("#vezes-livre");
  livre.oninput = () => definirVezes(Number(livre.value));
  livre.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); SOM.tocar("aceitar"); fecharVezes(); $("entrada").focus(); }
    if (e.key === "Escape") { fecharVezes(); $("entrada").focus(); }
  };

  const r = $("botao-vezes").getBoundingClientRect();
  pop.hidden = false;
  // Posiciona depois de aparecer: antes disso a altura ainda é zero.
  pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 14) + "px";
  pop.style.top = (r.top - pop.offsetHeight - 8) + "px";
  livre.select();
  SOM.tocar("tecla");
}

/* Os bancos de sugestão são sempre os mesmos enquanto o catálogo não
   muda, então são montados uma vez só. */
let _bancoGive = null, _bancoSummon = null;

function bancoDoGive() {
  if (!_bancoGive) {
    _bancoGive = [...new Set([
      ...Object.keys(CAT.encantamentos), ...Object.keys(PODERES), ...CAT.efeitos,
    ])];
  }
  return _bancoGive;
}

function bancoDoSummon() {
  if (!_bancoSummon) {
    _bancoSummon = [...new Set([...Object.keys(KITS), ...CAT.efeitos, ...CAT.itens])];
  }
  return _bancoSummon;
}

function nomesOnline() {
  return ["@a", ...S.jogadores.map((j) => j.nome)];
}

/* Casa por começo primeiro, por pedaço depois - digitar "nether" acha
   netherite_sword, e digitar "sword" também. */
/* Quantas sugestões a lista mostra de uma vez. Quarenta linhas enchem a
   caixa rolável sem custar caro para desenhar; o rodapé avisa quando há
   mais e um caractere a mais de busca já corta a diferença. */
const QUANTAS_SUGESTOES = 40;

/* Cada lista é preparada uma vez: o texto em minúsculas fica pronto ao
   lado do valor original. Sem isso, digitar uma letra fazia 1869
   toLowerCase() — de novo, e de novo, a cada tecla. */
const _preparadas = new WeakMap();

function prepararLista(lista) {
  let pronta = _preparadas.get(lista);
  if (!pronta) {
    pronta = lista.map((v) => ({ v: v, b: String(v).toLowerCase() }));
    _preparadas.set(lista, pronta);
  }
  return pronta;
}

function filtrar(lista, pedaco, limite) {
  limite = limite || QUANTAS_SUGESTOES;
  if (!pedaco) return { itens: lista.slice(0, limite), total: lista.length };

  const p = pedaco.toLowerCase();
  const pronta = prepararLista(lista);

  // Quem começa com o que foi digitado vem primeiro; quem só contém vem
  // depois. Os dois montes são contados inteiros para o rodapé poder
  // dizer quantas opções existem de verdade.
  const comeca = [], contem = [];
  for (let i = 0; i < pronta.length; i++) {
    const item = pronta[i];
    if (item.b.startsWith(p)) comeca.push(item.v);
    else if (item.b.includes(p)) contem.push(item.v);
  }

  const total = comeca.length + contem.length;
  const itens = comeca.length >= limite
    ? comeca.slice(0, limite)
    : comeca.concat(contem.slice(0, limite - comeca.length));
  return { itens: itens, total: total };
}

/* O que faz sentido oferecer no ponto exato onde o cursor está. */
/* Empacota o resultado do filtro num contexto de sugestões, guardando
   quantas opções existiam no total — é isso que o rodapé mostra. */
function comoLista(pedaco, achado, comoTexto) {
  const bruto = achado.itens !== undefined ? achado : { itens: achado, total: achado.length };
  return {
    pedaco: pedaco,
    total: bruto.total,
    itens: bruto.itens.map(comoTexto),
  };
}

function ondeEstou(texto) {
  const partes = texto.split(/\s+/);
  const escrevendo = partes[partes.length - 1];
  const antes = partes.slice(0, -1).map((p) => p.toLowerCase());
  const cmd = antes[0] || "";

  // Ainda escrevendo o nome do comando.
  if (antes.length === 0) {
    return {
      pedaco: escrevendo,
      itens: filtrar(COMANDOS.map((c) => c.nome), escrevendo).itens.map((n) => {
        const c = COMANDOS.find((x) => x.nome === n);
        return { valor: n, args: c.args, desc: c.desc };
      }),
    };
  }

  const anterior = antes[antes.length - 1];
  const dentroDeWith = antes.lastIndexOf("with") > -1 &&
    antes.lastIndexOf("with") > Math.max(
      antes.lastIndexOf("at"), antes.lastIndexOf("named"), antes.lastIndexOf("to"),
      antes.lastIndexOf("in"), antes.lastIndexOf("on"));

  // give ... in hand|inventory / on ground — onde o item aparece. Antes
  // de "at/to/in" virar nome de jogador, "in"/"on" do give precisam
  // apontar para o destino do item.
  if (cmd === "give" && anterior === "in") {
    return comoLista(escrevendo, filtrar(["hand", "inventory"], escrevendo), (n) => ({
      valor: n, desc: n === "hand" ? "na mão dele (padrão)" : "no inventário dele",
    }));
  }
  if (cmd === "give" && anterior === "on") {
    return comoLista(escrevendo, filtrar(["ground"], escrevendo), (n) => ({ valor: n, desc: "cai aos pés dele" }));
  }

  // Depois de "at", "to" ou "in": quem está no mundo.
  if (["at", "to", "in"].includes(anterior)) {
    return comoLista(escrevendo, filtrar(nomesOnline(), escrevendo), (n) => ({ valor: n, desc: "quem está no mundo" }));
  }

  // Depois de "radius": números redondos que valem a pena.
  if (anterior === "radius" || anterior === "raio") {
    return { pedaco: escrevendo, itens: [5, 10, 25, 50, 100, 300].map((n) => ({ valor: String(n), desc: n >= 100 ? "isso apaga o bairro" : "raio em blocos" })) };
  }

  // Dentro de "with": kit, efeito, encantamento ou item.
  if (dentroDeWith) {
    // Se o anterior é um encantamento, o que falta é o nível.
    if (anterior in CAT.encantamentos) {
      const teto = CAT.encantamentos[anterior];
      const niveis = Array.from({ length: teto }, (_, i) => ({
        valor: String(i + 1),
        desc: i + 1 === teto ? "o máximo que o jogo aceita" : "nível do encantamento",
      }));
      // Nome que também é poder: acima do teto deixa de ser encantamento e
      // vira poder, então os números grandes precisam aparecer aqui — com
      // "multishot" a lista mostrava só o "1" e dava a impressão de que
      // não dava para pedir mais.
      if (anterior in PODERES) {
        for (const n of [5, 12, 30, 100, 200]) {
          if (n > teto) niveis.push({ valor: String(n), desc: "vira poder, sem teto" });
        }
      }
      return { pedaco: escrevendo, total: niveis.length, itens: niveis };
    }
    if (anterior in PODERES && !PODERES_SEM_NUMERO.includes(anterior) && anterior !== "nobreak") {
      return { pedaco: escrevendo, itens: [10, 100, 1000, 4000, 32767].map((n) => ({
        valor: String(n), desc: n >= 4000 ? "aqui não tem limite" : "quanto",
      })) };
    }
    if (CAT.efeitos.includes(anterior)) {
      return { pedaco: escrevendo, itens: [1, 2, 5, 10, 50, 255].map((n) => ({ valor: String(n), desc: n > 10 ? "aqui o exagero funciona" : "força do efeito" })) };
    }
    if (anterior === "health" || anterior === "vida") {
      return { pedaco: escrevendo, itens: [20, 50, 100, 200, 500].map((n) => ({ valor: String(n), desc: "pontos de vida" })) };
    }
    // Montado uma vez e guardado: remontar o Set a cada tecla era
    // trabalho jogado fora. O Set continua ali porque "multishot" e
    // "knockback" vivem nos dois catálogos e apareciam duplicados.
    const banco = cmd === "give" ? bancoDoGive() : bancoDoSummon();
    const desc = (n) =>
      (n in PODERES && n in CAT.encantamentos)
          ? "até nível " + romano(CAT.encantamentos[n]) + ", acima disso vira poder"
        : n in PODERES ? PODERES[n] + " — sem teto"
        : n in CAT.encantamentos ? "encantamento, até nível " + romano(CAT.encantamentos[n])
        : n in KITS ? "armadura completa"
        : CAT.efeitos.includes(n) ? "efeito"
        : "item para a mão";
    const itensDoBanco = filtrar(banco, escrevendo).itens.map((n) => ({ valor: n, desc: desc(n) }));

    // O "with" também pode terminar aqui: é "dentro do with" o instante
    // em que você acabou de escrever um encantamento ou poder e ainda
    // não disse onde o item aparece. "in"/"on" entram numa lista à parte
    // — de dois itens, não vale montar cache para ela.
    if (cmd !== "give") return { pedaco: escrevendo, itens: itensDoBanco };
    const ondeOItem = ["in", "on"].filter((l) => !antes.includes(l));
    const itensDeOnde = filtrar(ondeOItem, escrevendo).itens.map((n) => ({
      valor: n,
      desc: n === "in" ? "onde o item aparece — mão ou inventário" : "onde o item aparece — no chão",
    }));
    return { pedaco: escrevendo, itens: itensDeOnde.concat(itensDoBanco) };
  }

  // Primeiro argumento de cada comando.
  if (cmd === "summon" && antes.length === 1) {
    return comoLista(escrevendo, filtrar(CAT.mobs, escrevendo), (n) => ({ valor: n, desc: n.includes(":") ? "de addon" : "criatura" }));
  }
  if (cmd === "give") {
    if (antes.length === 1) return comoLista(escrevendo, filtrar(nomesOnline(), escrevendo), (n) => ({ valor: n, desc: "quem recebe" }));
    if (antes.length === 2) return comoLista(escrevendo, filtrar(CAT.itens, escrevendo), (n) => ({ valor: n, desc: n.includes(":") ? "de addon" : "item" }));
  }
  if (["tp", "kill", "clear", "xp", "title"].includes(cmd) && antes.length === 1) {
    return comoLista(escrevendo, filtrar(nomesOnline(), escrevendo), (n) => ({ valor: n, desc: "quem está no mundo" }));
  }
  if (cmd === "effect") {
    if (antes.length === 1) return comoLista(escrevendo, filtrar(nomesOnline(), escrevendo), (n) => ({ valor: n, desc: "em quem" }));
    if (antes.length === 2) return comoLista(escrevendo, filtrar(CAT.efeitos, escrevendo), (n) => ({ valor: n, desc: "efeito" }));
  }
  if (cmd === "gamemode" && antes.length === 1) {
    return comoLista(escrevendo, filtrar(["survival", "creative", "adventure", "spectator"], escrevendo), (n) => ({ valor: n, desc: "modo de jogo" }));
  }
  if (cmd === "weather" && antes.length === 1) {
    return comoLista(escrevendo, filtrar(["clear", "rain", "thunder"], escrevendo), (n) => ({ valor: n, desc: "clima" }));
  }
  if (cmd === "time" && antes.length === 1) {
    return comoLista(escrevendo, filtrar(["set", "add", "query"], escrevendo), (n) => ({ valor: n, desc: "hora" }));
  }
  if (cmd === "time" && anterior === "set") {
    return comoLista(escrevendo, filtrar(["day", "night", "noon", "midnight", "sunrise", "sunset"], escrevendo), (n) => ({ valor: n, desc: "hora do dia" }));
  }

  // Nada específico: oferecer as ligações que cabem aqui.
  const ligacoesUteis = {
    summon: ["at", "with", "named", "every"],
    give: ["with", "named", "lore", "in", "on"],
    boom: ["at", "radius", "fire", "nobreak"],
    tp: ["to"],
  }[cmd];
  if (ligacoesUteis) {
    const explica = {
      at: "onde acontece", with: "o que vem junto", named: "nome que aparece",
      lore: "descrição do item", every: "espaçar em milissegundos",
      to: "para onde", radius: "raio em blocos", fire: "deixa pegando fogo",
      nobreak: "não quebra bloco",
      in: "onde o item aparece — mão ou inventário", on: "onde o item aparece — no chão",
    };
    // Este era o único que a conversão automática não pegou, por estar
    // quebrado em duas linhas - e por isso o autocomplete estourava
    // justamente ao passar de uma seção do comando para a próxima.
    return comoLista(
      escrevendo,
      filtrar(ligacoesUteis.filter((l) => !antes.includes(l)), escrevendo),
      (n) => ({ valor: n, desc: explica[n] })
    );
  }
  return { pedaco: escrevendo, itens: [] };
}

/* ── A lista de sugestões ──
   Duas coisas separadas, e essa separação é o ponto:

   - REDESENHAR só quando o conjunto de opções muda (você digitou algo);
   - MOVER só troca qual linha está acesa, sem tocar no resto.

   Antes as duas coisas eram a mesma função, então apertar a seta para
   baixo reconstruía as 60 linhas do zero. Daí vinha o piscar, a perda da
   rolagem e a sensação de travamento — o custo não estava no filtro
   (0,19 ms para 1869 itens), estava em refazer o DOM à toa. */

let _listaDesenhada = "";   // assinatura do que está na tela agora
let _nosDaLista = [];       // as linhas, para acender uma sem refazer todas

function atualizarSugestoes() {
  const texto = $("entrada").value;
  const contexto = texto.trim() ? ondeEstou(texto.replace(/^\s+/, "")) : { itens: [] };

  S.sugestoes = contexto.itens;
  S.pedacoAtual = contexto.pedaco || "";
  S.totalSugestoes = contexto.total || S.sugestoes.length;
  if (S.sugestaoAtiva >= S.sugestoes.length) S.sugestaoAtiva = 0;

  desenharSugestoes();
  atualizarPrevia();
}

function desenharSugestoes() {
  const caixa = $("sugestoes");

  if (!S.sugestoes.length) {
    caixa.hidden = true;
    caixa.textContent = "";
    _listaDesenhada = "";
    _nosDaLista = [];
    return;
  }

  // Assinatura barata do conteúdo: se não mudou, o DOM fica como está e
  // só a linha acesa muda de lugar.
  const assinatura = S.totalSugestoes + "|" + S.sugestoes.map((c) => c.valor).join("\u0001");
  if (assinatura === _listaDesenhada) {
    acenderSelecionada();
    return;
  }
  _listaDesenhada = assinatura;

  // Montado fora da árvore e inserido de uma vez: um só recálculo de
  // layout em vez de um por linha.
  const pedaco = document.createDocumentFragment();
  _nosDaLista = S.sugestoes.map((c, i) => {
    const linha = document.createElement("div");
    linha.className = "sug";
    linha.dataset.i = i;

    const nome = document.createElement("span");
    nome.className = "mono nome";
    // Acende o pedaço que casou: com "ne" em netherite_sword, fica claro
    // por que aquela linha está ali.
    const onde = S.pedacoAtual
      ? String(c.valor).toLowerCase().indexOf(S.pedacoAtual.toLowerCase())
      : -1;
    if (onde >= 0) {
      const texto = String(c.valor);
      const fim = onde + S.pedacoAtual.length;
      const casa = document.createElement("span");
      casa.className = "casa";
      casa.textContent = texto.slice(onde, fim);
      nome.append(texto.slice(0, onde), casa, texto.slice(fim));
    } else {
      nome.textContent = c.valor;
    }

    const args = document.createElement("span");
    args.className = "mono args";
    args.textContent = c.args || "";

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = c.desc || "";

    linha.append(nome, args, desc);
    pedaco.append(linha);
    return linha;
  });

  const escondidas = Math.max(0, S.totalSugestoes - S.sugestoes.length);
  const rodape = document.createElement("div");
  rodape.className = "rodape mono";
  rodape.innerHTML =
    `<span>${S.totalSugestoes} ${S.totalSugestoes === 1 ? "opção" : "opções"}` +
    (escondidas ? ` · ${escondidas} a mais, escreva um pouco mais` : "") + "</span>" +
    `<span class="rodape-atalhos">↑ ↓ escolher · Tab completar · Enter mandar · F modo de jogo</span>`;
  pedaco.append(rodape);

  caixa.textContent = "";
  caixa.append(pedaco);
  caixa.hidden = false;
  caixa.scrollTop = 0;

  // Um ouvinte na caixa em vez de um por linha: com 60 linhas isso são 59
  // registros a menos por digitação.
  caixa.onclick = (ev) => {
    const linha = ev.target.closest(".sug");
    if (linha) aplicarSugestao(Number(linha.dataset.i));
  };

  acenderSelecionada();
}

/* Troca qual linha está acesa. Não refaz nada, não filtra nada. */
function acenderSelecionada() {
  for (let i = 0; i < _nosDaLista.length; i++) {
    _nosDaLista[i].classList.toggle("ativa", i === S.sugestaoAtiva);
  }
  const alvo = _nosDaLista[S.sugestaoAtiva];
  if (!alvo) return;

  const caixa = $("sugestoes");
  const topo = alvo.offsetTop;
  const fim = topo + alvo.offsetHeight;
  const RODAPE = 30;
  if (topo < caixa.scrollTop) caixa.scrollTop = topo;
  else if (fim > caixa.scrollTop + caixa.clientHeight - RODAPE) {
    caixa.scrollTop = fim - caixa.clientHeight + RODAPE;
  }
}

function moverSelecao(passo) {
  const quantas = S.sugestoes.length;
  if (!quantas) return;
  S.sugestaoAtiva = ((S.sugestaoAtiva + passo) % quantas + quantas) % quantas;
  acenderSelecionada();
  SOM.tocar("tecla");
}

function aplicarSugestao(i) {
  const c = S.sugestoes[i];
  if (!c) return;
  SOM.tocar("aceitar");
  const campo = $("entrada");
  const partes = campo.value.split(/\s+/);
  partes[partes.length - 1] = c.valor;
  campo.value = partes.join(" ") + " ";
  campo.focus();
  S.sugestaoAtiva = 0;
  atualizarSugestoes();
}

/* ── A prévia do item ──
   O que sobrou de valioso da bancada: ver o item se formar enquanto você
   escreve, do jeito que o tooltip do jogo mostra — nome, encantamentos em
   roxo, poderes com o valor, e a descrição em itálico. Só um "give" com
   "with" tem o que mostrar aqui; o resto da linha já se lê sozinho. */

function nomeDoItem(item) {
  return item.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Alguns ids chegam com o prefixo "minecraft:" na frente (é assim que o
   próprio jogo os identifica por dentro) — sem isso, esse pedaço técnico
   vazava pra tela. As duas funções abaixo são a mesma conta, uma para
   cada catálogo (item, criatura), só para o nome do chamador já dizer
   qual coisa está sendo limpa: tira o prefixo, troca "_" por espaço, e
   deixa maiúscula só a primeira letra — frase corrida, não Título De
   Cada Palavra como nomeDoItem faz para o cartão da prévia. */
function nomeBonitoDeItem(id) {
  const limpo = String(id || "").replace(/^minecraft:/, "").replace(/_/g, " ");
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}
function nomeBonitoDeMob(id) {
  const limpo = String(id || "").replace(/^minecraft:/, "").replace(/_/g, " ");
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/* Os poderes não têm um "nome bonito" próprio como os encantamentos — só
   a descrição longa do autocomplete. Para o cartão, o nome da chave já
   basta, do mesmo jeito que o item vira "Netherite Sword". */
function nomeDoPoder(id) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Cada poder com o valor ao lado, e os efeitos que "with" também aceita
   (a mesma lista que um "speed 2" alimenta) com o nome em português. */
function linhasDePoderes(poderes) {
  if (!poderes) return [];
  const linhas = [];
  for (const chave of Object.keys(poderes)) {
    if (chave === "efeitos") continue;
    const valor = poderes[chave];
    if (chave === "breakblocks" && valor === false) { linhas.push("Sem quebrar bloco"); continue; }
    if (valor === true) { linhas.push(nomeDoPoder(chave)); continue; }
    linhas.push(nomeDoPoder(chave) + " " + valor);
  }
  for (const ef of poderes.efeitos || []) {
    const nome = (EFEITOS.find(([id]) => id === ef.id) || [ef.id, nomeDoPoder(ef.id)])[1];
    linhas.push(nome + " " + romano(ef.nivel));
  }
  return linhas;
}

/* Só há o que mostrar quando a linha é um "give ... with": sem "with"
   não sobra nada que a própria linha já não diga. */
function pedidoDaPrevia(texto) {
  const bruto = texto.trim();
  if (!/^give\b/i.test(bruto) || !/\bwith\b/i.test(bruto)) return null;
  const traduzido = traduzir(bruto);
  if (!traduzido || traduzido.tipo !== "give" || !traduzido.pedido.item) return null;
  return traduzido.pedido;
}

function atualizarPrevia() {
  const previa = $("previa-item");
  const pedido = pedidoDaPrevia($("entrada").value);
  if (!pedido) { previa.hidden = true; previa.innerHTML = ""; return; }

  const encantes = Object.keys(pedido.encantes || {});
  const poderes = linhasDePoderes(pedido.poderes);

  previa.innerHTML =
    `<div class="previa-nome">${esc(pedido.nome || nomeBonitoDeItem(pedido.item))}</div>` +
    encantes.map((id) =>
      `<div class="previa-encanto">${esc(NOME_ENCANTO[id] || nomeDoPoder(id))} ${romano(pedido.encantes[id])}</div>`).join("") +
    poderes.map((linha) => `<div class="previa-poder">${esc(linha)}</div>`).join("") +
    (pedido.lore ? `<div class="previa-lore">${esc(pedido.lore)}</div>` : "");

  previa.hidden = false;
}

/* ── De novo ──
   O corte é pelo meio de propósito: "give LentDust064 egg with mul…"
   escondia justamente o pedaço que diferencia um comando do outro. Com o
   começo e o fim preservados, "give Lent…with multishot 200" já se lê. */
function cortarNoMeio(texto, limite) {
  if (texto.length <= limite) return texto;
  const cabeca = Math.ceil((limite - 1) * 0.45);
  return texto.slice(0, cabeca) + "…" + texto.slice(texto.length - (limite - 1 - cabeca));
}

/* Os comandos fixados não são empurrados para fora pelo uso: um alfinete
   transforma a pílula num atalho permanente. */
let FIXOS = [];
try { FIXOS = JSON.parse(localStorage.getItem("aether.fixos") || "[]"); } catch (e) { FIXOS = []; }

function gravarFixos() {
  localStorage.setItem("aether.fixos", JSON.stringify(FIXOS.slice(0, 12)));
}

function guardarNoHistorico(cmd) {
  S.historico = [cmd, ...S.historico.filter((h) => h !== cmd)].slice(0, 12);
  localStorage.setItem("aether.historico", JSON.stringify(S.historico));
  desenharHistorico();
}

function desenharHistorico() {
  // Os fixados vêm sempre na frente, na ordem em que foram fixados, e não
  // aparecem duas vezes quando também estão no histórico recente.
  const recentes = S.historico.filter((h) => !FIXOS.includes(h));
  const lista = FIXOS.concat(recentes).slice(0, 12);

  $("historico-pilulas").innerHTML = lista.map((h) => {
    const fixa = FIXOS.includes(h);
    return `<button class="pilula-hist chanfro-p mono${fixa ? " fixa" : ""}" data-cmd="${esc(h)}" title="${esc(h)}">
      <span class="alfinete" data-alfinete="1" title="${fixa ? "Soltar" : "Fixar como atalho"}">${fixa ? "◆" : "◇"}</span>
      <span class="corpo">${esc(cortarNoMeio(h, 44))}</span>
    </button>`;
  }).join("");

  for (const el of $("historico-pilulas").children) {
    el.onclick = (ev) => {
      const cmd = el.dataset.cmd;
      if (ev.target.closest("[data-alfinete]")) {
        ev.stopPropagation();
        if (FIXOS.includes(cmd)) FIXOS = FIXOS.filter((f) => f !== cmd);
        else FIXOS = [cmd, ...FIXOS].slice(0, 12);
        gravarFixos();
        desenharHistorico();
        SOM.tocar("tecla");
        return;
      }
      $("entrada").value = cmd + " ";
      $("entrada").focus();
      atualizarSugestoes();
      SOM.tocar("aceitar");
    };
  }
}

async function mandarLinha() {
  const cru = $("entrada").value.trim();
  if (!cru) return;

  guardarNoHistorico(cru);
  $("entrada").value = "";
  atualizarSugestoes();
  SOM.tocar("mandar");

  // O botão vira a barra de espera: some o texto e passa um brilho, para
  // a demora ter uma cara em vez de ser um congelamento.
  const botao = $("botao-mandar");
  botao.disabled = true;
  botao.classList.add("indo");
  const comecou = performance.now();

  try {
    const traduzido = traduzir(cru);
    if (traduzido) await executarTraduzido(traduzido);
    else await mandarCru(cru);
  } catch (e) {
    contar({ tom: "ruim", titulo: "Não consegui falar com o painel", detalhe: mensagemDeFalha(e.message), cru: cru + " — " + e.message });
  } finally {
    botao.disabled = false;
    botao.classList.remove("indo");
    const ms = Math.round(performance.now() - comecou);
    // Só vale contar a demora quando ela foi sentida.
    if (ms > 2500) {
      contar({ tom: "morno", titulo: "Essa demorou " + (ms / 1000).toFixed(1) + " segundos",
               detalhe: "o mundo pode estar carregando o pedaço", cru: cru });
    }
  }
}

async function mandarCru(cru) {
  const vezes = S.vezes;
  const lista = Array.from({ length: vezes }, () => cru);
  const r = await api("/api/comando", { cmds: lista });
  const saida = (r.saida || "").trim();
  // A resposta do comando vanilla já vem em frase; o que ela não tem é
  // contexto, então o comando mandado vira o detalhe.
  contar({
    tom: r.ok ? "bom" : "ruim",
    titulo: saida ? esc(saida.split("\n")[0]) : (r.ok ? "Feito" : "Sem resposta do servidor"),
    detalhe: esc(cru) + (vezes > 1 ? " · " + vezes + " vezes" : ""),
    cru: saida,
  });
}

async function executarTraduzido({ tipo, pedido }) {
  if (tipo === "summon") return executarSummon(pedido);
  if (tipo === "give")   return executarGive(pedido);
  if (tipo === "boom")   return executarBoom(pedido);
  if (tipo === "tp")     return executarTp(pedido);
}

async function executarSummon(pedido) {
  if (!pedido.mob) { dizer("Faltou dizer qual criatura invocar.", "ruim"); return; }

  const total = Math.max(1, pedido.qtd || 1);
  // O addon nasce até 64 por chamada. Acima disso a gente reparte, e as
  // chamadas saem juntas — o que dá o "PUM" em vez de uma fila lenta.
  const LOTE = 64;
  const chamadas = [];
  let falta = total;
  while (falta > 0) {
    chamadas.push({ ...pedido, qtd: Math.min(LOTE, falta) });
    falta -= LOTE;
  }

  if (total > 400) {
    contar({ tom: "morno", titulo: total + " criaturas de uma vez pode engasgar o servidor",
             detalhe: "para estrago puro, <b>boom</b> sai mais barato" });
  }

  let respostas;
  if (pedido.intervalo_ms > 0) {
    respostas = [];
    for (const c of chamadas) {
      respostas.push(await api("/api/admin/summon", c));
      await new Promise((r) => setTimeout(r, pedido.intervalo_ms));
    }
  } else {
    respostas = await Promise.all(chamadas.map((c) => api("/api/admin/summon", c)));
  }

  const primeira = respostas.find((r) => (r.saida || "").includes("INVOCA|ok")) || respostas[0];
  const nota = traduzirInvocacao(primeira.saida);
  if (total > 1 && nota.tom !== "ruim") {
    nota.titulo = "<b>" + total + "×</b> " + nota.titulo;
  }
  // A fita já registra isto — um brinde diria a mesma coisa duas vezes,
  // em dois cantos da tela.
  contar(nota);
}

async function executarGive(pedido) {
  if (!pedido.item) {
    contar({ tom: "ruim", titulo: "Faltou dizer qual item dar" });
    return;
  }
  const r = await api("/api/forjar", pedido);
  const nota = traduzirForja(r.saida);
  // "Item entregue a Fulano" no brinde e "Entregue na mão a Fulano" na
  // fita, no mesmo instante, eram a mesma notícia duas vezes — o próprio
  // achado desta revisão. Só a fita registra agora.
  contar(nota);
}

async function executarBoom(pedido) {
  // O addon Core Craft reage a cada bloco destruido e trava o servidor
  // quando sao muitos de uma vez - o watchdog do Bedrock ja derrubou o
  // mundo por isso. Explosao grande que quebra bloco fica avisada.
  if (pedido.quebra !== false && pedido.raio > 15) {
    contar({ tom: "morno",
             titulo: "Raio " + pedido.raio + " quebrando bloco pode travar o servidor",
             detalhe: "o addon Core Craft engasga com muita destruição — <b>nobreak</b> dá o efeito sem o risco" });
  }
  const r = await api("/api/boom", pedido);
  const nota = traduzirBoom(r.saida);
  if (nota.tom === "bom") SOM.tocar("estrondo");
  contar(nota);
}

function traduzirBoom(saida) {
  const linha = acharLinha(saida, "BOOM");

  if (linha && linha.startsWith("BOOM|ok")) {
    // O primeiro campo depois do "ok" é o raio; o segundo, onde foi. O
    // resto são avisos soltos ("com fogo", "sem quebrar bloco").
    const campos = linha.split("|").slice(2).filter((c) => c && !c.startsWith("#"));
    return {
      tom: "bom",
      titulo: "Explodiu",
      detalhe: esc(campos.join(" · ")),
      cru: linha,
    };
  }

  return {
    tom: "ruim",
    titulo: "Não consegui explodir",
    detalhe: dizerPorque(linha || saida || "") || "o servidor recusou",
    cru: linha || (saida || "").trim(),
  };
}

function traduzirTp(saida, quem) {
  const linha = acharLinha(saida, "TP");

  if (linha && linha.startsWith("TP|ok")) {
    const campos = linha.split("|");
    const onde = (campos[3] || "").trim();
    return {
      tom: "bom",
      titulo: "<b>" + esc(campos[2] || quem || "") + "</b> foi teleportado",
      // O destino pode ser "x,y,z" ou "junto de Fulano" — os dois se leem
      // melhor sem as vírgulas coladas.
      detalhe: esc(onde.replace(/,/g, " ")),
      cru: linha,
    };
  }

  // Com "@a" a frase "ninguém com esse nome" não faz sentido nenhum.
  const semNinguem = (linha || "").includes("ninguem_online");
  return {
    tom: "ruim",
    titulo: "Não consegui teleportar",
    detalhe: semNinguem && /\|@[apsr]\b/.test(linha || "")
      ? "Não há ninguém no mundo agora."
      : (dizerPorque(linha || saida || "") || "o servidor recusou"),
    cru: linha || (saida || "").trim(),
  };
}

async function executarTp(pedido) {
  const r = await api("/api/admin/tp", pedido);
  contar(traduzirTp(r.saida, pedido.quem));
}

/* ═══════════════════════════════════════════════════════════════════
   QUEM ESTÁ NO MUNDO
   ═══════════════════════════════════════════════════════════════════ */

/* Seis classes fixas (.jog-cor-0 .. .jog-cor-5, no CSS) — o hash do nome
   só escolhe qual delas usar. Nada de cor calculada vai para um estilo
   em linha. */
const QUANTAS_CORES_JOGADOR = 6;

function corDoJogador(nome) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return h % QUANTAS_CORES_JOGADOR;
}

/* ── Quem está no mundo — o herói da coluna ──
   Cartão maior que tudo ao redor: nome, dimensão, coordenada, e um botão
   para levar o mapa até lá sem abrir a ficha. Clicar no corpo do cartão
   continua preenchendo o alvo da linha, como sempre fez. */
function desenharJogadores() {
  const alvo = $("lista-jogadores");
  if (!S.jogadores.length) {
    alvo.innerHTML = `<div class="vidro chanfro vazio">Ninguém no mundo agora. Assim que alguém entrar, o cartão aparece aqui.</div>`;
    return;
  }
  alvo.innerHTML = S.jogadores.map((j) => {
    const cor = corDoJogador(j.nome);
    const p = S.posicoes[j.nome];
    const onde = p ? `${p.dim} · ${p.x} ${p.y} ${p.z}` : "posição ainda não chegou";
    const vidaTxto = p ? formatarVida(p.vida, p.vidaMax) : "—";
    const pct = p && Number.isFinite(p.vida) && Number.isFinite(p.vidaMax) && p.vidaMax > 0
      ? Math.max(0, Math.min(100, (p.vida / p.vidaMax) * 100)) : null;
    return `
    <div class="vidro chanfro cartao-jogador ${S.alvo === j.nome ? "alvo" : ""}" data-nome="${esc(j.nome)}">
      <div class="jogador-cabeca">
        <div class="avatar chanfro-p disp jog-cor-${cor}">${esc(j.nome[0].toUpperCase())}</div>
        <div class="jogador-id">
          <div class="jogador-nome disp">${esc(j.nome)}</div>
          <div class="jogador-onde mono">${esc(onde)}</div>
        </div>
        <div class="mono stat-vida">
          ${esc(vidaTxto)}
          ${pct !== null ? `<div class="barra-vida" data-pct="${pct}"><i></i></div>` : ""}
        </div>
      </div>
      <button class="btn chanfro-p jogador-centralizar" data-centralizar="1" ${p ? "" : "disabled"}
              title="Centralizar o mapa em ${esc(j.nome)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>
        Centralizar no mapa
      </button>
    </div>`;
  }).join("");

  [...alvo.children].forEach((el) => {
    if (!el.dataset.nome) return;
    const nome = el.dataset.nome;
    el.onclick = (ev) => { definirAlvo(nome); abrirFicha(nome, ev.currentTarget); };
    const botao = el.querySelector("[data-centralizar]");
    if (botao) botao.onclick = (ev) => { ev.stopPropagation(); centralizarNoJogador(nome); };
    // A largura da barra é o único número que muda a cada jogador — o
    // resto do desenho é só CSS. Uma custom property em vez de atributo
    // inline cru no HTML, para o dinâmico ficar restrito a essa variável.
    const barra = el.querySelector(".barra-vida[data-pct]");
    if (barra) barra.style.setProperty("--vida-pct", barra.dataset.pct + "%");
  });
}

/* Leva o mapa até quem está no mundo — usado pelo cartão do jogador, pela
   ficha, e pela ferramenta "Centralizar" da barra do mapa. Uma ação só,
   três portas de entrada. */
function centralizarNoJogador(nome) {
  const p = S.posicoes[nome];
  if (!p) {
    contar({ tom: "morno", titulo: "Ainda não sei onde ele está",
             detalhe: "a posição não chegou do servidor" });
    return;
  }
  falarComOMapa({ tipo: "mapa:ir", x: p.x, z: p.z });
  contar({ tom: "seco", titulo: "Mapa centralizado em <b>" + esc(nome) + "</b>",
           detalhe: "x " + p.x + " z " + p.z });
}

/* Manda um comando direto, sem passar pela linha. Usado pelos controles
   de céu e regras — eles são atalhos, não texto para você revisar. */
async function mandarDireto(cmd, nota) {
  try {
    const r = await api("/api/comando", { cmds: [cmd] });
    contar({ ...nota, tom: r.ok ? nota.tom : "ruim", cru: cmd });
  } catch (e) {
    contar({ tom: "ruim", titulo: "Não consegui mandar o comando", detalhe: mensagemDeFalha(e.message), cru: cmd + " — " + e.message });
  }
  // O mundo mudou: relê para os controles não ficarem contando história.
  puxarMundo();
}

function desenharClima() {
  const caixa = $("clima");
  const incerto = MUNDO.clima === "desconhecido";
  caixa.classList.toggle("incerto", incerto);
  caixa.innerHTML = CLIMAS.map((c) => `
    <button data-id="${c.id}" title="${c.nome}" aria-label="${c.nome}"
            aria-pressed="${String(!incerto && MUNDO.clima === c.id)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
           stroke-linecap="round" stroke-linejoin="round">${c.svg}</svg>
    </button>`).join("");

  for (const b of caixa.children) {
    b.onclick = () => {
      const c = CLIMAS.find((x) => x.id === b.dataset.id);
      MUNDO.clima = c.id;
      desenharClima();
      SOM.tocar("tecla");
      mandarDireto("weather " + c.id,
        { tom: "bom", titulo: "Clima trocado", detalhe: "agora está <b>" + c.nome.toLowerCase() + "</b>" });
    };
  }
}

/* Marco mais próximo da hora que está valendo. Com tolerância (padrão
   1800 tiques) devolve null longe de qualquer marco — é o que acende o
   segmentado. Sem tolerância (Infinity) sempre acha algum — é o que dá
   nome à hora atual para o topo e para a legenda ao lado do segmentado. */
function marcoMaisPerto(tique, tolerancia) {
  let melhor = HORAS[0], distancia = Infinity;
  for (const h of HORAS) {
    const d = Math.min(Math.abs(h.tique - tique), 24000 - Math.abs(h.tique - tique));
    if (d < distancia) { distancia = d; melhor = h; }
  }
  return distancia <= (tolerancia ?? 1800) ? melhor.id : null;
}

function nomeDaHora(tique) {
  const id = marcoMaisPerto(tique, Infinity);
  return (HORAS.find((h) => h.id === id) || {}).nome || "";
}

/* ── Hora do dia ──
   Um arco de SVG que subia por cima do segmentado de clima virou um
   segmentado de cinco, no mesmo estilo do clima — ícone em vez de nome,
   porque "Alvor" e "Poente" cortavam nos 220px da coluna. O nome por
   extenso continua na legenda logo abaixo ("Agora · Poente · 3671"). */
function desenharHoras() {
  const caixa = $("horas");
  if (!caixa.children.length) {
    caixa.innerHTML = HORAS.map((h) => `
      <button data-id="${h.id}" title="${esc(h.nome)}" aria-label="${esc(h.nome)}" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round">${h.svg}</svg>
      </button>`).join("");
    for (const b of caixa.children) {
      b.onclick = () => {
        const h = HORAS.find((x) => x.id === b.dataset.id);
        MUNDO.hora = h.tique;
        desenharHoras();
        SOM.tocar("tecla");
        mandarDireto("time set " + h.id,
          { tom: "bom", titulo: "Hora trocada", detalhe: "o mundo foi para <b>" + h.nome.toLowerCase() + "</b>" });
      };
    }
  }

  const incerto = MUNDO.hora == null;
  caixa.classList.toggle("incerto", incerto);
  const perto = incerto ? null : marcoMaisPerto(MUNDO.hora);
  for (const b of caixa.children) b.setAttribute("aria-pressed", String(b.dataset.id === perto));

  const legenda = $("hora-tique");
  if (legenda) legenda.textContent = incerto ? "—" : nomeDaHora(MUNDO.hora) + " · " + Math.round(MUNDO.hora);

  // A hora por extenso também mora no topo — atualiza os dois juntos.
  atualizarEstadoTopo();
}

function desenharRegras() {
  const caixa = $("regras-mundo");
  caixa.innerHTML = REGRAS_MUNDO.map((r) => {
    const sabido = r.id in MUNDO.regras;
    return `<div class="chave-linha">
      <span>${esc(r.rotulo)}</span>
      <button class="chave chanfro-p${sabido ? "" : " incerta"}" data-id="${r.id}"
              aria-pressed="${String(!!MUNDO.regras[r.id])}" aria-label="${esc(r.rotulo)}"><i></i></button>
    </div>`;
  }).join("");

  for (const linha of caixa.children) {
    const b = linha.querySelector(".chave");
    b.onclick = () => {
      const r = REGRAS_MUNDO.find((x) => x.id === b.dataset.id);
      const novo = !MUNDO.regras[r.id];
      MUNDO.regras[r.id] = novo;
      desenharRegras();
      SOM.tocar(novo ? "bom" : "tecla");
      mandarDireto("gamerule " + r.id + " " + novo,
        { tom: novo ? "bom" : "morno", titulo: r.rotulo,
          detalhe: (novo ? "ligado" : "desligado") + " para o mundo todo" });
    };
  }
}

function desenharAtalhos() {
  desenharClima();
  desenharHoras();
  desenharRegras();
}

async function puxarMundo() {
  try {
    const r = await api("/api/mundo");
    if (!r.ok) return;
    MUNDO.hora = r.hora;
    MUNDO.clima = r.clima || "desconhecido";
    MUNDO.regras = r.regras || {};
    MUNDO.lido = true;
    desenharAtalhos();
  } catch (e) { /* fica com o que já estava; os controles avisam pela cor */ }
}

/* ═══════════════════════════════════════════════════════════════════
   A FICHA DO JOGADOR
   ═══════════════════════════════════════════════════════════════════ */

function fecharFicha() { $("ficha").hidden = true; S.fichaDe = null; }

/* A ficha responde só a uma pergunta — onde ele está e como levar o mapa
   ou ele até o outro. Os atalhos de comando que moravam aqui (curar,
   força, criativo, nível, raio) saíram: são give/effect/gamemode pela
   linha, com o nome já preenchido pelo clique no cartão. */
function abrirFicha(nome, ancora) {
  if (S.fichaDe === nome) return fecharFicha();
  S.fichaDe = nome;
  const f = $("ficha");
  const p = S.posicoes[nome] || null;
  const cor = corDoJogador(nome);
  const onde = p ? (p.dim + " · " + p.x + " " + p.y + " " + p.z) : "Posição ainda não chegou do servidor";
  const vidaTxto = p ? formatarVida(p.vida, p.vidaMax) : "—";

  const acoes = [
    { rotulo: "Ir até ele",  linha: p ? `tp Rafa ${p.x} ${p.y} ${p.z}` : `tp @s ${nome}` },
    { rotulo: "Trazer aqui", linha: `tp ${nome} @s`,
      aviso: "Pousa na altura segura do lugar" },
  ];

  f.innerHTML = `
    <div class="cabeca">
      <div class="avatar chanfro-p disp avatar--ficha jog-cor-${cor}">${esc(nome[0].toUpperCase())}</div>
      <div class="ficha-id">
        <div class="ficha-nome disp">${esc(nome)}</div>
        <div class="ficha-onde mono">${esc(onde)}</div>
        <div class="mono ficha-vida">${esc(vidaTxto)}</div>
      </div>
      <button class="ficha-fechar" onclick="fecharFicha()" title="Fechar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M5 5l14 14M19 5L5 19"/></svg>
      </button>
    </div>
    <div class="ficha-corpo">
      <div class="linha-botoes">
        <button class="btn chanfro-p flex1 ficha-centralizar" ${p ? "" : "disabled"}>Centralizar no mapa</button>
      </div>
      <div class="linha-botoes">
        ${acoes.map((a, i) => `
          <button class="btn chanfro-p flex1 ficha-acao" data-i="${i}"${a.aviso ? ` title="${esc(a.aviso)}"` : ""}>${esc(a.rotulo)}</button>`).join("")}
      </div>
      <div class="dica ficha-dica">Cada botão escreve a linha lá embaixo — você lê e confere antes de mandar. <b>Trazer aqui</b> pousa na altura segura do lugar.</div>
    </div>`;

  f.querySelector(".ficha-centralizar").onclick = () => { centralizarNoJogador(nome); fecharFicha(); };
  [...f.querySelectorAll(".ficha-acao")].forEach((el) => {
    el.onclick = () => {
      const a = acoes[Number(el.dataset.i)];
      $("entrada").value = a.linha;
      $("entrada").focus();
      atualizarSugestoes();
      fecharFicha();
    };
  });

  f.hidden = false;
  const r = ancora ? ancora.getBoundingClientRect() : { right: 250, top: 90 };
  f.style.left = Math.min(r.right + 12, window.innerWidth - 350) + "px";
  f.style.top = Math.min(r.top, window.innerHeight - f.offsetHeight - 140) + "px";
}

/* A bancada (tela, abas Forja/Criatura/Efeito e os tradutores
   "forjar"/"invocar" com a gramatica chave:valor) foi removida: tudo
   que ela fazia a linha ja faz, na gramatica unica de give/summon/
   effect com "with". O que segue e a leitura da resposta do mundo,
   usada tanto por executarGive/executarSummon (linha) quanto pelos
   testes — nada aqui e exclusivo da bancada. */

/* O script do mundo responde em linhas de log como
   FORJA|ok|Fulano|netherite_sword|na mão|com=sharpness:5|o jogo recusou=silk_touch:incompativel
   Aqui isso vira uma frase que se lê. */
const MOTIVO_RECUSA = {
  incompativel: "briga com outro encantamento",
  item_nao_encantavel: "o item não aceita encantamento",
  nao_existe: "esse encantamento não existe",
  acima_do_teto: "acima do teto do jogo",
  recusado: "o jogo recusou",
};

function nomeBonito(par) {
  const [id, nivel] = par.split(":");
  const nome = NOME_ENCANTO[id] || id.replace(/_/g, " ");
  if (!nivel) return nome;
  const m = nivel.match(/^(\d+)(.*)$/);
  if (!m) return nome + " (" + (MOTIVO_RECUSA[nivel] || nivel) + ")";
  return nome + " " + romano(Number(m[1])) + (m[2] ? " " + m[2].trim() : "");
}

/* ── O que veio junto com o item ──
   O script devolve isso em duas gramáticas na mesma lista: encantamentos
   de verdade como "infinity:1", e o pacote dos nossos poderes como
   "poderes[multishot=200 explode=5]". Mostrar o segundo do jeito que
   chega é mostrar o encanamento — em português são só nomes e números. */
function listarExtras(bruto) {
  if (!bruto) return "";
  const nomes = [];

  // O pacote de poderes vem inteiro, com espaços dentro dos colchetes,
  // então ele sai da lista antes de separar o resto pelas vírgulas.
  const pacote = bruto.match(/poderes\[([^\]]*)\]/);
  const resto = bruto.replace(/poderes\[[^\]]*\],?/g, "");

  for (const par of resto.split(",")) {
    if (par.trim()) nomes.push(nomeBonito(par.trim()));
  }
  if (pacote) {
    for (const poder of pacote[1].split(/\s+/)) {
      if (!poder) continue;
      const [chave, valor] = poder.split("=");
      const rotulo = chave.replace(/_/g, " ");
      // "teleporta=true" não tem número para mostrar: o nome já diz tudo.
      nomes.push(valor && valor !== "true" ? rotulo + " " + valor : rotulo);
    }
  }
  return nomes.join(", ");
}

/* ── Achar a linha do script no meio da saída ──
   Ela nunca vem sozinha: o servidor põe "[Scripting] " na frente. Procurar
   pelo começo da linha nunca casava, e o painel acabava mostrando o
   protocolo cru na tela — era essa a origem do "FORJA|ok|…|#529668"
   aparecendo pra você em vez de uma frase. */
function acharLinha(saida, marcador) {
  const achada = (saida || "").split("\n").find((l) => l.includes(marcador + "|"));
  if (!achada) return null;
  return achada.slice(achada.indexOf(marcador + "|")).trim();
}

/* Os motivos que o script devolve, ditos em português. */
const PORQUE = {
  ninguem_online_com_esse_nome: "Ninguém com esse nome está no mundo agora.",
  ninguem_online: "Não há ninguém no mundo agora.",
  faltou_o_item: "Faltou dizer qual item forjar.",
  faltou_a_criatura: "Faltou dizer qual criatura invocar.",
  faltou_dizer_quem: "Faltou dizer quem teleportar.",
  receita_ilegivel: "O servidor não entendeu o pedido.",
  nao_consegui_ler_o_terreno: "Não consegui medir o chão desse ponto — o mundo por lá ainda não está carregado.",
  nao_carregou_esse_pedaco: "O servidor ainda não carregou esse pedaço do mundo.",
  destino_nao_encontrado: "Não achei esse destino.",
  acima_do_teto: "O jogo não aceita esse nível.",
  incompativel: "Esse encantamento não combina com esse item.",
  nao_existe: "Esse nome não existe no jogo.",
};

function dizerPorque(texto) {
  for (const chave of Object.keys(PORQUE)) {
    if (texto.includes(chave)) return PORQUE[chave];
  }
  return null;
}

/* Porta única para qualquer erro que não veio do script do mundo (falha
   de rede, exceção do JavaScript, saída de um comando de sistema): tenta
   o PORQUE conhecido e, sem achar, devolve uma frase em português em vez
   do texto de máquina. O bruto original nunca aparece — quem chama isto
   deve guardá-lo em "cru", escondido atrás do clique. */
function mensagemDeFalha(bruto) {
  return dizerPorque(String(bruto || "")) || "O servidor não disse por quê — tente de novo em instantes.";
}

function traduzirForja(saida) {
  const linha = acharLinha(saida, "FORJA");
  if (!linha) {
    return { tom: "ruim", titulo: "O servidor não respondeu à forja",
             detalhe: "", cru: (saida || "").trim() };
  }

  const campos = linha.split("|");

  if (campos[1] === "ok") {
    const [, , quem, item, onde] = campos;
    const com = (campos.find((c) => c.startsWith("com=")) || "").slice(4);
    const fora = (campos.find((c) => c.startsWith("o jogo recusou=")) || "").slice(15);
    const partes = [];
    if (com) partes.push("<b>com " + esc(listarExtras(com)) + "</b>");
    if (fora) partes.push("o jogo recusou " + esc(listarExtras(fora)));
    return {
      tom: fora ? "morno" : "bom",
      titulo: "Entregue " + esc(onde || "") + " a <b>" + esc(quem) + "</b>",
      detalhe: esc((item || "").replace(/_/g, " ")) + (partes.length ? " · " + partes.join(" · ") : ""),
      cru: linha,
    };
  }

  if (campos[1] === "cancelado") {
    const fora = (campos.find((c) => c.startsWith("recusados=")) || "").slice(10);
    return {
      tom: "ruim",
      titulo: "Nada foi entregue",
      detalhe: "o jogo recusou " + esc(fora.split(",").map(nomeBonito).join(", ")) +
               " — ligue “Insistir mesmo assim” para receber com o que passa",
      cru: linha,
    };
  }

  return {
    tom: "ruim",
    titulo: "Não consegui forjar",
    detalhe: dizerPorque(linha) || esc(linha.replace(/^FORJA\|erro:?/, "").split("|")[0]),
    cru: linha,
  };
}

/* Traduz "INVOCA|ok|Fulano|zombie ×3|com=mao=egg,vida=200|..." em frase. */
function traduzirInvocacao(saida) {
  const linha = acharLinha(saida, "INVOCA");
  if (!linha) {
    return { tom: "ruim", titulo: "O servidor não respondeu à invocação",
             detalhe: "", cru: (saida || "").trim() };
  }
  const campos = linha.split("|");

  if (campos[1] === "ok") {
    const [, , perto, criatura] = campos;
    const com = (campos.find((c) => c.startsWith("com=")) || "").slice(4);
    const fora = (campos.find((c) => c.startsWith("o jogo recusou=")) || "").slice(15);
    const partes = [];
    if (com) partes.push("<b>com " + esc(listarExtras(com)) + "</b>");
    if (fora) partes.push("o jogo recusou " + esc(listarExtras(fora)));
    return {
      tom: fora ? "morno" : "bom",
      titulo: "<b>" + esc((criatura || "").replace(/_/g, " ")) + "</b> nasceu",
      detalhe: esc(perto || "") + (partes.length ? " · " + partes.join(" · ") : ""),
      cru: linha,
      quantos: (String(criatura).match(/×(\d+)/) || [, "1"])[1],
    };
  }

  return {
    tom: "ruim",
    titulo: "Não consegui invocar",
    detalhe: dizerPorque(linha) || esc(linha.replace(/^INVOCA\|erro:?/, "").split("|")[0]),
    cru: linha,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   O SERVIDOR — lógica pura

   As contas que a tela de administração precisa e que não tocam no DOM:
   quanto tempo é "no ar", se um backup está atrasado, o que é uma linha
   de erro no log, e quem já passou pelo mundo. Ficam aqui, fora de
   qualquer desenharX(), para os testes chamarem sem precisar de tela.
   ═══════════════════════════════════════════════════════════════════ */

/* "3600" vira "1 hora", "190800" vira "2 dias e 5h". Sem hora zerada
   pendurada ("2 dias e 0h") nem minuto pendurado numa contagem em dias. */
function formatarDuracao(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return "—";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 1) return "menos de um minuto";
  const horas = Math.floor(minutos / 60);
  const restoMin = minutos % 60;
  if (horas < 1) return minutos + (minutos === 1 ? " minuto" : " minutos");
  const dias = Math.floor(horas / 24);
  const restoHoras = horas % 24;
  if (dias < 1) return horas + (horas === 1 ? " hora" : " horas") + (restoMin ? " e " + restoMin + " min" : "");
  return dias + (dias === 1 ? " dia" : " dias") + (restoHoras ? " e " + restoHoras + "h" : "");
}

/* "14/20" -> "14 / 20". Sem vida (servidor antigo, ou getComponent que
   falhou no mundo) devolve "—", igual ao resto do painel quando falta
   informação. */
function formatarVida(vida, vidaMax) {
  if (!Number.isFinite(vida) || !Number.isFinite(vidaMax) || vidaMax <= 0) return "—";
  return `${vida} / ${vidaMax}`;
}

/* Um único indicador de carga, não dois números que competem por atenção.
   Os limiares são os do enunciado: CPU acima de 70%, ou memória alta. */
const LIMIAR_CPU_ALTO = 70;
const LIMIAR_MEM_ALTO = 85;
function nivelDeCarga(cpuPct, memPct) {
  return (cpuPct > LIMIAR_CPU_ALTO || memPct > LIMIAR_MEM_ALTO) ? "alta" : "normal";
}

/* Atrasado com folga de 20% sobre o intervalo esperado: um backup diário
   que sai às 5h05 em vez de 5h00 não é motivo de alarme. Sem backup
   nenhum ainda não é "atrasado" — é só um mundo novo. */
function statusBackup(ultimoTs, prazoHoras, agoraTs) {
  if (!ultimoTs) return { atrasado: false };
  const horasPassadas = (agoraTs - ultimoTs) / 3600;
  return { atrasado: horasPassadas > (prazoHoras || 24) * 1.2, horasPassadas };
}

/* O que cada linha do log É, para o filtro da aba Log. A ordem importa:
   uma linha de erro nunca deve cair em "comando" só por citar um marcador
   nosso dentro da mensagem. */
function classificarLinhaDeLog(linha) {
  if (/\[ERROR\]|Exception|TypeError|ReferenceError|Erro de script/i.test(linha)) return "erro";
  if (/EVT\|(entrou|saiu)\|/.test(linha) || /Player (Connected|Disconnected):/i.test(linha)) return "entrada_saida";
  if (/\b(FORJA|INVOCA|BOOM|TP|MUNDO|ADM)\|/.test(linha)) return "comando";
  return "outro";
}

/* Quem já passou pelo mundo, um por nome, com o evento mais recente dele
   (entrou ou saiu) — para a lista da aba Mundo. Eventos que não são
   entrada/saída (morreu, dormiu, conquista) não contam como "visita". */
function resumoVisitantes(eventos) {
  const porNome = new Map();
  for (const e of eventos || []) {
    if (e.tipo !== "entrou" && e.tipo !== "saiu") continue;
    const atual = porNome.get(e.nome);
    if (!atual || e.ts > atual.ts) porNome.set(e.nome, { nome: e.nome, tipo: e.tipo, ts: e.ts });
  }
  return [...porNome.values()].sort((a, b) => b.ts - a.ts);
}

/* O texto que Reiniciar/Desligar mostram antes do clique — e que a
   confirmação repete. */
function rotuloQuedaJogadores(nomes) {
  if (!nomes || !nomes.length) return "";
  return nomes.join(", ") + (nomes.length === 1 ? " vai cair" : " vão cair");
}

/* ═══════════════════════════════════════════════════════════════════
   O SERVIDOR — a tela

   Cinco abas, cada uma respondendo a uma pergunta só. A aba escolhida é
   lembrada entre visitas; cada uma carrega os dados dela na hora em que
   fica visível, não todas de uma vez ao abrir o tapume.
   ═══════════════════════════════════════════════════════════════════ */

const ABAS_SERVIDOR = [
  { id: "saude",   nome: "Saúde" },
  { id: "mundo",   nome: "Mundo" },
  { id: "pacotes", nome: "Pacotes" },
  { id: "backups", nome: "Backups" },
  { id: "log",     nome: "Log" },
];

function abrirServidor() {
  $("tapume-servidor").hidden = false;
  desenharAbasServidor();
  atualizarCabecaServidor();
  trocarAbaServidor(S.abaServidor);
}

function fecharServidor() {
  $("tapume-servidor").hidden = true;
  pararPollLog();
  if (MAPA_RENDER.poll) { clearInterval(MAPA_RENDER.poll); MAPA_RENDER.poll = null; }
}

function desenharAbasServidor() {
  const caixa = $("abas-servidor");
  if (!caixa) return;
  caixa.innerHTML = ABAS_SERVIDOR.map((a) =>
    `<button data-id="${a.id}" role="tab" aria-pressed="${String(a.id === S.abaServidor)}">${esc(a.nome)}</button>`
  ).join("");
  for (const b of caixa.children) {
    b.onclick = () => trocarAbaServidor(b.dataset.id);
  }
}

function trocarAbaServidor(id) {
  if (S.abaServidor !== id) SOM.tocar("tecla");
  S.abaServidor = id;
  localStorage.setItem("aether.abaServidor", id);
  desenharAbasServidor();

  for (const painel of document.querySelectorAll(".painel-aba")) {
    painel.hidden = painel.dataset.aba !== id;
  }
  if (id !== "log") pararPollLog();

  carregarAbaAtiva();
}

function pararPollLog() {
  if (_pollLog) { clearInterval(_pollLog); _pollLog = null; }
}

function carregarAbaAtiva() {
  if ($("tapume-servidor").hidden) return;
  if (S.abaServidor === "saude") {
    desenharSaude();
    atualizarMapaStatus().then(desenharSaude);
  } else if (S.abaServidor === "mundo") {
    desenharRegras();
    desenharProgressoMapa();
    atualizarMapaStatus().then((st) => { desenharProgressoMapa(st); if (st && st.rodando) acompanharRenderMapa(); });
    carregarVisitantes();
  } else if (S.abaServidor === "pacotes") {
    carregarAddons();
  } else if (S.abaServidor === "backups") {
    desenharBackups();
  } else if (S.abaServidor === "log") {
    carregarLog();
  }
}

/* O selo e a versão ficam na cabeça do tapume, visíveis não importa qual
   aba está aberta — não fazem parte de nenhuma delas. */
function atualizarCabecaServidor() {
  const s = S.status;
  if (!s) return;
  const selo = $("selo-servidor");
  const rodando = s.servidor && s.servidor.status === "running";
  const saudavel = s.servidor && s.servidor.saude === "healthy";
  selo.className = "selo chanfro-p " + (rodando && saudavel ? "verde" : rodando ? "tocha" : "vermelho");
  selo.querySelector(".pulso").className = "pulso " + (rodando && saudavel ? "" : rodando ? "morno" : "parado");
  selo.querySelector(".mono").textContent =
    !rodando ? "Desligado" : saudavel ? "No ar e saudável" : "No ar, ainda conferindo";

  const v = (s.jogadores || {}).versao;
  $("rodape-versao").textContent = v ? "Bedrock " + v : "Versão do servidor ainda não respondeu";
}

/* ── Saúde ──
   A primeira linha é saúde, não telemetria: no ar, backup, mapa, carga.
   CPU e memória de verdade ficam menores, embaixo. Ligar é neutro;
   Reiniciar e Desligar levam a consequência escrita no próprio botão. */
function desenharSaude() {
  const s = S.status;
  const alvo = $("aba-saude");
  if (!s || !alvo) return;

  const rodando = s.servidor && s.servidor.status === "running";
  const rec = s.recursos || {};
  const cpu = parseFloat(String(rec.cpu || "").replace("%", "")) || 0;
  const memPct = parseFloat(String(rec.mem_pct || "").replace("%", "")) || 0;
  const carga = nivelDeCarga(cpu, memPct);

  const noAr = rodando && s.servidor.desde && Number.isFinite(Date.parse(s.servidor.desde))
    ? formatarDuracao((Date.now() - Date.parse(s.servidor.desde)) / 1000)
    : "Desligado";

  const backups = s.backups || [];
  const ultimo = backups[0];
  const prazo = s.backup_prazo_horas || 24;
  const st = ultimo ? statusBackup(ultimo.ts, prazo, Date.now() / 1000) : { atrasado: false };
  const textoBackup = ultimo ? quandoFoi(ultimo.ts) : "Nenhum ainda";

  const ms = S.mapaStatus;
  const textoMapa = ms && ms.pronto_ts ? quandoFoi(ms.pronto_ts)
    : ms && ms.rodando ? "Redesenhando agora"
    : "Ainda não sei";

  const jog = s.jogadores || {};
  const nomesOnline = S.jogadores.map((j) => j.nome);
  const queda = rotuloQuedaJogadores(nomesOnline);
  const quedaHtml = queda ? `<span class="btn-consequencia"> · ${esc(queda)}</span>` : "";

  alvo.innerHTML = `
    <div class="saude-grade">
      <div class="saude-cartao">
        <div class="saude-valor">${esc(noAr)}</div>
        <div class="rot">No ar</div>
      </div>
      <div class="saude-cartao${st.atrasado ? " saude-cartao--alerta" : ""}">
        <div class="saude-valor">${esc(textoBackup)}</div>
        <div class="rot">Último backup${st.atrasado ? " · atrasado" : ""}</div>
      </div>
      <div class="saude-cartao">
        <div class="saude-valor">${esc(textoMapa)}</div>
        <div class="rot">Mapa redesenhado</div>
      </div>
      <div class="saude-cartao${carga === "alta" ? " saude-cartao--alerta" : ""}">
        <div class="saude-valor">${carga === "alta" ? "Alta" : "Normal"}</div>
        <div class="rot">Carga do servidor</div>
      </div>
    </div>
    <div class="saude-miudo">
      <span>Processador <b>${esc(rec.cpu || "—")}</b></span>
      <span>Memória <b>${esc((rec.mem || "—").split(" / ")[0])}</b></span>
      <span>Jogadores <b>${jog.responde ? esc(jog.online + "/" + jog.max) : "—"}</b></span>
    </div>
    <div class="linha-botoes">
      <button class="btn chanfro-p flex1" onclick="energia('start')"${rodando ? " disabled" : ""}>Ligar</button>
    </div>
    <div class="linha-botoes">
      <button class="btn perigo chanfro-p flex1" onclick="energia('restart')"${rodando ? "" : " disabled"}>Reiniciar${quedaHtml}</button>
      <button class="btn perigo chanfro-p flex1" onclick="energia('stop')"${rodando ? "" : " disabled"}>Desligar${quedaHtml}</button>
    </div>`;
}

/* ── Mundo ── */
async function carregarVisitantes() {
  const alvo = $("lista-visitantes");
  if (!alvo) return;
  try {
    const r = await api("/api/eventos?horas=168");
    const visitantes = resumoVisitantes(r.eventos || []);
    alvo.innerHTML = visitantes.length ? visitantes.map((v) => `
      <button class="item-lista chanfro-p visitante" data-nome="${esc(v.nome)}">
        <span class="visitante-corpo">
          <span class="disp visitante-nome">${esc(v.nome)}</span>
          <span class="mono visitante-quando">${v.tipo === "entrou" ? "entrou" : "saiu"} ${esc(quandoFoi(v.ts))}</span>
        </span>
      </button>`).join("") : `<div class="vazio">Ninguém passou pelo mundo nos últimos 7 dias.</div>`;
    for (const el of alvo.querySelectorAll(".visitante")) {
      el.onclick = () => {
        definirAlvo(el.dataset.nome);
        $("entrada").value = el.dataset.nome + " ";
        fecharServidor();
        $("entrada").focus();
        atualizarSugestoes();
      };
    }
  } catch (e) {
    alvo.innerHTML = `<div class="vazio">Não consegui ler quem passou pelo mundo.</div>`;
  }
}

async function atualizarMapaStatus() {
  try { S.mapaStatus = await api("/api/mapa/status"); }
  catch (e) { /* mantém o que já tinha */ }
  return S.mapaStatus;
}

function desenharProgressoMapa(status) {
  const caixa = $("progresso-mapa");
  const idade = $("mapa-idade");
  if (!caixa || !idade) return;
  const st = status || S.mapaStatus;
  idade.textContent = st && st.pronto_ts ? "Redesenhado " + quandoFoi(st.pronto_ts)
    : st && st.rodando ? "Redesenhando agora"
    : "—";
  const camadas = (st && st.camadas) || [];
  caixa.innerHTML = camadas.map((c) => `<span class="selo chanfro-p verde">${esc(c.rotulo || c.id)}</span>`).join("");
}

const MAPA_RENDER = { poll: null };

async function iniciarRenderMapa(botao) {
  botao.disabled = true;
  contar({ tom: "morno", titulo: "Redesenhando o mapa…",
           detalhe: "leva alguns minutos — as camadas aparecem aqui conforme saem" });
  try {
    const r = await api("/api/mapa/render", {});
    if (r.saida === "ja_rodando") {
      contar({ tom: "seco", titulo: "Já tem um render em andamento", detalhe: "aguarde terminar" });
    }
    acompanharRenderMapa();
  } catch (e) {
    contar({ tom: "ruim", titulo: "Não consegui iniciar o render", detalhe: mensagemDeFalha(e.message), cru: e.message });
    botao.disabled = false;
  }
}

function acompanharRenderMapa() {
  if (MAPA_RENDER.poll) return;
  MAPA_RENDER.poll = setInterval(async () => {
    const st = await atualizarMapaStatus();
    desenharProgressoMapa(st);
    if (!st || !st.rodando) {
      clearInterval(MAPA_RENDER.poll);
      MAPA_RENDER.poll = null;
      const botao = $("botao-render-mapa");
      if (botao) botao.disabled = false;
      if (st && st.pronto_ts) {
        contar({ tom: "bom", titulo: "Mapa redesenhado",
                 detalhe: (st.camadas || []).map((c) => c.rotulo || c.id).join(", ") });
        descobrirCamadas();
      }
      if (S.abaServidor === "saude") desenharSaude();
    }
  }, 3000);
}

/* ── Pacotes ── */
async function carregarAddons() {
  try {
    const inst = await api("/api/addons/instalados");
    const lista = (inst.addons || []);
    $("conta-addons").textContent = lista.length + " pacotes ligados";
    $("lista-addons").innerHTML = lista.length ? lista.map((a) => `
      <div class="item-lista chanfro-p">
        <span class="addon-icone chanfro-p ${a.tipo === "BP" ? "addon-icone--bp" : "addon-icone--rp"}"></span>
        <div class="texto-corpo">
          <div class="disp texto-titulo texto-titulo--corta">${esc(a.nome)}</div>
          <div class="mono texto-detalhe">${a.tipo === "BP" ? "Comportamento" : "Recurso"} · ${esc(a.versao)}</div>
        </div>
        <button class="btn perigo chanfro-p botao-lista-acao a-rem" data-uuid="${esc(a.uuid)}" data-nome="${esc(a.nome)}">Tirar</button>
      </div>`).join("") : `<div class="vazio">Nenhum pacote ligado neste mundo.</div>`;
    document.querySelectorAll(".a-rem").forEach((el) => el.onclick = () => removerAddon(el.dataset.uuid, el.dataset.nome));
  } catch (e) {
    $("lista-addons").innerHTML = `<div class="vazio">Não consegui ler os pacotes: ${esc(mensagemDeFalha(e.message))}</div>`;
  }

  try {
    const disp = await api("/api/addons/disponiveis");
    const lista = (disp.addons || []);
    $("lista-disponiveis").innerHTML = lista.length ? lista.map((a) => `
      <div class="item-lista chanfro-p">
        <div class="texto-corpo">
          <div class="disp texto-titulo texto-titulo--corta">${esc(a.nome)}</div>
          <div class="mono texto-detalhe">${a.tamanho_mb.toFixed(1)} MB · ${esc(a.arquivo)}</div>
        </div>
        <button class="btn verde chanfro-p botao-lista-acao a-inst" data-arq="${esc(a.arquivo)}" data-nome="${esc(a.nome)}">Instalar</button>
      </div>`).join("") : `<div class="vazio">Nada novo na pasta de addons.</div>`;
    document.querySelectorAll(".a-inst").forEach((el) => el.onclick = () => instalarAddon(el.dataset.arq, el.dataset.nome));
  } catch (e) {
    $("lista-disponiveis").innerHTML = `<div class="vazio">Não consegui ler a pasta: ${esc(mensagemDeFalha(e.message))}</div>`;
  }
}

/* ── Backups ── */
function desenharBackups() {
  const s = S.status;
  if (!s) return;
  const backups = s.backups || [];
  const prazo = s.backup_prazo_horas || 24;
  const st = backups[0] ? statusBackup(backups[0].ts, prazo, Date.now() / 1000) : { atrasado: false };

  $("conta-backups").textContent = backups.length ? `Guarda os ${backups.length} últimos` : "Nenhum ainda";
  const aviso = $("aviso-backup-atrasado");
  if (aviso) aviso.hidden = !st.atrasado;

  $("lista-backups").innerHTML = backups.length ? backups.map((b, i) => `
    <div class="item-lista chanfro-p${i === 0 ? " item-lista--recente" : ""}" title="${esc(b.nome)}">
      <span class="fita-item${i === 0 ? " fita-item--recente" : ""}"></span>
      <div class="texto-corpo">
        <div class="disp texto-titulo">${esc(b.quando)}</div>
        <div class="mono texto-detalhe">${b.mb} MB · ${esc(quandoFoi(b.ts))}</div>
      </div>
      <button class="btn chanfro-p botao-lista-acao b-rest" data-arq="${esc(b.nome)}">Restaurar</button>
    </div>`).join("") : `<div class="vazio">Nenhum backup guardado ainda.</div>`;

  document.querySelectorAll(".b-rest").forEach((el) => el.onclick = () => restaurar(el.dataset.arq));
}

/* ── Log ──
   Um trecho do log em memória (fluxo.py, ou "docker logs" de reserva),
   filtrado por tipo e por busca, atualizando sozinho enquanto a aba
   estiver aberta. */
const FILTROS_LOG = [
  { id: "tudo", nome: "Tudo" },
  { id: "erro", nome: "Erro de script" },
  { id: "entrada_saida", nome: "Entrada/saída" },
  { id: "comando", nome: "Comando" },
];

let _logBruto = [];
let _pollLog = null;

function desenharFiltroLog() {
  const caixa = $("filtro-log");
  if (!caixa) return;
  caixa.innerHTML = FILTROS_LOG.map((f) =>
    `<button data-id="${f.id}" aria-pressed="${String(f.id === S.filtroLog)}">${esc(f.nome)}</button>`).join("");
  for (const b of caixa.children) {
    b.onclick = () => { S.filtroLog = b.dataset.id; desenharFiltroLog(); SOM.tocar("tecla"); renderizarLog(); };
  }
}

async function carregarLog() {
  desenharFiltroLog();
  const busca = $("busca-log");
  if (busca && !busca.dataset.ligado) {
    busca.dataset.ligado = "1";
    busca.oninput = () => renderizarLog();
  }
  await puxarLog();
  pararPollLog();
  _pollLog = setInterval(puxarLog, 4000);
}

async function puxarLog() {
  if ($("tapume-servidor").hidden || S.abaServidor !== "log") { pararPollLog(); return; }
  try {
    const r = await api("/api/logs?n=400");
    _logBruto = (r.texto || "").split("\n").filter((l) => l.trim());
    renderizarLog();
  } catch (e) {
    $("lista-log").innerHTML = `<div class="vazio">Não consegui ler o log.</div>`;
  }
}

function renderizarLog() {
  const caixa = $("lista-log");
  if (!caixa) return;
  let linhas = _logBruto;
  if (S.filtroLog !== "tudo") linhas = linhas.filter((l) => classificarLinhaDeLog(l) === S.filtroLog);
  const busca = ($("busca-log") ? $("busca-log").value : "").trim().toLowerCase();
  if (busca) linhas = linhas.filter((l) => l.toLowerCase().includes(busca));
  const ultimas = linhas.slice(-200);
  caixa.innerHTML = ultimas.length
    ? ultimas.map((l) => `<div class="log-linha log-linha--${classificarLinhaDeLog(l)}">${esc(l)}</div>`).join("")
    : `<div class="vazio">Nada por aqui com esse filtro.</div>`;
  caixa.scrollTop = caixa.scrollHeight;
}

/* ── As ações que mexem no mundo ──
   Ligar, reiniciar, desligar, backup, restaurar, instalar e remover addon
   têm consequência real — a resposta delas vira registro na fita (contar),
   não um brinde que some em quatro segundos. */
async function energia(acao) {
  const rotulos = { start: "ligar", stop: "desligar", restart: "reiniciar" };
  const nomes = S.jogadores.map((j) => j.nome);
  if (acao !== "start") {
    const quem = nomes.length ? "Quem cai: " + nomes.join(", ") + ".\n\n" : "Ninguém está jogando agora.\n\n";
    if (!confirm(
      `Vai ${rotulos[acao]} o servidor. ${quem}` +
      `O mundo é salvo antes — o desligamento espera até 2 minutos por isso.\n\nPode ir?`
    )) return;
  }
  contar({ tom: "morno", titulo: "Mandando " + rotulos[acao] + "…",
           detalhe: nomes.length ? esc(rotuloQuedaJogadores(nomes)) : "" });
  try {
    const r = await api("/api/power", { acao, alvo: "mc-bedrock" });
    contar({ tom: r.ok ? "bom" : "ruim",
             titulo: r.ok ? "Pronto: " + rotulos[acao] : "Não deu certo",
             detalhe: r.ok ? "" : mensagemDeFalha(r.saida), cru: r.saida || "" });
    setTimeout(puxarStatus, 3000);
  } catch (e) {
    contar({ tom: "ruim", titulo: "Falhou ao " + rotulos[acao], detalhe: mensagemDeFalha(e.message), cru: e.message });
  }
}

async function salvarAgora(botao) {
  botao.disabled = true;
  const antes = botao.textContent;
  botao.textContent = "Salvando…";
  contar({ tom: "morno", titulo: "Guardando o mundo…", detalhe: "isso leva alguns segundos e ninguém é interrompido" });
  try {
    const r = await api("/api/backup", {});
    contar({ tom: r.ok ? "bom" : "ruim", titulo: r.ok ? "Backup guardado" : "O backup falhou" });
    await puxarStatus();
    if (S.abaServidor === "backups") desenharBackups();
  } catch (e) {
    contar({ tom: "ruim", titulo: "Falhou ao guardar", detalhe: mensagemDeFalha(e.message), cru: e.message });
  } finally { botao.disabled = false; botao.textContent = antes; }
}

async function restaurar(arquivo) {
  const nomeMundo = prompt(
    "Restaurar apaga o mundo de agora e põe o backup no lugar.\n\n" +
    "Um backup do estado atual é feito antes, e o servidor reinicia.\n\n" +
    "Para confirmar, digite o nome do mundo (o level-name do servidor):");
  if (!nomeMundo) return;
  contar({ tom: "morno", titulo: "Restaurando " + arquivo + "…", detalhe: "o servidor vai parar e voltar — pode demorar" });
  try {
    const r = await api("/api/mundos/restaurar", {
      arquivo, container: "mc-bedrock", confirmacao: nomeMundo.trim(),
    });
    contar({ tom: r.ok ? "bom" : "ruim", titulo: r.ok ? "Mundo restaurado" : "Não restaurou",
             detalhe: r.ok ? "" : mensagemDeFalha(r.erro || r.saida), cru: r.erro || r.saida || "" });
  } catch (e) {
    contar({ tom: "ruim", titulo: "Falhou ao restaurar", detalhe: mensagemDeFalha(e.message), cru: e.message });
  }
}

async function instalarAddon(arquivo, nome) {
  if (!confirm(`Instalar “${nome}” e reiniciar o servidor?\n\nQuem estiver jogando cai por um minuto.`)) return;
  contar({ tom: "morno", titulo: "Instalando " + esc(nome) + "…" });
  try {
    const r = await api("/api/addons/instalar", { arquivo, container: "mc-bedrock" });
    contar({ tom: r.ok ? "bom" : "ruim", titulo: r.ok ? esc(nome) + " instalado" : "Não instalou " + esc(nome),
             detalhe: r.ok ? "" : mensagemDeFalha(r.erro || r.saida), cru: r.erro || r.saida || "" });
    carregarAddons();
  } catch (e) {
    contar({ tom: "ruim", titulo: "Falhou ao instalar", detalhe: mensagemDeFalha(e.message), cru: e.message });
  }
}

async function removerAddon(uuid, nome) {
  if (!confirm(`Tirar “${nome}” do mundo e reiniciar?\n\nBlocos e bichos desse pacote somem do mundo.`)) return;
  contar({ tom: "morno", titulo: "Tirando " + esc(nome) + "…" });
  try {
    const r = await api("/api/addons/remover", { uuid, container: "mc-bedrock" });
    contar({ tom: r.ok ? "bom" : "ruim", titulo: r.ok ? esc(nome) + " removido" : "Não removeu " + esc(nome),
             detalhe: r.ok ? "" : mensagemDeFalha(r.erro || r.saida), cru: r.erro || r.saida || "" });
    carregarAddons();
  } catch (e) {
    contar({ tom: "ruim", titulo: "Falhou ao remover", detalhe: mensagemDeFalha(e.message), cru: e.message });
  }
}

/* ═══════════════════════════════════════════════════════════════════
   OS PULSOS — o que o painel vai buscar sozinho
   ═══════════════════════════════════════════════════════════════════ */

let mapaJaCarregou = false;

/* O topo fica só com o que se olha de relance: se está no ar, quantos, e
   que hora do dia está valendo lá dentro. CPU, memória e o relógio
   continuam em S.status inteiro — é o Servidor que os mostra agora — só
   saíram do lugar mais nobre da tela. */
function atualizarEstadoTopo() {
  const s = S.status;
  if (!s) return;
  const rodando = s.servidor && s.servidor.status === "running";
  const saudavel = s.servidor && s.servidor.saude === "healthy";
  const jog = s.jogadores || {};

  $("pulso").className = "pulso " + (rodando && saudavel ? "" : rodando ? "morno" : "parado");

  let texto = !rodando
    ? "Servidor desligado"
    : jog.responde ? `No ar · ${jog.online}/${jog.max}` : "No ar · subindo";
  if (rodando && MUNDO.lido && MUNDO.hora != null) texto += " · " + nomeDaHora(MUNDO.hora);
  $("estado-curto").textContent = texto;
  $("estado-curto").style.color = rodando ? "var(--grama-cl)" : "var(--redstone)";
}

async function puxarStatus() {
  try {
    const s = await api("/api/status");
    S.status = s;
    atualizarEstadoTopo();

    if (!mapaJaCarregou) { mapaJaCarregou = true; recarregarMapa(); }
    if (!$("tapume-servidor").hidden) {
      atualizarCabecaServidor();
      if (S.abaServidor === "saude") desenharSaude();
      else if (S.abaServidor === "backups") desenharBackups();
    }
  } catch (e) {
    $("estado-curto").textContent = "Painel sem resposta";
    $("estado-curto").style.color = "var(--redstone)";
    $("pulso").className = "pulso parado";
  }
}

async function puxarJogadores() {
  try {
    const [online, pos] = await Promise.all([api("/api/online"), api("/api/pos")]);
    S.jogadores = (online.nomes || []).map((n) => ({ nome: n }));
    S.posicoes = pos.posicoes || {};
    if (S.alvo !== "@a" && !S.jogadores.some((j) => j.nome === S.alvo)) definirAlvo("@a");
    desenharJogadores();
  } catch (e) { /* silencioso: o topo já mostra que o painel caiu */ }
}

const ROTULO_EVENTO = {
  entrou: "entrou no mundo", saiu: "saiu do mundo", morreu: "morreu",
  dormiu: "foi dormir", conquista: "conseguiu uma conquista",
};
const TOM_EVENTO = {
  entrou: "bom", saiu: "seco", morreu: "morno",
  dormiu: "seco", conquista: "bom",
};

function quandoFoi(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "agora há pouco";
  if (s < 3600) { const m = Math.floor(s / 60); return `há ${m} ${m === 1 ? "minuto" : "minutos"}`; }
  if (s < 86400) { const h = Math.floor(s / 3600); return `há ${h} ${h === 1 ? "hora" : "horas"}`; }
  const d = Math.floor(s / 86400);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/* O que o servidor viu (mortes, entradas) chega por sondagem; o que este
   painel fez chega na hora. As duas fontes moram na mesma fita, em ordem
   de tempo - é uma coisa só do ponto de vista de quem olha. */
let _eventosDoServidor = [];
let _falhouAFita = false;

/* ── O filtro da fita ──
   Tudo · Meus · Mundo. O mesmo segmentado do clima e da hora, só que
   decidindo o que passa pela fita em vez de mandar comando. O rótulo é
   curto para caber na coluna direita; o nome por extenso mora no title. */
const FILTROS_FITA = [
  { id: "tudo", nome: "Tudo", titulo: "Tudo" },
  { id: "meu", nome: "Meus", titulo: "Meus comandos" },
  { id: "mundo", nome: "Mundo", titulo: "O mundo" },
];

function desenharFiltroFita() {
  const caixa = $("filtro-fita");
  if (!caixa) return;
  if (!caixa.children.length) {
    caixa.innerHTML = FILTROS_FITA.map((f) =>
      `<button data-id="${f.id}" title="${esc(f.titulo)}" aria-pressed="${String(f.id === S.filtroFita)}">${esc(f.nome)}</button>`).join("");
    for (const b of caixa.children) {
      b.onclick = () => {
        S.filtroFita = b.dataset.id;
        desenharFiltroFita();
        SOM.tocar("tecla");
        desenharFita();
      };
    }
    return;
  }
  for (const b of caixa.children) b.setAttribute("aria-pressed", String(b.dataset.id === S.filtroFita));
}

async function puxarEventos() {
  try {
    const r = await api("/api/eventos?horas=24");
    _eventosDoServidor = (r.eventos || []).slice(-30).map((e) => ({
      ts: e.ts,
      tom: TOM_EVENTO[e.tipo] || "seco",
      titulo: "<b>" + esc(e.nome) + "</b> " + esc(ROTULO_EVENTO[e.tipo] || e.tipo),
      detalhe: "",
      cru: "",
      local: false,
    }));
    _falhouAFita = false;
  } catch (e) {
    _falhouAFita = true;
  }
  desenharFita();
}

/* Textos vazios variam com o filtro: cada um diz o próximo passo daquele
   recorte, em vez de repetir uma frase genérica fora de contexto. */
const VAZIO_FITA = {
  tudo:  "Nada aconteceu ainda. Mande um comando.",
  meu:   "Você ainda não mandou nada. Escreva um comando na barra.",
  mundo: "O mundo não fez nada ainda — ninguém entrou, morreu ou dormiu.",
};

function desenharFita() {
  const caixa = $("lista-eventos");
  if (!caixa) return;

  let tudo = S.acontecimentos.concat(_eventosDoServidor);
  if (S.filtroFita === "meu") tudo = tudo.filter((a) => a.local);
  else if (S.filtroFita === "mundo") tudo = tudo.filter((a) => !a.local);
  tudo = tudo.sort((a, b) => b.ts - a.ts).slice(0, 40);

  if (!tudo.length) {
    caixa.innerHTML = _falhouAFita
      ? '<div class="vazio">Não consegui ler os acontecimentos.</div>'
      : `<div class="vazio">${VAZIO_FITA[S.filtroFita] || VAZIO_FITA.tudo}</div>`;
    desenharFitaMinima();
    return;
  }

  caixa.innerHTML = tudo.map((a, i) => {
    const tinta = TINTAS[a.tom] || TINTAS.seco;
    // Ícone de AÇÃO para o que o painel fez (cheque, aviso, x); ícone de
    // EVENTO, sempre o mesmo desenho, para o que o mundo fez sozinho — o
    // nome do jogador já vem em destaque dentro do próprio título.
    const glifo = a.local ? (GLIFOS[a.tom] || GLIFOS.seco) : GLIFO_EVENTO;
    return `
    <div class="acont ${a.tom}${a.cru ? " tem-cru" : ""}" data-i="${i}">
      <span class="icone"><svg viewBox="0 0 24 24" fill="none" stroke="${tinta}"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glifo}</svg></span>
      <div class="acont-corpo">
        <div class="titulo">${a.titulo}</div>
        <div class="detalhe">${a.detalhe ? a.detalhe + " · " : ""}<span class="quando">${
          a.local ? relogioCurto(a.ts) : quandoFoi(a.ts)}</span></div>
        ${a.cru ? `<div class="cru">${esc(a.cru)}</div>` : ""}
      </div>
    </div>`;
  }).join("");

  for (const el of caixa.querySelectorAll(".acont.tem-cru")) {
    el.onclick = () => { el.classList.toggle("aberto"); SOM.tocar("tecla"); };
  }
  desenharFitaMinima();
}

/* ── A fita mínima ──
   Um clone raso dos 3 primeiros .acont de #lista-eventos, mantido junto
   de toda vez que a fita de verdade é redesenhada — não tem lógica
   própria de filtro ou de tom, só copia o que já está na tela. Sempre
   preenchido (o custo é desprezível, 3 clones): quem decide se ela
   aparece é o CSS — modo de jogo ou coluna direita escondida por falta
   de espaço — não este script. Aqui só apagamos quando não há nada. */
function desenharFitaMinima() {
  const mini = $("fita-minima");
  if (!mini) return;
  const itens = [...$("lista-eventos").querySelectorAll(".acont")].slice(0, 3);
  mini.innerHTML = itens.map((el) => el.outerHTML).join("");
  mini.hidden = !itens.length;
}

/* ═══════════════════════════════════════════════════════════════════
   FOCO — MODO DE JOGO (tecla F)

   Some com tudo que não é mapa, comando ou os últimos acontecimentos —
   pensado para jogar com o Xbox do lado e o painel só de apoio. Esc
   continua sendo "fechar o que está por cima"; sair do modo de jogo é
   sempre a mesma tecla que ligou, F, nunca Esc.
   ═══════════════════════════════════════════════════════════════════ */
function alternarModoJogo() {
  const ligar = !document.body.classList.contains("modo-jogo");
  document.body.classList.toggle("modo-jogo", ligar);
  try { localStorage.setItem("aether.modoJogo", ligar ? "1" : "0"); } catch (e) { /* aba privada */ }

  const botao = $("botao-modo-jogo");
  if (botao) botao.setAttribute("aria-pressed", String(ligar));

  desenharFitaMinima();
  brinde(ligar ? "Modo de jogo ligado" : "Modo de jogo desligado");
}

/* ═══════════════════════════════════════════════════════════════════
   TECLADO
   ═══════════════════════════════════════════════════════════════════ */

document.addEventListener("click", (ev) => {
  const menu = $("menu-mapa");
  if (!menu.hidden && !menu.contains(ev.target)) fecharMenuDoMapa();

  const pop = $("pop-vezes");
  if (pop && !pop.hidden && !pop.contains(ev.target) && !ev.target.closest("#botao-vezes")) {
    fecharVezes();
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { fecharVezes(); fecharMenuDoMapa(); }

  // Com o menu do mapa aberto, a inicial escolhe a ação — a mesma letra
  // que aparece do lado direito de cada linha.
  if (!$("menu-mapa").hidden && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    const acao = ACOES_DO_MAPA.find((a) => a.tecla.toLowerCase() === ev.key.toLowerCase());
    if (acao) { ev.preventDefault(); escolherNoMapa(acao.id); return; }
  }

  const emCampo = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);

  if (ev.key === "Escape") {
    if (!$("sugestoes").hidden && document.activeElement === $("entrada")) {
      $("sugestoes").hidden = true;
      S.sugestoes = [];
      return;
    }
    if (!$("tapume-servidor").hidden) return fecharServidor();
    if (!$("ficha").hidden) return fecharFicha();
    $("entrada").blur();
    return;
  }

  if (!emCampo) {
    if (ev.key === "/") { ev.preventDefault(); $("entrada").focus(); return; }
    // F alterna o modo de jogo — nunca com Ctrl/Cmd/Alt, para não brigar
    // com o "localizar na página" do navegador.
    if (ev.key.toLowerCase() === "f" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault(); alternarModoJogo(); return;
    }
  }

  if (document.activeElement !== $("entrada")) return;

  const quantas = S.sugestoes.length;

  if (ev.key === "Enter") { ev.preventDefault(); mandarLinha(); }
  else if (ev.key === "Tab" && quantas) { ev.preventDefault(); aplicarSugestao(S.sugestaoAtiva); }
  else if (ev.key === "ArrowDown" && quantas) { ev.preventDefault(); moverSelecao(1); }
  else if (ev.key === "PageDown" && quantas) { ev.preventDefault(); moverSelecao(10); }
  else if (ev.key === "PageUp" && quantas) { ev.preventDefault(); moverSelecao(-10); }
  else if (ev.key === "Home" && quantas && !ev.shiftKey) {
    ev.preventDefault(); S.sugestaoAtiva = 0; acenderSelecionada();
  } else if (ev.key === "End" && quantas && !ev.shiftKey) {
    ev.preventDefault(); S.sugestaoAtiva = quantas - 1; acenderSelecionada();
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    // Com a lista aberta, a seta anda nela; com ela fechada, traz o
    // comando anterior — que é o que a seta faz num terminal.
    if (quantas > 1) moverSelecao(-1);
    else if (S.historico.length) { $("entrada").value = S.historico[0]; atualizarSugestoes(); }
  }
});

$("entrada").addEventListener("input", () => { S.sugestaoAtiva = 0; atualizarSugestoes(); });
$("mapa").addEventListener("error", () => {
  $("mapa").style.display = "none";
  $("mapa-ausente").style.display = "flex";
});
[...document.querySelectorAll(".tapume")].forEach((t) => {
  t.addEventListener("click", (ev) => { if (ev.target === t) t.hidden = true; });
});

/* Title/tooltip para quem não sabe de cor o vocabulário da mesa — o
   glossário mora em GLOSSARIO, isto só espalha as frases pelos rótulos
   que mais se beneficiam de uma explicação de uma linha. */
function aplicarGlossario() {
  const alvos = {
    "lista-jogadores": GLOSSARIO.jogador,
    "lista-eventos": GLOSSARIO.fita,
    clima: GLOSSARIO.clima,
    horas: GLOSSARIO.hora,
    "camadas-mapa": GLOSSARIO.camada,
    "regras-mundo": GLOSSARIO.regra,
    "lista-addons": GLOSSARIO.pacote,
  };
  for (const id of Object.keys(alvos)) {
    const el = $(id);
    if (el && !el.title) el.title = alvos[id];
  }
}

/* ═══════════════════════════════════════════════════════════════════
   COMEÇO
   ═══════════════════════════════════════════════════════════════════ */

carregarCatalogo();
desenharAtalhos();
desenharHistorico();
definirVezes(S.vezes);
desenharMudo();
desenharFiltroFita();
desenharFita();
$("botao-mudo").addEventListener("click", () => SOM.trocarMudo());
desenharJogadores();
aplicarGlossario();
// A classe já pode ter vindo do script inline no <body> (localStorage lido
// antes da coreografia de abertura) — aqui é só o botão alcançar o estado.
$("botao-modo-jogo").setAttribute("aria-pressed", String(document.body.classList.contains("modo-jogo")));

puxarStatus();
puxarJogadores();
puxarEventos();
setInterval(puxarStatus, 6000);
setInterval(puxarJogadores, 8000);
setInterval(puxarEventos, 30000);
puxarMundo();
setInterval(puxarMundo, 20000);
desenharFerramentasDoMapa();
