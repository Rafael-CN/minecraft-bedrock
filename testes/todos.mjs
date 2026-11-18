/* Roda todos os conjuntos de teste do painel de uma vez.

   node testes/todos.mjs                                          */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PROPRIOS = new Set(["todos.mjs", "painel.mjs"]);

const conjuntos = readdirSync(AQUI).filter((a) => a.endsWith(".mjs") && !PROPRIOS.has(a)).sort();

let quebrou = 0;
for (const conjunto of conjuntos) {
  const r = spawnSync(process.execPath, [join(AQUI, conjunto)], { stdio: "inherit" });
  if (r.status !== 0) quebrou++;
}

/* Os testes do canal com o mundo são em Python, porque o que eles testam
   é o fluxo.py. Sem Python à mão eles são pulados com recado, em vez de
   derrubarem a corrida inteira. */
const emPython = readdirSync(AQUI).filter((a) => a.endsWith(".py")).sort();
let pulados = 0;

for (const conjunto of emPython) {
  let rodou = false;
  for (const python of ["python", "python3"]) {
    const r = spawnSync(python, [join(AQUI, conjunto)], { stdio: "inherit" });
    if (r.error) continue;
    rodou = true;
    if (r.status !== 0) quebrou++;
    break;
  }
  if (!rodou) { pulados++; console.log(`\n(pulei ${conjunto}: não achei o Python)`); }
}

const total = conjuntos.length + emPython.length - pulados;
console.log(quebrou
  ? `\n${quebrou} de ${total} conjuntos falharam.`
  : `\nTodos os ${total} conjuntos passaram.`);
process.exit(quebrou ? 1 : 0);
