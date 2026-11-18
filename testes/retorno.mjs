/* ═══════════════════════════════════════════════════════════════════
   TESTES DO RETORNO

   O script do mundo fala com o painel num formato só dele, separado por
   "|" e terminado num código de correlação. Esse formato nunca deve
   chegar aos olhos de quem usa o painel — foi exatamente isso que
   apareceu na tela do Rafael:

     [Scripting] FORJA|ok|LentDust064|egg|na mão|com=poderes[multishot=200]|#529668

   A causa era boba: os tradutores procuravam uma linha que COMEÇASSE com
   "FORJA|", e ela chega com "[Scripting] " na frente. Nunca casava, e o
   painel caía no plano B de mostrar a saída crua.

   Cada caso aqui usa uma linha crua de verdade e cobra duas coisas: que
   a frase diga o que aconteceu, e que nenhum pedaço do protocolo vaze.

   Como rodar:   node testes/retorno.mjs
   ═══════════════════════════════════════════════════════════════════ */

import { carregarPainel, corrida } from "./painel.mjs";

const P = carregarPainel();

/* O que nunca pode aparecer numa frase mostrada para o usuário. */
const VAZAMENTOS = [
  [/\[Scripting\]/, "o prefixo do servidor"],
  [/\|/, "uma barra do protocolo"],
  [/#[0-9a-f]{6}\b/, "o código de correlação"],
  [/\bpoderes\[/, "o pacote cru de poderes"],
  [/_/, "um nome de máquina com sublinhado"],
];

function semTags(html) {
  return String(html || "").replace(/<[^>]+>/g, "");
}

/* Confere uma nota traduzida: tom certo, palavras esperadas, nada de
   protocolo à mostra. */
function conferir({ tom, contem, semCru }) {
  return (nota) => {
    if (!nota || typeof nota !== "object") return "não devolveu uma nota";
    if (nota.tom !== tom) return `tom '${nota.tom}', esperava '${tom}'`;

    const frase = semTags(nota.titulo) + "  " + semTags(nota.detalhe);
    for (const palavra of contem) {
      if (!frase.includes(palavra)) return `faltou “${palavra}” em: ${frase.trim()}`;
    }
    for (const [padrao, oque] of VAZAMENTOS) {
      if (padrao.test(frase)) return `vazou ${oque}: ${frase.trim()}`;
    }
    // A linha crua tem que continuar existindo, só que escondida atrás
    // do clique — some do caminho sem sumir de vez. A exceção é quando o
    // servidor não mandou nada: aí não há crua para guardar.
    if (!semCru && !nota.cru) return "perdeu a linha crua (o clique não teria o que abrir)";
    return null;
  };
}

function mostrar(nota) {
  return "[" + nota.tom + "] " + semTags(nota.titulo) +
         (nota.detalhe ? " — " + semTags(nota.detalhe) : "");
}

const c = corrida("Retorno do mundo, traduzido");

function caso(rotulo, nota, esperado) {
  const problema = conferir(esperado)(nota);
  c.caso(rotulo, problema ? problema : mostrar(nota), () => problema);
}

/* ── Forja ────────────────────────────────────────────────────────── */
caso("forja simples",
  P.traduzirForja("[Scripting] FORJA|ok|LentDust064|egg|na mão|com=poderes[multishot=200]|#529668"),
  { tom: "bom", contem: ["LentDust064", "na mão", "egg", "multishot 200"] });

caso("forja com recusa parcial",
  P.traduzirForja("[Scripting] FORJA|ok|LentDust064|bow|no inventário|com=infinity:1,poderes[explode=5 teleporta=true]|o jogo recusou=sharpness:9|#abc123"),
  { tom: "morno", contem: ["bow", "Infinidade", "explode 5", "teleporta", "recusou"] });

caso("forja com item de nome composto",
  P.traduzirForja("[Scripting] FORJA|ok|LentDust064|netherite_sword ×3|na mão|com=poderes[knockback=4000]|#7f1"),
  { tom: "bom", contem: ["netherite sword", "knockback 4000"] });

caso("forja sem ninguém online",
  P.traduzirForja("[Scripting] FORJA|erro:ninguem_online_com_esse_nome|Zeca|#d1e2f3"),
  { tom: "ruim", contem: ["Ninguém com esse nome"] });

caso("forja cancelada por inteiro",
  P.traduzirForja("[Scripting] FORJA|cancelado|bow|recusados=sharpness:9,power:12|#aa11bb"),
  { tom: "ruim", contem: ["Nada foi entregue", "recusou"] });

caso("forja sem resposta nenhuma",
  P.traduzirForja(""),
  { tom: "ruim", contem: ["não respondeu"], semCru: true });

/* ── Invocação ────────────────────────────────────────────────────── */
caso("invocação com armadura",
  P.traduzirInvocacao("[Scripting] INVOCA|ok|perto de LentDust064|zombie ×25|com=full_diamond_armor|#77aa88"),
  { tom: "bom", contem: ["zombie", "25", "LentDust064", "full diamond armor"] });

caso("invocação recusada",
  P.traduzirInvocacao("[Scripting] INVOCA|erro:faltou_a_criatura|#12ab34"),
  { tom: "ruim", contem: ["Faltou dizer qual criatura"] });

/* ── Teleporte ────────────────────────────────────────────────────── */
caso("teleporte para coordenada",
  P.traduzirTp("[Scripting] TP|ok|LentDust064|-212,64,221|#b0f28c", "LentDust064"),
  { tom: "bom", contem: ["LentDust064", "teleportado", "-212 64 221"] });

caso("teleporte para junto de alguém",
  P.traduzirTp("[Scripting] TP|ok|LentDust064|junto de Rafael|#c31d55", "LentDust064"),
  { tom: "bom", contem: ["teleportado", "junto de Rafael"] });

caso("teleporte em pedaço frio",
  P.traduzirTp("[Scripting] TP|erro:nao_consegui_ler_o_terreno|480,-300|#d716fb", "LentDust064"),
  { tom: "ruim", contem: ["não está carregado"] });

caso("teleporte sem ninguém no mundo",
  P.traduzirTp("[Scripting] TP|erro:ninguem_online_com_esse_nome|@a|#ff0011", "@a"),
  { tom: "ruim", contem: ["Não há ninguém no mundo"] });

/* ── Explosão ─────────────────────────────────────────────────────── */
caso("explosão sem quebrar bloco",
  P.traduzirBoom("[Scripting] BOOM|ok|raio 40|120 64 -30|sem quebrar bloco|#ee0022"),
  { tom: "bom", contem: ["Explodiu", "120 64 -30", "sem quebrar bloco"] });

caso("explosão com fogo",
  P.traduzirBoom("[Scripting] BOOM|ok|raio 6|-4 70 12|com fogo|#4455aa"),
  { tom: "bom", contem: ["Explodiu", "com fogo"] });

caso("explosão sem alvo",
  P.traduzirBoom("[Scripting] BOOM|erro:ninguem_online|#99ccdd"),
  { tom: "ruim", contem: ["Não consegui explodir"] });

/* ── Nome bonito de item e criatura ──────────────────────────────────
   O glossário do painel: tira o prefixo "minecraft:", troca "_" por
   espaço e maiúscula só a primeira letra — frase corrida, para caber no
   texto que já se lê, e não Título De Cada Palavra como nomeDoItem. */
c.caso("item com underscore", P.nomeBonitoDeItem("netherite_sword"),
  (v) => (v === "Netherite sword" ? null : "veio " + v));
c.caso("criatura com prefixo minecraft:", P.nomeBonitoDeMob("minecraft:zombie_pigman"),
  (v) => (v === "Zombie pigman" ? null : "veio " + v));
c.caso("item já sem prefixo nem underscore", P.nomeBonitoDeItem("apple"),
  (v) => (v === "Apple" ? null : "veio " + v));

/* ── O corte do histórico ─────────────────────────────────────────── */
const LONGO = "give LentDust064 netherite_sword with sharpness 5 knockback 4000";
c.caso("corte guarda começo e fim", P.cortarNoMeio(LONGO, 44), (veio) => {
  if (veio.length > 44) return `saiu com ${veio.length} caracteres, o teto é 44`;
  if (!veio.startsWith("give Lent")) return "perdeu o começo: " + veio;
  if (!veio.endsWith("4000")) return "perdeu o fim: " + veio;
  if (!veio.includes("…")) return "cortou sem avisar: " + veio;
  return null;
});
c.caso("curto passa inteiro", P.cortarNoMeio("tp @a to 0 0", 44),
  (veio) => (veio === "tp @a to 0 0" ? null : "mexeu no que já cabia: " + veio));

process.exit(c.fechar() ? 1 : 0);
