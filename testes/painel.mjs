/* ═══════════════════════════════════════════════════════════════════
   CARREGAR O PAINEL FORA DO NAVEGADOR

   O painel é HTML, CSS e JavaScript em três arquivos separados. Para
   testar a lógica sem subir servidor nem abrir navegador, este módulo
   recorta o script, monta um pedaço de tela de mentira que aceita
   qualquer coisa, e devolve as peças que os testes examinam.

   O recorte para antes da seção "COMEÇO": dali para baixo o script sai
   chamando o servidor e desenhando, e nada disso interessa aqui.
   ═══════════════════════════════════════════════════════════════════ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PAINEL = join(AQUI, "..", "docker", "painel", "painel.js");

/* As peças que os testes pedem emprestado ao painel. Tudo que estiver
   aqui precisa existir no script, senão o carregamento estoura na hora —
   que é o comportamento certo: um teste que não acha o que testa falhou. */
const PECAS = [
  "CAT", "S", "PODERES",
  "ondeEstou", "filtrar", "traduzir",
  "traduzirForja", "traduzirInvocacao", "traduzirTp", "traduzirBoom",
  "acharLinha", "dizerPorque", "listarExtras", "cortarNoMeio",
  "pedidoDaPrevia", "linhasDePoderes", "nomeDoItem", "nomeBonitoDeItem", "nomeBonitoDeMob",
  "formatarDuracao", "formatarVida", "nivelDeCarga", "statusBackup",
  "classificarLinhaDeLog", "resumoVisitantes", "rotuloQuedaJogadores",
];

function recortarLogica(js) {
  const corte = js.indexOf("COMEÇO");
  if (corte < 0) throw new Error("não achei a seção 'COMEÇO' no painel");

  const ateAli = js.slice(0, corte);
  const semOComentarioPartido = ateAli.slice(0, ateAli.lastIndexOf("/*"));

  // "const" não vira propriedade do contexto do vm, então pedimos ao
  // próprio script para nos entregar o que precisamos.
  const entrega = `
globalThis.__pecas = { ${PECAS.join(", ")} };
`;
  return semOComentarioPartido + entrega;
}

/* Um pedaço de tela que aceita tudo e não devolve nada de verdade. O
   painel mexe bastante no DOM só de carregar; o Proxy engole isso. */
function mundoDeMentira() {
  const elemento = () => new Proxy(function () {}, {
    get: (_, chave) => {
      if (chave === "style" || chave === "classList" || chave === "dataset") return elemento();
      if (chave === "value" || chave === "textContent" || chave === "innerHTML") return "";
      if (chave === "children" || chave === "childNodes") return [];
      if (chave === "hidden") return true;
      if (chave === Symbol.toPrimitive) return () => "";
      return elemento();
    },
    set: () => true,
    apply: () => elemento(),
  });

  const guardado = {};
  const contexto = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    localStorage: {
      getItem: (c) => (c in guardado ? guardado[c] : null),
      setItem: (c, v) => { guardado[c] = String(v); },
      removeItem: (c) => { delete guardado[c]; },
    },
    document: {
      getElementById: () => elemento(),
      querySelector: () => elemento(),
      querySelectorAll: () => [],
      createElement: () => elemento(),
      createDocumentFragment: () => elemento(),
      addEventListener: () => {},
      body: elemento(),
      activeElement: { tagName: "BODY" },
    },
    location: { protocol: "http:", hostname: "localhost", href: "http://localhost:8080/" },
    navigator: { clipboard: { writeText: async () => {} } },
    AudioContext: function () { return { state: "suspended", currentTime: 0, resume: () => Promise.resolve() }; },
  };
  contexto.window = contexto;
  contexto.window.addEventListener = () => {};
  contexto.window.innerWidth = 1600;
  contexto.window.innerHeight = 900;
  contexto.globalThis = contexto;
  return contexto;
}

/* Catálogo pequeno de propósito: os testes são sobre o caminho pela
   frase e sobre a tradução, não sobre quantos mobs o servidor tem. */
export const CATALOGO_FALSO = {
  mobs: ["zombie", "zombie_horse", "zombie_pigman", "creeper", "cow", "ender_dragon"],
  itens: ["bow", "arrow", "stick", "netherite_sword", "diamond_helmet", "apple", "egg"],
  encantamentos: { sharpness: 5, unbreaking: 3, multishot: 1, infinity: 1, power: 5 },
  efeitos: ["speed", "strength", "levitation", "regeneration"],
};

export function carregarPainel() {
  const contexto = vm.createContext(mundoDeMentira());
  vm.runInContext(recortarLogica(readFileSync(PAINEL, "utf8")), contexto, { filename: "painel" });

  const pecas = contexto.__pecas;
  for (const nome of PECAS) {
    if (pecas[nome] === undefined) throw new Error("o painel não tem mais '" + nome + "'");
  }

  Object.assign(pecas.CAT, CATALOGO_FALSO, { pronto: true });
  pecas.S.jogadores = [{ nome: "LentDust064", x: 0, y: 64, z: 0, vivo: true }];
  return pecas;
}

/* ── Um contador de casos, para os dois arquivos de teste ── */
export function corrida(titulo) {
  const linhas = [];
  let passaram = 0, falharam = 0;
  let largura = 0;

  return {
    caso(rotulo, veio, conferir) {
      const problema = conferir(veio);
      if (problema) { falharam++; linhas.push(["✗", rotulo, problema]); }
      else { passaram++; linhas.push(["✓", rotulo, veio]); }
      largura = Math.max(largura, rotulo.length);
    },
    fechar() {
      console.log("\n" + titulo);
      for (const [sinal, rotulo, texto] of linhas) {
        console.log(`  ${sinal}  ${rotulo.padEnd(largura)}  →  ${texto}`);
      }
      console.log(falharam
        ? `\n  ${passaram} passaram, ${falharam} falharam.`
        : `\n  Tudo certo: ${passaram} de ${passaram} casos passaram.`);
      return falharam;
    },
  };
}
