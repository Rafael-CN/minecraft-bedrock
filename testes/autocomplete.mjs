/* ═══════════════════════════════════════════════════════════════════
   TESTES DO AUTOCOMPLETE

   Cada caso é um ponto onde a frase parou, e o que a lista tem que
   oferecer ali. O que motivou estes testes foi o autocomplete ficar
   preso nos mobs depois de "summon zombie ": uma chamada de filtro que
   passou a devolver {itens, total} continuou sendo usada como lista, o
   erro derrubava a função inteira, e a lista velha ficava congelada na
   tela — sem nada no console que dissesse isso.

   Como rodar:   node testes/autocomplete.mjs
   ═══════════════════════════════════════════════════════════════════ */

import { carregarPainel, corrida } from "./painel.mjs";

const P = carregarPainel();

/* Cada caso: onde a frase parou, e o que precisa estar sendo oferecido.
   A lista esperada não é a lista inteira — é o que não pode faltar. */
const CASOS = [
  { linha: "sum",                                   espera: ["summon"] },
  { linha: "summon ",                               espera: ["zombie", "creeper"] },
  { linha: "summon zom",                            espera: ["zombie", "zombie_horse"] },
  { linha: "summon zombie ",                        espera: ["at", "with", "named", "every"] },
  { linha: "summon zombie at ",                     espera: ["@a", "LentDust064"] },
  { linha: "summon zombie at LentDust064 ",         espera: ["with", "named", "every"] },
  { linha: "summon zombie at LentDust064 25 ",      espera: ["with", "named", "every"] },
  { linha: "summon zombie at LentDust064 25 with ", espera: ["full_diamond_armor"] },
  { linha: "give ",                                 espera: ["@a", "LentDust064"] },
  { linha: "give LentDust064 ",                     espera: ["bow", "stick"] },
  { linha: "give LentDust064 bow ",                 espera: ["with", "named"] },
  { linha: "give LentDust064 bow with ",            espera: ["sharpness", "explode", "knockback"] },
  { linha: "give LentDust064 bow with sharpness ",  espera: ["1", "5"] },
  // "multishot" existe nas duas gramáticas: encantamento com teto 1 e
  // poder sem teto. Oferecer só o "1" dava a impressão de que não dava
  // para pedir mais, que foi exatamente a reclamação.
  { linha: "give LentDust064 bow with multishot ",  espera: ["1", "12", "200"] },
  { linha: "give LentDust064 bow with explode ",    espera: [] },
  // Item 6 da revisão: a lacuna que a bancada cobria com três botões
  // ("na mão", "no inventário", "cai aos pés") agora é gramática da
  // linha. "in"/"on" aparecem junto das outras ligações do give, e cada
  // uma abre o destino certo.
  { linha: "give LentDust064 bow with power 5 ",    espera: ["in", "on"] },
  { linha: "give LentDust064 bow in ",              espera: ["hand", "inventory"] },
  { linha: "give LentDust064 bow on ",              espera: ["ground"] },
  { linha: "tp ",                                   espera: ["@a", "LentDust064"] },
  { linha: "tp LentDust064 ",                       espera: ["to"] },
  { linha: "boom ",                                 espera: ["at", "radius"] },
  { linha: "boom at ",                              espera: ["@a", "LentDust064"] },
];

const c = corrida("Autocomplete: por onde a frase passa");

for (const caso of CASOS) {
  let itens = null, estouro = null;
  try {
    const canto = P.ondeEstou(caso.linha);
    itens = ((canto && canto.itens) || []).map((i) => i.valor);
  } catch (erro) {
    estouro = erro.message;
  }

  const mostra = estouro ? "estourou: " + estouro
    : itens.length === 0 ? "(nada)"
    : itens.slice(0, 5).join(" ") + (itens.length > 5 ? " …+" + (itens.length - 5) : "");

  c.caso("'" + caso.linha + "'", mostra, () => {
    if (estouro) return "estourou com «" + estouro + "»";
    const faltando = caso.espera.filter((e) => !itens.includes(e));
    if (faltando.length) return "faltou " + faltando.join(", ") + " — veio: " + mostra;
    // Uma lista vazia só passa quando o caso pede lista vazia de propósito.
    if (caso.espera.length && !itens.length) return "não ofereceu nada";
    return null;
  });
}

/* O filtro casa por começo antes de casar por pedaço: digitar "nether"
   tem que achar netherite_sword na frente, não no fim de uma lista. */
const r = P.filtrar(["netherite_sword", "stone_sword", "nether_star", "bow"], "nether");
c.caso("filtro põe o começo na frente", r.itens.join(" "),
  (veio) => (veio.startsWith("nether_star netherite_sword") || veio.startsWith("netherite_sword nether_star")
    ? null : "ordem inesperada: " + veio));
c.caso("filtro conta o total", String(r.total),
  (veio) => (veio === "2" ? null : "contou " + veio + ", esperava 2"));

/* ── Onde o item aparece ──
   "in hand" (padrão), "in inventory", "on ground": o parâmetro que
   substitui os três botões da bancada removida. A linha tem que aceitar
   os três, e cair em "mao" quando ninguém disser nada. */
const ONDE = [
  { linha: "give LentDust064 bow in hand",                       espera: "mao" },
  { linha: "give LentDust064 bow with power 5 in inventory",     espera: "inv" },
  { linha: "give LentDust064 bow on ground",                     espera: "chao" },
  { linha: "give LentDust064 bow with sharpness 5",              espera: "mao" },
];

for (const caso of ONDE) {
  const traduzido = P.traduzir(caso.linha);
  const onde = traduzido && traduzido.pedido && traduzido.pedido.onde;
  c.caso("onde: '" + caso.linha + "'", String(onde), (veio) =>
    (veio === caso.espera ? null : "veio '" + veio + "', esperava '" + caso.espera + "'"));
}

process.exit(c.fechar() ? 1 : 0);
