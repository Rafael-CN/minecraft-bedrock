/* ═══════════════════════════════════════════════════════════════════
   TESTES DO SERVIDOR EM ABAS

   A etapa 4 da revisão de interface deu ao Servidor cinco abas e um
   punhado de contas que antes não existiam: quanto tempo é "no ar", se
   um backup está atrasado, o que é uma linha de erro no log, e quem já
   passou pelo mundo. Nenhuma delas toca no DOM — por isso dá para testar
   sem tela nenhuma, só a lógica.

   Como rodar:   node testes/servidor.mjs
   ═══════════════════════════════════════════════════════════════════ */

import { carregarPainel, corrida } from "./painel.mjs";

const P = carregarPainel();
const c = corrida("O Servidor em abas");

/* ── formatarDuracao: "no ar" sem hora nem minuto pendurado à toa ── */
c.caso("menos de um minuto", P.formatarDuracao(30),
  (v) => (v === "menos de um minuto" ? null : "veio " + v));
c.caso("minutos, plural", P.formatarDuracao(125),
  (v) => (v === "2 minutos" ? null : "veio " + v));
c.caso("uma hora, singular", P.formatarDuracao(3600),
  (v) => (v === "1 hora" ? null : "veio " + v));
c.caso("horas e minutos", P.formatarDuracao(3600 * 2 + 60 * 15),
  (v) => (v === "2 horas e 15 min" ? null : "veio " + v));
c.caso("dias exatos, sem 'e 0h' pendurado", P.formatarDuracao(3600 * 24 * 2),
  (v) => (v === "2 dias" ? null : "veio " + v));
c.caso("dias e horas", P.formatarDuracao(3600 * 24 * 2 + 3600 * 5),
  (v) => (v === "2 dias e 5h" ? null : "veio " + v));
c.caso("negativo ou inválido vira travessão", P.formatarDuracao(-5),
  (v) => (v === "—" ? null : "veio " + v));

/* ── formatarVida: "14 / 20", ou travessão quando a posição não trouxe vida ── */
c.caso("vida e vidaMax viram '14 / 20'", P.formatarVida(14, 20),
  (v) => (v === "14 / 20" ? null : "veio " + v));
c.caso("sem vida (linha antiga) vira travessão", P.formatarVida(undefined, undefined),
  (v) => (v === "—" ? null : "veio " + v));

/* ── nivelDeCarga: um indicador só, e só chama atenção acima do limiar ── */
c.caso("cpu acima do limiar é carga alta", P.nivelDeCarga(85, 10),
  (v) => (v === "alta" ? null : "veio " + v));
c.caso("memória acima do limiar também é carga alta", P.nivelDeCarga(10, 90),
  (v) => (v === "alta" ? null : "veio " + v));
c.caso("os dois abaixo do limiar é carga normal", P.nivelDeCarga(20, 30),
  (v) => (v === "normal" ? null : "veio " + v));
c.caso("no próprio limiar ainda não é alta", P.nivelDeCarga(70, 85),
  (v) => (v === "normal" ? null : "veio " + v));

/* ── statusBackup: atrasado com folga, nunca por causa de um mundo novo ── */
c.caso("backup recente está em dia",
  P.statusBackup(1000, 24, 1000 + 3600 * 2).atrasado,
  (v) => (v === false ? null : "deveria estar em dia"));
c.caso("backup muito velho está atrasado",
  P.statusBackup(1000, 24, 1000 + 3600 * 40).atrasado,
  (v) => (v === true ? null : "deveria estar atrasado"));
c.caso("sem nenhum backup ainda não é 'atrasado'",
  P.statusBackup(null, 24, 1000).atrasado,
  (v) => (v === false ? null : "mundo novo não é atraso"));

/* ── classificarLinhaDeLog: o filtro da aba Log ── */
c.caso("exceção do script é erro",
  P.classificarLinhaDeLog("[Scripting] TypeError: x is not a function"),
  (v) => (v === "erro" ? null : "veio " + v));
c.caso("EVT|entrou é entrada/saída",
  P.classificarLinhaDeLog("[Scripting] EVT|entrou|LentDust064||123"),
  (v) => (v === "entrada_saida" ? null : "veio " + v));
c.caso("EVT|saiu é entrada/saída",
  P.classificarLinhaDeLog("[Scripting] EVT|saiu|LentDust064||123"),
  (v) => (v === "entrada_saida" ? null : "veio " + v));
c.caso("resposta do nosso protocolo é comando",
  P.classificarLinhaDeLog("[Scripting] FORJA|ok|LentDust064|netherite_sword|na mão|#a1b2c3"),
  (v) => (v === "comando" ? null : "veio " + v));
c.caso("o resto é 'outro'",
  P.classificarLinhaDeLog("[INFO] Server started."),
  (v) => (v === "outro" ? null : "veio " + v));

/* ── resumoVisitantes: um por nome, o evento mais recente vence ── */
const EVENTOS = [
  { tipo: "entrou", nome: "LentDust064", ts: 100 },
  { tipo: "saiu", nome: "LentDust064", ts: 200 },
  { tipo: "entrou", nome: "Fulano", ts: 150 },
  { tipo: "morreu", nome: "Fulano", ts: 180 },
];
const visitantes = P.resumoVisitantes(EVENTOS);
c.caso("só entrou/saiu vira visita", visitantes.length,
  (v) => (v === 2 ? null : "veio " + v + " visitantes"));
c.caso("o evento mais recente do jogador vence",
  visitantes[0].nome + ":" + visitantes[0].tipo,
  (v) => (v === "LentDust064:saiu" ? null : "veio " + v));
c.caso("ordenado do mais recente para o mais antigo",
  visitantes.map((v) => v.nome).join(","),
  (v) => (v === "LentDust064,Fulano" ? null : "veio " + v));
c.caso("lista vazia não estoura", P.resumoVisitantes([]).length,
  (v) => (v === 0 ? null : "veio " + v));

/* ── rotuloQuedaJogadores: o que Reiniciar/Desligar mostram antes do clique ── */
c.caso("ninguém online não avisa nada", P.rotuloQuedaJogadores([]),
  (v) => (v === "" ? null : "veio " + v));
c.caso("um jogador, singular", P.rotuloQuedaJogadores(["LentDust064"]),
  (v) => (v === "LentDust064 vai cair" ? null : "veio " + v));
c.caso("dois jogadores, plural", P.rotuloQuedaJogadores(["LentDust064", "Fulano"]),
  (v) => (v === "LentDust064, Fulano vão cair" ? null : "veio " + v));

process.exit(c.fechar() ? 1 : 0);
