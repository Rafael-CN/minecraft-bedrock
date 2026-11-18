/* ═══════════════════════════════════════════════════════════════════
   TESTES DA PRÉVIA DO ITEM

   A bancada virou um cartão que aparece do lado da linha enquanto você
   escreve um "give ... with" — a única gramática que ganha prévia,
   porque é a única em que digitar não deixa ver o resultado antes de
   mandar. Estes casos cobrem o que o cartão precisa saber: quando
   aparece, o nome que mostra, e como lê encantamento, poder e efeito
   junto na mesma lista de poderes.

   Como rodar:   node testes/previa.mjs
   ═══════════════════════════════════════════════════════════════════ */

import { carregarPainel, corrida } from "./painel.mjs";

const P = carregarPainel();
const c = corrida("A prévia do item");

/* ── Quando aparece ── */
c.caso("give com with tem prévia",
  P.pedidoDaPrevia('give LentDust064 netherite_sword with sharpness 5') ? "apareceu" : "sumiu",
  (v) => (v === "apareceu" ? null : "devia aparecer"));

c.caso("give sem with não tem prévia",
  P.pedidoDaPrevia("give LentDust064 netherite_sword") ? "apareceu" : "sumiu",
  (v) => (v === "sumiu" ? null : "não devia aparecer sem with"));

c.caso("summon com with não é give — sem prévia",
  P.pedidoDaPrevia("summon zombie with full_diamond_armor") ? "apareceu" : "sumiu",
  (v) => (v === "sumiu" ? null : "prévia é só do give"));

c.caso("linha vazia não tem prévia",
  P.pedidoDaPrevia("") ? "apareceu" : "sumiu",
  (v) => (v === "sumiu" ? null : "linha vazia não tem o que mostrar"));

/* ── O que o pedido carrega — o caso do enunciado ── */
const LINHA = 'give LentDust064 netherite_sword with sharpness 5 knockback 4000 named "Fúria" lore "corta tudo"';
const pedido = P.pedidoDaPrevia(LINHA);
c.caso("nome custom vem do named", pedido && pedido.nome, (v) => (v === "Fúria" ? null : "veio " + v));
c.caso("item base", pedido && pedido.item, (v) => (v === "netherite_sword" ? null : "veio " + v));
c.caso("encantamento dentro do teto vira encante", JSON.stringify(pedido && pedido.encantes),
  (v) => (v === '{"sharpness":5}' ? null : "veio " + v));
c.caso("knockback sem teto no catálogo vira poder", JSON.stringify(pedido && pedido.poderes),
  (v) => (v === '{"knockback":4000}' ? null : "veio " + v));
c.caso("lore chega inteira", pedido && pedido.lore, (v) => (v === "corta tudo" ? null : "veio " + v));

/* ── nomeDoItem: o item sem underline, com maiúsculas — o que aparece
   quando não há "named" */
c.caso("nome bonito do item sem named", P.nomeDoItem("netherite_sword"),
  (v) => (v === "Netherite Sword" ? null : "veio " + v));

/* ── linhasDePoderes: cada poder com o valor, "nobreak" como frase, e o
   efeito de verdade (que também entra pelo "with") com nome em
   português e nível romano — a mesma lista que "poderes[]" alimenta na
   fita de acontecimentos. */
c.caso("poder com valor", P.linhasDePoderes({ knockback: 4000 }).join(" | "),
  (v) => (v === "Knockback 4000" ? null : "veio: " + v));

c.caso("nobreak vira 'sem quebrar bloco'", P.linhasDePoderes({ breakblocks: false }).join(" | "),
  (v) => (v === "Sem quebrar bloco" ? null : "veio: " + v));

c.caso("poder liga/desliga sem número", P.linhasDePoderes({ swap: true }).join(" | "),
  (v) => (v === "Swap" ? null : "veio: " + v));

c.caso("efeito de verdade ganha nome em português e nível romano",
  P.linhasDePoderes({ efeitos: [{ id: "speed", nivel: 2, segundos: 10 }] }).join(" | "),
  (v) => (v === "Velocidade II" ? null : "veio: " + v));

c.caso("sem poderes não desenha nada", P.linhasDePoderes({}).length,
  (v) => (v === 0 ? null : "veio " + v + " linhas"));

c.caso("poderes nulo não estoura", P.linhasDePoderes(null).length,
  (v) => (v === 0 ? null : "veio " + v + " linhas"));

process.exit(c.fechar() ? 1 : 0);
