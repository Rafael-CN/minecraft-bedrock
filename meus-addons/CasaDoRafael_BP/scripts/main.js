import { world, system, ItemStack } from "@minecraft/server";
// Import de namespace alem do nomeado: assim da para procurar simbolos que
// podem nao existir nesta versao do modulo (EnchantmentTypes, por exemplo)
// sem quebrar o addon inteiro no carregamento com um import que nao resolve.
import * as mc from "@minecraft/server";

/**
 * Addon da casa - servidor do Rafael (v2)
 *
 * Comandos por chat com ! :
 * - !home, !sethome, !back, !regras, !ajuda, !online, !coord (todos)
 *
 * Comandos administrativos via scriptEvent (console only):
 * - casa:give, casa:summon, casa:tp (sourceType === Server apenas)
 *
 * Beta APIs habilitada no servidor - permite beforeEvents.chatSend.
 * Cooldown: 10 s por comando, não global.
 */

const COR = {
  titulo: "§6",
  destaque: "§e",
  texto: "§7",
  ok: "§a",
  aviso: "§c",
  reset: "§r",
};

const REGRAS = [
  "Não quebrar nem pegar construção dos outros.",
  "Avisar no chat antes de mexer perto da base de alguém.",
  "Combate entre a gente só se os dois topararem.",
  "Achou bug de addon? Fala pro Rafael em vez de abusar.",
];

// Props dinâmicas
const PROP_VETERANO = "casa:jaVeioAqui";
const PROP_HOME = "casa:home";
const PROP_LAST_DEATH = "casa:ultimaMorte"; // JSON: { x, y, z, dim }
const PROP_LAST_CMD = "casa:ultimoCmd_"; // prefix; sufixo é o nome do comando
const PROP_PLAY_TIME = "casa:tempoJogo"; // segundos
const PROP_DEATH_COUNT = "casa:mortes";
const PROP_BLOCK_COUNT = "casa:blocos";

// Tracking de TPA
const TPA_REQUESTS = new Map(); // jogador -> { origem, tempo }
const COOLDOWN_MS = 10000; // 10 s per comando

function timestamp() {
  return Math.floor(Date.now() / 1000);
}

function getCoords(jogador) {
  if (!jogador.location) return null;
  const { x, y, z } = jogador.location;
  const dim = jogador.dimension.id.replace("minecraft:", "");
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z), dim };
}

function canUseCmd(jogador, cmd) {
  try {
    const propKey = PROP_LAST_CMD + cmd;
    const lastCmd = jogador.getDynamicProperty(propKey) || 0;
    const now = Date.now();
    if (now - lastCmd < COOLDOWN_MS) return false;
    jogador.setDynamicProperty(propKey, now);
    return true;
  } catch {
    return true; // sem prop = pode usar
  }
}

function cabecalho(alvo) {
  alvo.sendMessage(`${COR.titulo}=== Servidor da Casa ===${COR.reset}`);
}

function mostrarRegras(alvo) {
  cabecalho(alvo);
  alvo.sendMessage(`${COR.texto}As regras da casa:`);
  REGRAS.forEach((regra, i) => {
    alvo.sendMessage(`  ${COR.destaque}${i + 1}.${COR.texto} ${regra}`);
  });
  alvo.sendMessage(`${COR.texto}Comandos: ${COR.destaque}!ajuda`);
}

function mostrarAjuda(alvo) {
  cabecalho(alvo);
  alvo.sendMessage(`${COR.texto}Comandos com !`);
  alvo.sendMessage(`  ${COR.destaque}!home${COR.texto} - ir para sua casa`);
  alvo.sendMessage(`  ${COR.destaque}!sethome${COR.texto} - marca este lugar`);
  alvo.sendMessage(`  ${COR.destaque}!back${COR.texto} - volta pro ponto da morte`);
  alvo.sendMessage(`  ${COR.destaque}!regras${COR.texto} - as regras da casa`);
  alvo.sendMessage(`  ${COR.destaque}!online${COR.texto} - quem está jogando`);
  alvo.sendMessage(`  ${COR.destaque}!coord${COR.texto} - suas coordenadas`);
  alvo.sendMessage(`${COR.texto}Poderes de admin são só pelo painel.`);
}

function mostrarOnline(alvo) {
  const todos = world.getAllPlayers();
  const nomes = todos.map((p) => p.name).join(", ");
  alvo.sendMessage(
    `${COR.texto}Online agora (${COR.destaque}${todos.length}${COR.texto}): ${nomes}`
  );
}

function mostrarCoordenadas(alvo) {
  const coords = getCoords(alvo);
  if (!coords) {
    alvo.sendMessage(`${COR.texto}Comando só funciona no jogo.`);
    return;
  }
  alvo.sendMessage(
    `${COR.texto}Você está em ${COR.destaque}${coords.x}, ${coords.y}, ${coords.z}${COR.texto} (${coords.dim})`
  );
}

function setHome(jogador) {
  const coords = getCoords(jogador);
  if (!coords) {
    jogador.sendMessage(`${COR.texto}Erro ao obter coordenadas.`);
    return;
  }
  try {
    jogador.setDynamicProperty(PROP_HOME, JSON.stringify(coords));
    jogador.sendMessage(`${COR.ok}Casa marcada em ${coords.x}, ${coords.y}, ${coords.z}!`);
    console.warn(`HOME|${jogador.name}|${coords.x},${coords.y},${coords.z}|${coords.dim}`);
  } catch (e) {
    jogador.sendMessage(`${COR.aviso}Erro ao marcar casa: ${e.message}`);
  }
}

function goHome(jogador) {
  try {
    const homeProp = jogador.getDynamicProperty(PROP_HOME);
    if (!homeProp) {
      jogador.sendMessage(`${COR.aviso}Você não marcou uma casa ainda. Use !sethome`);
      return;
    }
    const coords = JSON.parse(homeProp);
    jogador.teleport(
      { x: coords.x + 0.5, y: coords.y + 1, z: coords.z + 0.5 },
      jogador.dimension,
      0, 0
    );
    jogador.sendMessage(`${COR.ok}Teleportado para sua casa!`);
  } catch (e) {
    jogador.sendMessage(`${COR.aviso}Erro: ${e.message}`);
  }
}

function goBack(jogador) {
  try {
    const backProp = jogador.getDynamicProperty(PROP_LAST_DEATH);
    if (!backProp) {
      jogador.sendMessage(`${COR.aviso}Você não morreu ainda.`);
      return;
    }
    const coords = JSON.parse(backProp);
    // Teleportar na dimensão da morte, não na dimensão atual
    const dimId = coords.dim || "overworld"; // fallback para overworld
    let dimension = world.getDimension("minecraft:" + dimId);
    jogador.teleport(
      { x: coords.x + 0.5, y: coords.y + 1, z: coords.z + 0.5 },
      dimension,
      0, 0
    );
    jogador.sendMessage(`${COR.ok}Voltou pro ponto da morte!`);
  } catch (e) {
    jogador.sendMessage(`${COR.aviso}Erro: ${e.message}`);
  }
}

function tpaRequest(jogador, alvo) {
  if (!alvo) {
    jogador.sendMessage(`${COR.aviso}Jogador não encontrado.`);
    return;
  }
  TPA_REQUESTS.set(alvo.name, { origem: jogador, tempo: Date.now() });
  jogador.sendMessage(`${COR.ok}Pedido enviado para ${alvo.name}`);
  alvo.sendMessage(`${COR.destaque}${jogador.name}${COR.texto} quer teleportar. Use !aceitar`);
}

function tpaAccept(jogador) {
  const req = TPA_REQUESTS.get(jogador.name);
  if (!req) {
    jogador.sendMessage(`${COR.aviso}Nenhum pedido de TPA.`);
    return;
  }
  if (Date.now() - req.tempo > 30000) { // 30 s
    TPA_REQUESTS.delete(jogador.name);
    jogador.sendMessage(`${COR.aviso}Pedido expirou.`);
    return;
  }
  const origem = req.origem;
  TPA_REQUESTS.delete(jogador.name);
  try {
    origem.teleport(
      { x: jogador.location.x + 0.5, y: jogador.location.y + 1, z: jogador.location.z + 0.5 },
      jogador.dimension,
      0, 0
    );
    origem.sendMessage(`${COR.ok}Teleportado para ${jogador.name}!`);
    jogador.sendMessage(`${COR.ok}${origem.name} chegou!`);
  } catch (e) {
    origem.sendMessage(`${COR.aviso}Erro: ${e.message}`);
  }
}

// Funções de admin via scriptEvent (console only)

function giveItemAdmin(alvo, item, qtd, enchants) {
  const stack = new ItemStack(item, qtd);
  if (enchants && Object.keys(enchants).length > 0) {
    const comp = stack.getComponent("enchantable");
    if (comp) {
      Object.entries(enchants).forEach(([name, level]) => {
        comp.addEnchantment({ type: name, level });
      });
    }
  }
  alvo.getComponent("inventory").container.addItem(stack);
  return true;
}

// Os espacos de equipamento sao nomeados na API, nao numerados. A versao
// antiga chamava setEquipment(0..4) com indices e envolvia tudo num catch
// vazio - o jogo recusava calado e o mob nascia pelado sem ninguem saber.
const ESPACO = {
  cabeca: "Head",
  peito: "Chest",
  pernas: "Legs",
  pes: "Feet",
  mao: "Mainhand",
  maoSecundaria: "Offhand",
};

// Os mesmos espacos, do jeito que o comando /replaceitem os chama.
const SLOT_DE_COMANDO = {
  cabeca: "slot.armor.head",
  peito: "slot.armor.chest",
  pernas: "slot.armor.legs",
  pes: "slot.armor.feet",
  mao: "slot.weapon.mainhand",
  maoSecundaria: "slot.weapon.offhand",
};

const CONJUNTO_DE_ARMADURA = {
  leather: "leather", couro: "leather",
  chainmail: "chainmail", malha: "chainmail",
  iron: "iron", ferro: "iron",
  gold: "golden", golden: "golden", ouro: "golden",
  diamond: "diamond", diamante: "diamond",
  netherite: "netherite",
};

/**
 * Invoca uma criatura ja montada: armadura, o que ela segura em cada mao,
 * nome flutuante, vida e efeitos.
 *
 * Nada disso existe no /summon do Bedrock, que so aceita um evento de
 * spawn e um nome. Aqui um zumbi pode nascer segurando um ovo, com 200 de
 * vida e Forca 255 - efeito aceita nivel alto, ao contrario de
 * encantamento, que o motor limita.
 *
 * Devolve o que deu certo e o que o jogo recusou, item por item, para o
 * painel poder contar em vez de fingir que foi tudo bem.
 */
function invocarCriatura(dimension, location, receita, contarDepois) {
  const feitos = [];
  const recusados = [];
  const qtd = Math.max(1, Math.min(64, receita.qtd || 1));
  const nascidos = [];

  for (let i = 0; i < qtd; i++) {
    try {
      nascidos.push(dimension.spawnEntity(receita.mob, location));
    } catch (e) {
      recusados.push(`${receita.mob}:${motivoCurto(e)}`);
      break; // se o primeiro nao nasce, os outros tambem nao nascem
    }
  }

  if (nascidos.length === 0) {
    contarDepois({ feitos, recusados, quantos: 0 });
    return;
  }

  // No instante do spawn a criatura ainda nao terminou de se montar, e
  // getComponent("equippable") volta vazio - foi o que fez o zumbi nascer
  // pelado e o painel dizer "esta criatura nao veste nada". Um tick de
  // espera resolve: dai em diante os componentes estao todos no lugar.
  system.runTimeout(() => {
    nascidos.forEach((mob, i) => {
      const primeiro = i === 0;
      if (!mob.isValid) {
        if (primeiro) recusados.push("a criatura sumiu antes de ser montada");
        return;
      }

      const equip = mob.getComponent("minecraft:equippable");

      // Etiqueta so desta criatura, para o /replaceitem mirar nela e nao
      // em todo zumbi do pedaco. Sai assim que o trabalho termina.
      const marca = "casa_" + Date.now().toString(36) + "_" + i;
      let etiquetada = false;
      if (!equip) {
        try { mob.addTag(marca); etiquetada = true; }
        catch (e) { if (primeiro) recusados.push(`etiqueta:${motivoCurto(e)}`); }
      }

      // Duas rotas para vestir a criatura, nesta ordem:
      //
      // 1. minecraft:equippable, quando existe. Nesta versao do servidor
      //    ele nao veio nem no zumbi nem no warden - a lista de
      //    componentes deles nao tem o item, e por isso a primeira versao
      //    disto entregava mob pelado sem erro nenhum.
      // 2. /replaceitem, que e vanilla e funciona desde sempre. A mira e
      //    uma tag temporaria unica: sem ela o comando pegaria qualquer
      //    zumbi por perto, inclusive os que ja estavam no mundo.
      const vestir = (espaco, itemId) => {
        if (!itemId) return;

        if (equip) {
          try {
            equip.setEquipment(ESPACO[espaco], new ItemStack(itemId, 1));
            if (primeiro) feitos.push(`${espaco}=${itemId}`);
            return;
          } catch (e) {
            if (primeiro) recusados.push(`${espaco}:${motivoCurto(e)}`);
            return;
          }
        }

        try {
          mob.dimension.runCommand(
            `replaceitem entity @e[tag=${marca}] ${SLOT_DE_COMANDO[espaco]} 0 ${itemId} 1`
          );
          if (primeiro) feitos.push(`${espaco}=${itemId}`);
        } catch (e) {
          if (primeiro) recusados.push(`${espaco}:${motivoCurto(e)}`);
        }
      };

      const conjunto = CONJUNTO_DE_ARMADURA[String(receita.armadura || "").toLowerCase()];
      if (conjunto) {
        vestir("cabeca", `${conjunto}_helmet`);
        vestir("peito", `${conjunto}_chestplate`);
        vestir("pernas", `${conjunto}_leggings`);
        vestir("pes", `${conjunto}_boots`);
      }
      vestir("mao", receita.mao || receita.arma);
      vestir("maoSecundaria", receita.maoSecundaria);

      if (receita.nome) {
        try { mob.nameTag = receita.nome; if (primeiro) feitos.push(`nome="${receita.nome}"`); }
        catch (e) { if (primeiro) recusados.push(`nome:${motivoCurto(e)}`); }
      }

      if (receita.vida) {
        try {
          const saude = mob.getComponent("minecraft:health");
          // Cada criatura tem um teto proprio de vida, e pedir acima dele
          // e recusado inteiro - o zumbi voltava com 20 e o log so dizia
          // "vida:recusado". Melhor entregar o maximo que ela aguenta e
          // dizer que foi ate ali.
          const teto = saude.effectiveMax || saude.defaultValue || receita.vida;
          const valor = Math.min(receita.vida, teto);
          saude.setCurrentValue(valor);
          if (primeiro) {
            feitos.push(valor < receita.vida
              ? `vida=${valor} (o maximo desta criatura)`
              : `vida=${valor}`);
          }
        } catch (e) { if (primeiro) recusados.push(`vida:${motivoCurto(e)}`); }
      }

      for (const efeito of receita.efeitos || []) {
        try {
          mob.addEffect(efeito.id, Math.max(1, efeito.segundos || 600) * 20, {
            amplifier: Math.max(0, (efeito.nivel || 1) - 1),
            showParticles: efeito.particulas !== false,
          });
          if (primeiro) feitos.push(`${efeito.id} ${efeito.nivel || 1}`);
        } catch (e) { if (primeiro) recusados.push(`${efeito.id}:${motivoCurto(e)}`); }
      }

      if (etiquetada) {
        try { mob.removeTag(marca); } catch { /* o bicho ja morreu: tudo bem */ }
      }
    });

    contarDepois({ feitos, recusados, quantos: nascidos.length });
  }, 2);
}

// ============================================================ ENTRADA

world.afterEvents.playerSpawn.subscribe((evento) => {
  if (!evento.initialSpawn) return;

  const jogador = evento.player;
  const ts = timestamp();
  world.sendMessage(`${COR.ok}+ ${jogador.name}${COR.texto} entrou`);
  console.warn(`EVT|entrou|${jogador.name}|${ts}`);

  system.runTimeout(() => {
    let veterano = false;
    try {
      veterano = jogador.getDynamicProperty(PROP_VETERANO) === true;
    } catch {}

    if (veterano) {
      jogador.sendMessage(`${COR.texto}Bem-vindo de volta, ${COR.destaque}${jogador.name}${COR.texto}!`);
      jogador.sendMessage(`${COR.texto}Ajuda: ${COR.destaque}!ajuda`);
    } else {
      mostrarRegras(jogador);
      try {
        jogador.setDynamicProperty(PROP_VETERANO, true);
      } catch {}
    }
  }, 60);
});

world.afterEvents.playerLeave.subscribe((evento) => {
  const ts = timestamp();
  world.sendMessage(`${COR.texto}- ${evento.playerName} saiu`);
  console.warn(`EVT|saiu|${evento.playerName}|${ts}`);
});

// ============================================================ MORTE

world.afterEvents.entityDie.subscribe((evento) => {
  const morto = evento.deadEntity;
  if (morto.typeId !== "minecraft:player") return;

  const coords = getCoords(morto);
  const ts = timestamp();
  if (!coords) return;

  try {
    morto.setDynamicProperty(PROP_LAST_DEATH, JSON.stringify(coords));
  } catch {}

  world.sendMessage(
    `${COR.aviso}${morto.name}${COR.texto} morreu em ${coords.x}, ${coords.y}, ${coords.z}`
  );
  console.warn(`EVT|morreu|${morto.name}|${coords.x},${coords.y},${coords.z}|${ts}`);
});

// ============================================================ CHAT

world.beforeEvents.chatSend.subscribe((evento) => {
  const msg = evento.message.trim();
  if (!msg.startsWith("!")) return;

  evento.cancel = true; // não vaza no chat

  const jogador = evento.sender;
  const parts = msg.slice(1).split(" ");
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  const ts = timestamp();

  console.warn(`EVT|chat|${jogador.name}|${msg}|${ts}`);

  // Bloqueados: comandos que agora são só admin
  if (["give", "summon", "tpa", "aceitar"].includes(cmd)) {
    jogador.sendMessage(`${COR.aviso}Comando de administrador. Só no painel.`);
    return;
  }

  if (!canUseCmd(jogador, cmd)) {
    jogador.sendMessage(`${COR.aviso}Aguarde 10s.`);
    return;
  }

  switch (cmd) {
    case "home":
      goHome(jogador);
      break;
    case "sethome":
      setHome(jogador);
      break;
    case "back":
      goBack(jogador);
      break;
    case "regras":
      mostrarRegras(jogador);
      break;
    case "ajuda":
    case "help":
      mostrarAjuda(jogador);
      break;
    case "online":
      mostrarOnline(jogador);
      break;
    case "coord":
    case "coords":
      mostrarCoordenadas(jogador);
      break;
    default:
      jogador.sendMessage(`${COR.aviso}Comando desconhecido. Use !ajuda`);
  }
});

// ============================================================ ADMIN COMMANDS (console only via scriptEvent)

// ── A FORJA ──────────────────────────────────────────────────────────
// A bancada do painel manda a receita inteira de um item aqui.
//
// Por que não usar /give: o give do Bedrock aceita só quatro components
// e não encanta, não nomeia e não põe descrição. Tudo isso existe na
// Script API, e é por ela que o item é montado.
//
// O limite que ninguém contorna: o nível máximo de cada encantamento
// está fixo no motor do jogo. addEnchantment recusa qualquer coisa
// acima dele. Em vez de devolver erro e não entregar nada, a forja
// desce o nível até o maior que o jogo aceita e diz que cortou - é o
// que o painel promete ao Rafael quando ele sobe o número.

const NIVEL_MINIMO = 1;

/**
 * Etiqueta que o painel colou no pedido, devolvida na resposta.
 *
 * Sem ela o painel tinha que dormir um tempo fixo e depois adivinhar qual
 * linha do log era a resposta dele - e errava sempre que dois comandos
 * saiam juntos. Com a etiqueta, o painel acorda exatamente quando a SUA
 * resposta chega.
 */
/**
 * Resolve o alvo de um comando numa lista de jogadores.
 *
 * O painel manda "@a" quando o chip de alvo esta em "todo mundo", e o
 * script procurava um jogador CHAMADO "@a" - que obviamente nao existe.
 * Era isso que respondia "ninguem online com esse nome |@a" e fazia o
 * teleporte parecer quebrado mesmo com gente no mundo.
 */
function jogadoresAlvo(quem) {
  const todos = world.getAllPlayers();
  if (!quem || quem === "@a" || quem === "@p" || quem === "@r" || quem === "@s") {
    return todos;
  }
  return todos.filter((p) => p.name === quem);
}

function marca(receita) {
  const id = receita && receita.id;
  return /^[a-z0-9]{4,12}$/.test(String(id || "")) ? `|#${id}` : "";
}

/**
 * Resolve o nome de um encantamento no objeto que a API espera.
 *
 * addEnchantment quer um EnchantmentType. Passar a string crua funciona em
 * algumas versoes do modulo e falha calado em outras - foi assim que a
 * espada saiu sem nenhum encantamento e o log so disse "recusado". Aqui a
 * gente procura o tipo de verdade e so cai para a string se o registro
 * nem existir nesta versao.
 */
function tipoDeEncantamento(nome) {
  try {
    if (mc.EnchantmentTypes && typeof mc.EnchantmentTypes.get === "function") {
      return mc.EnchantmentTypes.get(nome) || null;
    }
  } catch { /* registro ausente: tenta a string abaixo */ }
  return nome;
}

function motivoCurto(erro) {
  const t = String((erro && erro.message) || erro);
  // O jogo anuncia "nivel alto demais" de duas formas conhecidas: pelo nome
  // da excecao, e por uma frase solta - "Tyring to set enchantment level to
  // 7, range..." (o erro de digitacao e do proprio Bedrock). Reconhecer as
  // duas importa: e este motivo que manda a forja tentar de novo um nivel
  // abaixo em vez de desistir do encantamento inteiro.
  if (t.includes("OutOfBounds")) return "acima_do_teto";
  if (/enchantment level to \d+/i.test(t) && /range/i.test(t)) return "acima_do_teto";
  if (t.includes("NotCompatible")) return "incompativel";
  if (t.includes("Unknown") || t.includes("invalid")) return "nao_existe";
  // Sem padrao reconhecido, vai a mensagem crua: um "recusado" generico
  // ja custou uma noite de adivinhacao com os encantamentos.
  return t.split("|").join("/").slice(0, 90) || "recusado";
}

function montarItemForjado(receita) {
  const qtd = Math.max(1, Math.min(64, receita.qtd || 1));
  const stack = new ItemStack(receita.item, qtd);

  if (receita.nome) stack.nameTag = receita.nome;

  // A descricao vem antes de gravar os poderes: num item que empilha, a
  // receita e guardada como ULTIMA linha da descricao, entao escrever a
  // descricao depois apagaria a receita.
  const descricao = [];
  if (receita.lore) descricao.push(receita.lore);
  for (const [chave, valor] of Object.entries(receita.poderes || {})) {
    if (chave === "efeitos") {
      for (const ef of valor) descricao.push("§d" + ef.id + " " + (ef.nivel || 1));
    } else {
      descricao.push("§d" + chave + " " + valor);
    }
  }
  if (descricao.length) stack.setLore(descricao.slice(0, 18));

  const poderes = gravarPoderes(stack, receita.poderes);

  const aplicados = [];
  const recusados = [];
  const pedidos = Object.entries(receita.encantes || {});

  if (pedidos.length > 0) {
    const comp = stack.getComponent("minecraft:enchantable");
    if (!comp) {
      pedidos.forEach(([nome]) => recusados.push(`${nome}:item_nao_encantavel`));
    } else {
      for (const [nome, nivelPedido] of pedidos) {
        let colocou = false;
        // O campo 'type' quer um EnchantmentType, nao o nome cru. Algumas
        // versoes aceitam a string por conveniencia, outras recusam tudo
        // calado - foi o que fez a espada sair limpa mesmo "sem erro".
        const tipo = tipoDeEncantamento(nome);
        if (!tipo) { recusados.push(`${nome}:nao_existe`); continue; }
        // Desce do nível pedido até o primeiro que o jogo aceita.
        for (let n = nivelPedido; n >= NIVEL_MINIMO; n--) {
          try {
            comp.addEnchantment({ type: tipo, level: n });
            aplicados.push(n === nivelPedido ? `${nome}:${n}` : `${nome}:${n}(pediu ${nivelPedido})`);
            colocou = true;
            break;
          } catch (e) {
            // Incompatível ou inexistente não melhora ao baixar o nível:
            // insistir aqui só gastaria tempo em cima do mesmo erro.
            const motivo = motivoCurto(e);
            if (motivo !== "acima_do_teto") {
              recusados.push(`${nome}:${motivo}`);
              colocou = true;
              break;
            }
          }
        }
        if (!colocou) recusados.push(`${nome}:recusado`);
      }
    }
  }

  if (poderes && poderes.erro) {
    recusados.push("poderes:" + poderes.erro + " (item que empilha nao guarda poder)");
  } else if (poderes) {
    aplicados.push("poderes[" + poderes + "]");
  }

  return { stack, aplicados, recusados };
}

function entregarItem(jogador, stack, onde) {
  if (onde === "chao") {
    const p = jogador.location;
    jogador.dimension.spawnItem(stack, { x: p.x, y: p.y + 2, z: p.z });
    return "caiu do céu";
  }
  if (onde === "mao") {
    const eq = jogador.getComponent("minecraft:equippable");
    // Só ocupa a mão se ela estiver livre: trocar o que o jogador está
    // segurando por um item novo apagaria a ferramenta dele.
    if (eq && !eq.getEquipment("Mainhand")) {
      eq.setEquipment("Mainhand", stack);
      return "na mão";
    }
  }
  jogador.getComponent("minecraft:inventory").container.addItem(stack);
  return "no inventário";
}

// ── ITENS COM PODER ──────────────────────────────────────────────────
//
// O teto de encantamento do Bedrock e do motor e nao se contorna. Mas
// nada impede a gente de pendurar poder no item por fora do sistema de
// encantamento: a forja grava uma receita de poderes dentro do proprio
// item, e quando ele acerta alguem o script executa essa receita.
//
// Dai sai o "Knockback 4000" que o jogo nunca deixaria escrever: nao e um
// encantamento nivel 4000, e um item que arremessa com forca 4000. O
// efeito e o que o Rafael queria, e sem limite nenhum.
//
// Os poderes viajam numa propriedade dinamica do item. Isso so vale para
// item que nao empilha - espada, picareta, arco, armadura - que e
// justamente onde poder faz sentido.

const PROP_PODERES = "casa:poderes";

/** Tudo que um item pode fazer ao acertar alguem. Sem teto em nenhum. */
const PODERES_CONHECIDOS = {
  dano: "dano extra por acerto",
  knockback: "forca do arremesso horizontal",
  launch: "forca do arremesso para cima",
  explode: "raio da explosao no alvo",
  fogo: "segundos ateado em fogo",
  raio: "cai um raio no alvo",
  roubo: "vida que volta para quem bateu",
  efeito: "efeito aplicado no alvo",
};

// Onde os poderes ficam guardados dentro do item.
//
// A propriedade dinamica e o lugar limpo, mas so existe em item que NAO
// empilha - espada, arco, armadura. Um graveto com knockback era recusado
// por causa disso, e graveto com knockback e exatamente o tipo de coisa
// que da vontade de fazer.
//
// Entao existe um segundo esconderijo: a propria descricao do item. A
// ultima linha carrega a receita em cinza escuro, quase invisivel no
// jogo, e funciona em qualquer item do mundo.
const MARCA_NA_DESCRICAO = "§8§o";

function gravarPoderes(stack, poderes) {
  if (!poderes || Object.keys(poderes).length === 0) return null;

  const resumo = Object.entries(poderes)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");

  try {
    stack.setDynamicProperty(PROP_PODERES, JSON.stringify(poderes));
    return resumo;
  } catch {
    // Item que empilha: a receita vai na descricao. Quem chamou completa
    // as demais linhas depois; esta fica sempre por ultimo.
    try {
      const linhas = stack.getLore() || [];
      stack.setLore(linhas.concat(MARCA_NA_DESCRICAO + JSON.stringify(poderes)).slice(0, 20));
      return resumo;
    } catch (e) {
      return { erro: motivoCurto(e) };
    }
  }
}

function lerPoderes(stack) {
  if (!stack) return null;

  try {
    const cru = stack.getDynamicProperty(PROP_PODERES);
    if (cru) return JSON.parse(cru);
  } catch { /* segue para a descricao */ }

  try {
    for (const linha of stack.getLore() || []) {
      if (linha.startsWith(MARCA_NA_DESCRICAO)) {
        return JSON.parse(linha.slice(MARCA_NA_DESCRICAO.length));
      }
    }
  } catch { /* item sem descricao legivel */ }

  return null;
}

/** Arremessa, aceitando as duas assinaturas que a API ja teve. */
function arremessar(alvo, deX, deZ, forca, paraCima) {
  const dist = Math.hypot(deX, deZ) || 1;
  const x = (deX / dist) * forca;
  const z = (deZ / dist) * forca;
  try {
    alvo.applyKnockback({ x: x, z: z }, paraCima);
    return true;
  } catch {
    try {
      alvo.applyKnockback(deX / dist, deZ / dist, forca, paraCima);
      return true;
    } catch {
      return false;
    }
  }
}

// ── ARCO COM PODER ───────────────────────────────────────────────────
//
// A mesma receita que a espada carrega vale para o arco - so que ela
// viaja na flecha. Quando o jogador solta a corda, as flechas nascem
// marcadas com os poderes do arco; quando uma acerta alguma coisa, o
// script executa a receita no ponto do impacto.
//
// E aqui o "multishot infinito" que o encantamento nunca deu: o
// encantamento Tiro Multiplo do jogo para em 1 e dispara tres flechas.
// Aqui o numero e seu.

const PROP_PODER_DA_FLECHA = "casa:poderDaFlecha";

function marcarProjetil(entidade, poderes) {
  try {
    entidade.setDynamicProperty(PROP_PODER_DA_FLECHA, JSON.stringify(poderes));
  } catch { /* projetil que nao guarda propriedade: segue sem poder */ }
}

function poderesDoProjetil(entidade) {
  try {
    const cru = entidade.getDynamicProperty(PROP_PODER_DA_FLECHA);
    return cru ? JSON.parse(cru) : null;
  } catch {
    return null;
  }
}

/**
 * Executa a receita de poderes de uma arma sobre um alvo e um lugar.
 *
 * Serve para o golpe de perto e para o projetil: e por isso que todo
 * poder novo passa a valer em qualquer arma, sem ter que escrever duas
 * vezes. "onde" e o ponto do impacto, "alvo" pode faltar (flecha que
 * bateu no chao), "autor" e quem bateu.
 */
// Os nomes dos poderes sao em ingles, como todo parametro do Minecraft.
// Este mapa existe so para os itens que foram forjados antes dessa
// decisao continuarem valendo - ninguem perde a espada que ja tinha.
const NOME_ANTIGO = {
  dano: "damage", fogo: "fire", raio: "lightning", roubo: "lifesteal",
  puxa: "pull", troca: "swap", congela: "freeze", buraco: "crater",
  torre: "pillar", clona: "clone", cresce: "grow", encolhe: "shrink",
  chuva: "arrowrain", teleporta: "blink", quebra: "breakblocks",
  corrente: "chain", efeitos: "effects", torre_de: "pillar_of",
};

function normalizarPoderes(poderes) {
  if (!poderes) return null;
  const limpo = {};
  for (const [chave, valor] of Object.entries(poderes)) {
    limpo[NOME_ANTIGO[chave] || chave] = valor;
  }
  return limpo;
}

function executarPoderes(dimension, onde, brutos, alvo, autor) {
  const poderes = normalizarPoderes(brutos);
  const num = (v) => Number(v) || 0;

  // ── o que acontece no lugar ──
  if (poderes.explode) {
    try {
      dimension.createExplosion(onde, Math.min(1000, num(poderes.explode)), {
        // Explosao que nao quebra nada nao parece explosao. Quem quiser o
        // efeito sem estrago pede "nobreak" na hora de forjar.
        breaksBlocks: poderes.breakblocks !== false,
        causesFire: num(poderes.fire) > 0,
        allowUnderwater: true,
      });
    } catch { /* fora do mundo carregado */ }
  }

  if (poderes.lightning) {
    try { dimension.spawnEntity("minecraft:lightning_bolt", onde); } catch {}
  }

  // Cava uma cratera limpa, sem o estrago espalhado da explosao.
  const crater = Math.min(12, num(poderes.crater));
  if (crater) {
    for (let dx = -crater; dx <= crater; dx++) {
      for (let dy = -crater; dy <= 0; dy++) {
        for (let dz = -crater; dz <= crater; dz++) {
          if (dx * dx + dy * dy + dz * dz > crater * crater) continue;
          try {
            dimension.getBlock({
              x: Math.floor(onde.x) + dx,
              y: Math.floor(onde.y) + dy,
              z: Math.floor(onde.z) + dz,
            })?.setType("minecraft:air");
          } catch {}
        }
      }
    }
  }

  // Ergue uma coluna sob o alvo - bom para prender ou para fazer palco.
  const pillar = Math.min(60, num(poderes.pillar));
  if (pillar) {
    const bloco = poderes.pillar_of || "minecraft:obsidian";
    for (let i = 0; i < pillar; i++) {
      try {
        dimension.getBlock({
          x: Math.floor(onde.x),
          y: Math.floor(onde.y) + i,
          z: Math.floor(onde.z),
        })?.setType(bloco);
      } catch {}
    }
  }

  // Chuva de flechas caindo do ceu no ponto do impacto.
  const arrowrain = Math.min(200, num(poderes.arrowrain));
  for (let i = 0; i < arrowrain; i++) {
    try {
      const f = dimension.spawnEntity("minecraft:arrow", {
        x: onde.x + (Math.random() - 0.5) * 8,
        y: onde.y + 18,
        z: onde.z + (Math.random() - 0.5) * 8,
      });
      f.applyImpulse({ x: 0, y: -1.5, z: 0 });
    } catch {}
  }

  // ── o que acontece com quem bateu ──
  if (poderes.blink && autor) {
    try {
      autor.teleport({ x: onde.x, y: onde.y + 1, z: onde.z }, { dimension: dimension });
    } catch {}
  }

  if (poderes.lifesteal && autor) {
    try {
      const vida = autor.getComponent("minecraft:health");
      vida.setCurrentValue(Math.min(vida.effectiveMax || 20, vida.currentValue + num(poderes.lifesteal)));
    } catch {}
  }

  // ── o que acontece com quem levou ──
  if (!alvo || !alvo.isValid) return;

  // Troca de lugar: voce vai para onde ele estava, ele para onde voce
  // estava. Some do cerco ou puxa o cara para o meio da armadilha.
  if (poderes.swap && autor) {
    try {
      const meu = { x: autor.location.x, y: autor.location.y, z: autor.location.z };
      const dele = { x: alvo.location.x, y: alvo.location.y, z: alvo.location.z };
      autor.teleport(dele, { dimension: alvo.dimension });
      alvo.teleport(meu, { dimension: dimension });
    } catch {}
  }

  if (poderes.damage) {
    try { alvo.applyDamage(num(poderes.damage)); } catch {}
  }

  if (poderes.knockback || poderes.launch || poderes.pull) {
    const base = autor ? autor.location : onde;
    let dx = alvo.location.x - base.x;
    let dz = alvo.location.z - base.z;
    // "puxa" e o mesmo empurrao com o sinal trocado: traz para perto.
    const forca = poderes.pull ? -num(poderes.pull) : num(poderes.knockback);
    arremessar(alvo, dx || 0.1, dz || 0.1, forca, num(poderes.launch));
  }

  if (poderes.fire) {
    try { alvo.setOnFire(num(poderes.fire), true); } catch {}
  }

  // Congela no lugar: lentidao e fadiga no talo, sem tirar a vida.
  const freeze = num(poderes.freeze);
  if (freeze) {
    for (const [id, nivel] of [["slowness", 255], ["mining_fatigue", 255], ["weakness", 255]]) {
      try { alvo.addEffect(id, freeze * 20, { amplifier: nivel, showParticles: true }); } catch {}
    }
  }

  const escala = num(poderes.shrink) || num(poderes.grow);
  if (escala) {
    try {
      const comp = alvo.getComponent("minecraft:scale");
      if (comp) comp.value = poderes.shrink ? 1 / escala : escala;
    } catch {}
  }

  // Clona o bicho que levou o golpe. Bate num zumbi, viram cinco.
  const clones = Math.min(50, num(poderes.clone));
  for (let i = 0; i < clones; i++) {
    try {
      if (alvo.typeId !== "minecraft:player") {
        dimension.spawnEntity(alvo.typeId, {
          x: alvo.location.x + (Math.random() - 0.5) * 3,
          y: alvo.location.y,
          z: alvo.location.z + (Math.random() - 0.5) * 3,
        });
      }
    } catch {}
  }

  for (const ef of poderes.effects || poderes.efeitos || []) {
    try {
      alvo.addEffect(ef.id, Math.max(1, ef.segundos || 10) * 20, {
        amplifier: Math.max(0, (ef.nivel || 1) - 1),
      });
    } catch {}
  }

  // O golpe salta para quem estiver por perto. Uma vez so, sem eco: dois
  // saltos ja seriam uma reacao em cadeia dificil de prever.
  const chain = Math.min(30, num(poderes.chain));
  if (chain) {
    try {
      const vizinhos = dimension.getEntities({
        location: alvo.location,
        maxDistance: 8,
        excludeTypes: ["minecraft:player", "minecraft:item"],
      }).filter((e) => e.id !== alvo.id).slice(0, chain);

      const semEco = { ...poderes };
      delete semEco.chain;
      delete semEco.clone;
      delete semEco.explode;
      for (const v of vizinhos) executarPoderes(dimension, v.location, semEco, v, autor);
    } catch {}
  }
}

// ── AURA: o poder que age so de estar na mao ─────────────────────────
//
// Os outros poderes precisam de um golpe ou de uma flecha acertando algo.
// Estes valem enquanto o item estiver na sua mao, sem voce fazer nada -
// um cajado que ilumina, um martelo que empurra tudo para longe, uma
// pedra que atrai os itens do chao.
//
// Roda a cada dez tiques, meio segundo. A documentacao da Microsoft
// recomenda nao pendurar trabalho em todo tique, e meio segundo e curto o
// bastante para parecer continuo sem pesar no servidor.

const AURAS_DE_EFEITO = {
  aura_speed: "speed",
  aura_strength: "strength",
  aura_shield: "resistance",
  aura_heal: "regeneration",
  aura_jump: "jump_boost",
  aura_haste: "haste",
  aura_night: "night_vision",
  aura_fly: "levitation",
  aura_water: "water_breathing",
  aura_fireproof: "fire_resistance",
  aura_invisible: "invisibility",
};

system.runInterval(() => {
  for (const jogador of world.getAllPlayers()) {
    let naMao;
    try {
      naMao = jogador.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
    } catch { continue; }

    const poderes = normalizarPoderes(lerPoderes(naMao));
    if (!poderes) continue;

    // Efeitos em quem segura. Duracao de 1,5 s renovada a cada meio
    // segundo: some sozinho quando o item sai da mao, sem precisar
    // limpar nada.
    for (const [chave, efeito] of Object.entries(AURAS_DE_EFEITO)) {
      const nivel = Number(poderes[chave]) || 0;
      if (!nivel) continue;
      try {
        jogador.addEffect(efeito, 30, {
          amplifier: Math.max(0, Math.min(255, nivel - 1)),
          showParticles: false,
        });
      } catch {}
    }

    const raio = Number(poderes.aura_range) || 6;

    // Puxa os itens do chao para a sua mao.
    if (poderes.aura_magnet) {
      const alcance = Number(poderes.aura_magnet) || raio;
      try {
        for (const item of jogador.dimension.getEntities({
          location: jogador.location, maxDistance: alcance, type: "minecraft:item",
        })) {
          item.teleport(jogador.location);
        }
      } catch {}
    }

    // O que acontece com quem chega perto: fogo, empurrao, gelo, dano.
    const temAlgoContra = poderes.aura_fire || poderes.aura_push ||
      poderes.aura_freeze || poderes.aura_damage || poderes.aura_pull;
    if (!temAlgoContra) continue;

    let vizinhos = [];
    try {
      vizinhos = jogador.dimension.getEntities({
        location: jogador.location,
        maxDistance: raio,
        excludeTypes: ["minecraft:item", "minecraft:xp_orb"],
      }).filter((e) => e.id !== jogador.id);
    } catch { continue; }

    for (const bicho of vizinhos) {
      if (!bicho.isValid) continue;
      try {
        if (poderes.aura_fire) bicho.setOnFire(Number(poderes.aura_fire), true);
        if (poderes.aura_damage) bicho.applyDamage(Number(poderes.aura_damage));
        if (poderes.aura_freeze) {
          bicho.addEffect("slowness", 30, { amplifier: 255, showParticles: false });
        }
        if (poderes.aura_push || poderes.aura_pull) {
          const dx = bicho.location.x - jogador.location.x;
          const dz = bicho.location.z - jogador.location.z;
          const forca = poderes.aura_pull
            ? -Number(poderes.aura_pull)
            : Number(poderes.aura_push);
          arremessar(bicho, dx || 0.1, dz || 0.1, forca, 0.3);
        }
      } catch {}
    }
  }
}, 10);

world.afterEvents.itemReleaseUse.subscribe((evento) => {
  const jogador = evento.source;
  const poderes = lerPoderes(evento.itemStack);
  if (!jogador || !poderes) return;

  system.run(() => {
    const olhos = jogador.getHeadLocation
      ? jogador.getHeadLocation()
      : { x: jogador.location.x, y: jogador.location.y + 1.6, z: jogador.location.z };
    const mira = jogador.getViewDirection();

    // Flechas a mais, abertas em leque. A do jogo sai sozinha e e
    // marcada logo abaixo, junto com estas.
    //
    // Duas coisas que a primeira versao errava e faziam o tiro nao
    // funcionar: a flecha nascia DENTRO do atirador, entao acertava ele
    // mesmo; e saia com um empurrao em vez de ser disparada, o que dava
    // uma trajetoria mole que caia ali na frente. O jeito certo e o
    // componente de projetil - ele tem dono (para nao acertar quem
    // atirou) e um disparo de verdade, com a mesma fisica da flecha do
    // jogo.
    const extras = Math.max(0, Math.min(200, Number(poderes.multishot) || 0));
    const VELOCIDADE = 3.0;   // a de um arco puxado ate o fim

    for (let i = 0; i < extras; i++) {
      try {
        // Um passo a frente dos olhos, na direcao da mira: fora do corpo
        // de quem atirou, senao a flecha bate nele no primeiro tique.
        const berco = {
          x: olhos.x + mira.x * 1.2,
          y: olhos.y + mira.y * 1.2,
          z: olhos.z + mira.z * 1.2,
        };
        // (o desvio da grade e aplicado no rumo, logo abaixo)
        const flecha = jogador.dimension.spawnEntity("minecraft:arrow", berco);

        // Grade, nao leque: as flechas se espalham em largura E altura,
        // formando uma parede que avanca. Com 12 flechas sai 4x3, com 100
        // sai 10x10 - o lado da grade e a raiz do total.
        const lado = Math.max(1, Math.ceil(Math.sqrt(extras)));
        const col = i % lado;
        const lin = Math.floor(i / lado);
        const ABERTURA = 0.05;
        const desviaH = (col - (lado - 1) / 2) * ABERTURA;
        const desviaV = (lin - (Math.ceil(extras / lado) - 1) / 2) * ABERTURA;

        // O desvio horizontal e perpendicular a mira, senao a grade sairia
        // torta quando voce olha para o lado em vez de para o norte.
        const comp = Math.hypot(mira.x, mira.z) || 1;
        const perpX = -mira.z / comp;
        const perpZ = mira.x / comp;

        const rumo = {
          x: (mira.x + perpX * desviaH) * VELOCIDADE,
          y: (mira.y + desviaV) * VELOCIDADE,
          z: (mira.z + perpZ * desviaH) * VELOCIDADE,
        };

        const proj = flecha.getComponent("minecraft:projectile");
        if (proj) {
          proj.owner = jogador;      // e por isso que ela nao te acerta
          proj.shoot(rumo);
        } else {
          // Versao sem o componente: o empurrao ainda e melhor que nada.
          flecha.applyImpulse(rumo);
        }

        marcarProjetil(flecha, poderes);
      } catch { /* uma flecha a menos nao estraga o tiro */ }
    }

    // A flecha que o proprio jogo disparou nasce um instante depois, e
    // perto do atirador: pegamos todas as que estao por ali e marcamos.
    system.runTimeout(() => {
      try {
        const perto = jogador.dimension.getEntities({
          location: jogador.location,
          maxDistance: 6,
          type: "minecraft:arrow",
        });
        for (const f of perto) {
          if (!poderesDoProjetil(f)) marcarProjetil(f, poderes);
        }
      } catch { /* sem flecha por perto: nada a fazer */ }
    }, 1);
  });
});

world.afterEvents.projectileHitBlock.subscribe((evento) => {
  const poderes = poderesDoProjetil(evento.projectile);
  if (!poderes) return;
  const onde = evento.location, dimension = evento.dimension, autor = evento.source;
  system.run(() => executarPoderes(dimension, onde, poderes, null, autor));
});

world.afterEvents.projectileHitEntity.subscribe((evento) => {
  const poderes = poderesDoProjetil(evento.projectile);
  if (!poderes) return;
  const onde = evento.location, dimension = evento.dimension, autor = evento.source;
  let acertado = null;
  try { acertado = evento.getEntityHit()?.entity; } catch {}
  system.run(() => executarPoderes(dimension, onde, poderes, acertado, autor));
});

world.afterEvents.entityHitEntity.subscribe((evento) => {
  const quemBateu = evento.damagingEntity;
  const alvo = evento.hitEntity;
  if (!quemBateu || !alvo) return;

  let naMao;
  try {
    naMao = quemBateu.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
  } catch { return; }

  const poderes = lerPoderes(naMao);
  if (!poderes) return;

  // Fora do tique do evento: mexer no mundo aqui dentro e recusado, e um
  // empurrao aplicado no mesmo instante do golpe some.
  system.run(() => {
    executarPoderes(alvo.dimension, alvo.location, poderes, alvo, quemBateu);
  });
});

function handleForja(msgJson) {
  let receita;
  try {
    receita = JSON.parse(msgJson);
  } catch (e) {
    console.warn(`FORJA|erro:receita_ilegivel`);
    return;
  }

  if (!receita.item) {
    console.warn(`FORJA|erro:faltou_o_item${marca(receita)}`);
    return;
  }

  const alvos = jogadoresAlvo(receita.alvo);

  if (alvos.length === 0) {
    console.warn(`FORJA|erro:ninguem_online_com_esse_nome|${receita.alvo}${marca(receita)}`);
    return;
  }

  let montado;
  try {
    montado = montarItemForjado(receita);
  } catch (e) {
    console.warn(`FORJA|erro:${receita.item}|${motivoCurto(e)}${marca(receita)}`);
    return;
  }

  // Sem "insistir", um encantamento recusado cancela a entrega inteira:
  // é melhor não receber nada do que receber uma espada capada sem saber.
  if (montado.recusados.length > 0 && !receita.livre) {
    console.warn(`FORJA|cancelado|${receita.item}|recusados=${montado.recusados.join(",")}${marca(receita)}`);
    return;
  }

  for (const jogador of alvos) {
    let onde;
    try {
      onde = entregarItem(jogador, montado.stack, receita.onde || "mao");
    } catch (e) {
      console.warn(`FORJA|erro_entrega|${jogador.name}|${motivoCurto(e)}`);
      continue;
    }
    const partes = [
      "FORJA|ok",
      jogador.name,
      receita.item + (receita.qtd > 1 ? ` ×${receita.qtd}` : ""),
      onde,
    ];
    if (montado.aplicados.length) partes.push(`com=${montado.aplicados.join(",")}`);
    if (montado.recusados.length) partes.push(`o jogo recusou=${montado.recusados.join(",")}`);
    console.warn(partes.join("|") + marca(receita));

    const rotulo = receita.nome || receita.item.replace(/_/g, " ");
    jogador.sendMessage(`${COR.destaque}Você recebeu ${rotulo} ${COR.texto}(${onde})${COR.reset}`);
  }
}

system.afterEvents.scriptEventReceive.subscribe((evento) => {
  // A sonda de sourceType já cumpriu o papel: o console chega como
  // "Server" (provado em 02/09, log 23:05). Logar a cada comando só
  // sujava o log que o Rafael lê - agora só a REJEIÇÃO aparece, que é
  // a informação que importa (alguém tentando usar poder de fora).

  // Este ouvinte recebe TODO scriptevent do mundo, inclusive os que os
  // outros addons disparam entre si. Antes de qualquer coisa, sair fora
  // do que não é nosso - senão o log do Rafael enche de "REJEITA" de
  // evento que nunca teve nada a ver com a gente.
  if (!evento.id.startsWith("casa:")) return;

  const fonte = evento.sourceType; // Valores: "Block", "Entity", "NPCDialogue", "Server"

  // Poder de mestre é só pelo painel, que fala pelo console do servidor.
  // Um bloco de comando ou um jogador esperto não entram por aqui.
  if (fonte !== "Server") {
    console.warn(`ADM|REJEITA|${evento.id}|veio de ${fonte}, não do painel`);
    return;
  }

  if (evento.id === "casa:forjar") {
    handleForja(evento.message);
  } else if (evento.id === "casa:boom") {
    handleBoom(evento.message);
  } else if (evento.id === "casa:give") {
    handleAdminGive(evento.message);
  } else if (evento.id === "casa:summon") {
    handleAdminSummon(evento.message);
  } else if (evento.id === "casa:tp") {
    handleAdminTp(evento.message);
  } else if (evento.id === "casa:mundo") {
    handleLerMundo(evento.message);
  }
});

// ── O ESTADO DO MUNDO ────────────────────────────────────────────────
//
// O painel tinha seis botoes que mandavam "time set day" e "weather rain"
// e nunca sabiam o que estava valendo - "Nascer o sol" e "Cair a noite"
// eram o mesmo controle em dois botoes cegos, e "Guardar o item ao morrer"
// era uma chave liga-desliga fingindo ser botao. Para o painel mostrar o
// estado de verdade ele precisa poder PERGUNTAR, e e isso que entra aqui.
//
// Nao existe "weather query" no Bedrock; quem sabe o clima e a Script API,
// pelo getWeather() da dimensao. As gamerules idem, pelo world.gameRules.

// So estas aparecem no painel. Sao as que mudam o jogo de um jeito que da
// para sentir jogando - o resto e ajuste fino que nao merece espaco fixo.
const REGRAS_DO_PAINEL = [
  "keepInventory",
  "mobGriefing",
  "doFireTick",
  "showCoordinates",
  "pvp",
  "doDaylightCycle",
  "doWeatherCycle",
  "doImmediateRespawn",
];

function handleLerMundo(msgJson) {
  let receita = {};
  try { receita = JSON.parse(msgJson) || {}; } catch (e) { receita = {}; }
  const selo = receita.id ? `|#${receita.id}` : "";

  // getTimeOfDay devolve 0..23999, a mesma escala do "time set".
  let hora = -1;
  try { hora = world.getTimeOfDay(); } catch (e) { hora = -1; }

  // getWeather e recente; se esta versao nao tiver, o painel mostra o
  // clima como desconhecido em vez de mentir que esta sol.
  let clima = "desconhecido";
  try {
    const d = world.getDimension("overworld");
    if (typeof d.getWeather === "function") clima = String(d.getWeather()).toLowerCase();
  } catch (e) { /* fica desconhecido */ }

  const regras = [];
  for (const nome of REGRAS_DO_PAINEL) {
    try {
      const valor = world.gameRules[nome];
      if (valor !== undefined) regras.push(`${nome}=${valor}`);
    } catch (e) { /* regra que esta versao nao tem: simplesmente nao vai */ }
  }

  console.warn(["MUNDO|ok", `hora=${hora}`, `clima=${clima}`, regras.join(",")].join("|") + selo);
}

function handleAdminGive(msgJson) {
  try {
    const msg = JSON.parse(msgJson);
    const alvo = msg.alvo || "@p";
    const item = msg.item;
    const qtd = msg.qtd || 1;
    const enchants = msg.encant || {};

    if (!item) {
      console.warn(`ADM|give|erro:item_obrigatório`);
      return;
    }

    let alvos = [];
    if (alvo === "@a") {
      alvos = world.getAllPlayers();
    } else {
      const p = world.getAllPlayers().find(pl => pl.name === alvo);
      if (!p) {
        console.warn(`ADM|give|${alvo}|erro:jogador_não_encontrado`);
        return;
      }
      alvos = [p];
    }

    alvos.forEach(player => {
      giveItemAdmin(player, item, qtd, enchants);
      console.warn(`ADM|give|${player.name}|${item}|ok`);
    });
  } catch (e) {
    console.warn(`ADM|give|erro:${e.message}`);
  }
}

function handleAdminSummon(msgJson) {
  let receita;
  try {
    receita = JSON.parse(msgJson);
  } catch (e) {
    console.warn(`INVOCA|erro:receita_ilegivel`);
    return;
  }

  if (!receita.mob) {
    console.warn(`INVOCA|erro:faltou_a_criatura${marca(receita)}`);
    return;
  }

  // Destino: uma coordenada do mapa, ou perto de alguem. Clicar no mapa
  // so da X e Z, entao a altura sai do terreno - igual ao teleporte.
  let dimension = null;
  let onde = null;

  if (Number.isFinite(receita.x) && Number.isFinite(receita.z)) {
    // Coordenada do mapa: o lugar pode estar longe de todo mundo, e ali o
    // mundo nem existe na memoria. Carrega primeiro, invoca depois.
    const dim = world.getDimension("minecraft:" + (receita.dim || "overworld"));
    const x = Math.round(receita.x), z = Math.round(receita.z);
    comPedacoDoMundoCarregado(dim, x, z, (deu, porque) => {
      if (!deu) {
        console.warn(`INVOCA|erro:${porque}${marca(receita)}`);
        return;
      }
      const y = Number.isFinite(receita.y) ? receita.y : alturaSegura(dim, x, z);
      relatarInvocacao(dim, { x: x, y: y, z: z }, receita);
    });
    return;
  } else {
    const perto = receita.perto_de;
    const jogador = jogadoresAlvo(perto)[0];

    if (!jogador) {
      console.warn(`INVOCA|erro:ninguem_online_com_esse_nome|${perto || "@a"}${marca(receita)}`);
      return;
    }
    dimension = jogador.dimension;
    // Uns passos a frente, para o bicho nao nascer dentro do jogador.
    const p = jogador.location;
    onde = { x: p.x + 2, y: p.y, z: p.z + 2 };
  }

  relatarInvocacao(dimension, onde, receita);
}

function relatarInvocacao(dimension, onde, receita) {
  const ondeEscrito = `${Math.round(onde.x)} ${Math.round(onde.y)} ${Math.round(onde.z)}`;

  invocarCriatura(dimension, onde, receita, (r) => {
    if (r.quantos === 0) {
      console.warn(`INVOCA|erro:${receita.mob}|${r.recusados.join(",") || "nao nasceu"}${marca(receita)}`);
      return;
    }
    const partes = [
      "INVOCA|ok",
      ondeEscrito,
      receita.mob + (r.quantos > 1 ? ` ×${r.quantos}` : ""),
    ];
    if (r.feitos.length) partes.push(`com=${r.feitos.join(",")}`);
    if (r.recusados.length) partes.push(`o jogo recusou=${r.recusados.join(",")}`);
    console.warn(partes.join("|") + marca(receita));
  });
}

/**
 * Altura em que da para pousar sem sufocar.
 *
 * Clicar no mapa da so X e Z. O comando vanilla resolve o Y como "~", que
 * e a altura ATUAL de quem esta viajando - e por isso o Rafael caia dentro
 * de uma montanha e morria asfixiado. Aqui a gente pergunta ao mundo qual
 * e o bloco mais alto naquele ponto e pousa em cima dele.
 *
 * Se o pedaco do mundo ainda nao estiver carregado, nao ha o que perguntar:
 * devolvemos null e quem chamou decide (o caminho e teleportar alto
 * primeiro, o que carrega o chunk, e ajustar no tique seguinte).
 */
function alturaSegura(dimension, x, z) {
  // getTopmostBlock comeca a busca no teto do mundo, e o pedaco de cima
  // costuma nao estar carregado nem quando o terreno esta - o erro que
  // voltava era "chunk nao carregado" a 320 de altura, escondendo que o
  // chao logo abaixo estava ali, pronto para ser lido.
  // O teto do mundo e 320. Quando o pedaco ainda nao terminou de carregar,
  // getTopmostBlock nao da erro: responde o proprio teto, como se houvesse
  // chao la em cima. Foi assim que um teleporte pousou em y=320 e o Rafael
  // despencou. Resposta perto do teto e resposta que nao serve.
  const SUSPEITO = 250;
  try {
    const topo = dimension.getTopmostBlock({ x: x, z: z });
    if (topo && topo.location.y < SUSPEITO) return topo.location.y + 1;
  } catch { /* segue para a busca manual */ }

  // Busca de cima para baixo a partir de onde o mundo costuma ter chao.
  // Passo de 8 primeiro para achar a faixa, depois bloco a bloco: acha em
  // umas vinte leituras em vez de trezentas.
  const TETO = 200, PISO = -63;
  let grosso = null;
  for (let y = TETO; y >= PISO; y -= 8) {
    try {
      const b = dimension.getBlock({ x: x, y: y, z: z });
      if (b && !b.isAir) { grosso = y; break; }
    } catch { /* faixa nao carregada: tenta a proxima */ }
  }
  if (grosso === null) return null;

  for (let y = grosso + 8; y > grosso; y--) {
    try {
      const b = dimension.getBlock({ x: x, y: y, z: z });
      if (b && b.isAir) {
        const abaixo = dimension.getBlock({ x: x, y: y - 1, z: z });
        if (abaixo && !abaixo.isAir) return y;
      }
    } catch { /* ignora e continua */ }
  }
  return grosso + 1;
}

/**
 * Faz o servidor carregar um pedaco do mundo antes de mexer nele.
 *
 * Clicar num canto distante do mapa pede algo onde ninguem esta, e ali o
 * mundo simplesmente nao existe na memoria: medir o terreno, invocar ou
 * explodir devolve "not in a chunk currently loaded". A saida vanilla e
 * uma area de tick - o servidor passa a manter aquele pedaco vivo.
 *
 * A area e temporaria e sempre com o mesmo nome, entao nunca sobra lixo
 * nem estoura o limite de areas do mundo.
 */
/**
 * Espera o pedaco do mundo ficar legivel antes de agir nele.
 *
 * Quem CARREGA o pedaco e o painel, com uma area de tick, porque o comando
 * tickingarea exige permissao de console e o script do mundo nao tem -
 * tentar daqui so devolvia erro. O papel deste lado e mais humilde: medir
 * o terreno e, se ainda nao der, esperar mais um pouco e tentar de novo.
 */
/**
 * Coloca o jogador em pe no chao daquele ponto do mapa.
 *
 * O clique no mapa da so X e Z. Usar a altura atual de quem esta viajando
 * era o que enterrava o Rafael dentro de uma montanha - aqui a altura vem
 * do terreno do destino.
 */
function pousar(jogador, dimension, x, z, receita, tentativa) {
  const y = alturaSegura(dimension, x, z);

  if (y === null) {
    if (tentativa >= 2) {
      console.warn(`TP|erro:nao_consegui_ler_o_terreno|${x},${z}${marca(receita)}`);
      return;
    }
    // Teleportar alto obriga o servidor a carregar o pedaco do mundo; no
    // tique seguinte ja da para medir o chao de verdade.
    try {
      jogador.teleport({ x: x + 0.5, y: 260, z: z + 0.5 }, { dimension: dimension });
    } catch (e) {
      console.warn(`TP|erro:${motivoCurto(e)}${marca(receita)}`);
      return;
    }
    system.runTimeout(() => pousar(jogador, dimension, x, z, receita, tentativa + 1), 20);
    return;
  }

  try {
    jogador.teleport({ x: x + 0.5, y: y, z: z + 0.5 }, { dimension: dimension });
    console.warn(`TP|ok|${jogador.name}|${x},${y},${z}${marca(receita)}`);
  } catch (e) {
    console.warn(`TP|erro:${motivoCurto(e)}${marca(receita)}`);
  }
}

function comPedacoDoMundoCarregado(dimension, x, z, fazer, tentativa) {
  const vez = tentativa || 0;
  if (alturaSegura(dimension, x, z) !== null) {
    fazer(true);
    return;
  }
  if (vez >= 4) {
    fazer(false, "o servidor nao carregou esse pedaco do mundo");
    return;
  }
  // Um segundo entre tentativas: medido, o mundo leva de um a tres para
  // vir do disco depois que a area de tick e criada.
  system.runTimeout(() => comPedacoDoMundoCarregado(dimension, x, z, fazer, vez + 1), 20);
}

/**
 * Explosao sob medida - o "blast radius" que o /summon tnt nunca deu.
 *
 * Mil TNTs de verdade travariam o servidor: sao mil entidades com fisica,
 * cada uma explodindo em cadeia. createExplosion faz o estrago de uma vez
 * so, aceita raio ate 1000, e escolhe se quebra bloco e se pega fogo.
 */
function handleBoom(msgJson) {
  let receita;
  try {
    receita = JSON.parse(msgJson);
  } catch {
    console.warn("BOOM|erro:receita_ilegivel");
    return;
  }

  const raio = Math.max(1, Math.min(1000, Number(receita.raio) || 10));
  let dimension = null;
  let onde = null;

  const perto = receita.perto_de;
  if (perto && perto !== "@a") {
    const alvo = jogadoresAlvo(perto)[0];
    if (!alvo) {
      console.warn(`BOOM|erro:ninguem_online_com_esse_nome|${perto}${marca(receita)}`);
      return;
    }
    dimension = alvo.dimension;
    onde = alvo.location;
  } else if (Number.isFinite(receita.x) && Number.isFinite(receita.z)) {
    // Coordenada do mapa: carrega o pedaco antes, senao o servidor nem
    // sabe o que ha ali para explodir.
    const dim = world.getDimension("minecraft:" + (receita.dim || "overworld"));
    const x = Math.round(receita.x), z = Math.round(receita.z);
    comPedacoDoMundoCarregado(dim, x, z, (deu, porque) => {
      if (!deu) {
        console.warn(`BOOM|erro:${porque}${marca(receita)}`);
        return;
      }
      const y = Number.isFinite(receita.y) ? receita.y : alturaSegura(dim, x, z);
      explodir(dim, { x: x, y: y, z: z }, receita);
    });
    return;
  } else {
    const alguem = world.getAllPlayers()[0];
    if (!alguem) {
      console.warn(`BOOM|erro:ninguem_online${marca(receita)}`);
      return;
    }
    dimension = alguem.dimension;
    onde = alguem.location;
  }

  explodir(dimension, onde, receita);
}

function explodir(dimension, onde, receita) {
  const raio = Math.max(1, Math.min(1000, Number(receita.raio) || 10));
  try {
    dimension.createExplosion(onde, raio, {
      breaksBlocks: receita.quebra !== false,
      causesFire: receita.fogo === true,
      allowUnderwater: true,
    });
    const detalhes = [
      "BOOM|ok",
      `raio ${raio}`,
      `${Math.round(onde.x)} ${Math.round(onde.y)} ${Math.round(onde.z)}`,
    ];
    if (receita.fogo === true) detalhes.push("com fogo");
    if (receita.quebra === false) detalhes.push("sem quebrar bloco");
    console.warn(detalhes.join("|") + marca(receita));
  } catch (e) {
    console.warn(`BOOM|erro:${motivoCurto(e)}${marca(receita)}`);
  }
}

function handleAdminTp(msgJson) {
  let receita;
  try {
    receita = JSON.parse(msgJson);
  } catch {
    console.warn("TP|erro:receita_ilegivel");
    return;
  }

  const quem = receita.quem;
  if (!quem) {
    console.warn(`TP|erro:faltou_dizer_quem${marca(receita)}`);
    return;
  }

  const alvos = jogadoresAlvo(quem);
  if (alvos.length === 0) {
    console.warn(`TP|erro:ninguem_online_com_esse_nome|${quem}${marca(receita)}`);
    return;
  }
  // Com "@a" o comando vale para todos; com um nome, so para ele.
  const jogador = alvos[0];

  // Destino por coordenada: e o caso do clique no mapa, que da X e Z mas
  // nao tem como saber a altura. O pouso vai medir o terreno.
  if (Number.isFinite(receita.x) && Number.isFinite(receita.z)) {
    const dimension = receita.dim
      ? world.getDimension("minecraft:" + receita.dim)
      : jogador.dimension;
    if (Number.isFinite(receita.y)) {
      try {
        jogador.teleport(
          { x: receita.x + 0.5, y: receita.y, z: receita.z + 0.5 },
          { dimension: dimension }
        );
        console.warn(`TP|ok|${quem}|${receita.x},${receita.y},${receita.z}${marca(receita)}`);
      } catch (e) {
        console.warn(`TP|erro:${motivoCurto(e)}${marca(receita)}`);
      }
      return;
    }
    const x = Math.round(receita.x), z = Math.round(receita.z);
    comPedacoDoMundoCarregado(dimension, x, z, (deu, porque) => {
      if (!deu) {
        console.warn(`TP|erro:${porque}${marca(receita)}`);
        return;
      }
      pousar(jogador, dimension, x, z, receita, 0);
    });
    return;
  }

  // Destino por jogador.
  const alvo = world.getAllPlayers().find((p) => p.name === receita.para);
  if (!alvo) {
    console.warn(`TP|erro:destino_nao_encontrado|${receita.para}${marca(receita)}`);
    return;
  }
  try {
    jogador.teleport(
      { x: alvo.location.x + 0.5, y: alvo.location.y + 1, z: alvo.location.z + 0.5 },
      { dimension: alvo.dimension }
    );
    console.warn(`TP|ok|${quem}|junto de ${alvo.name}${marca(receita)}`);
  } catch (e) {
    console.warn(`TP|erro:${motivoCurto(e)}${marca(receita)}`);
  }
}

// ============================================================ STATS

// Posicao dos jogadores.
//
// Antes ia a cada 10 s, e o marcador no mapa andava aos saltos, sempre
// atrasado. Agora vai a cada 5 ticks - quatro vezes por segundo - porque
// do outro lado o painel le o log em tempo real e nao paga nada por linha.
//
// Cinco ticks e o menor intervalo que a propria documentacao da Microsoft
// sugere para trabalho periodico ("a cada 5, 20 ou 100 ticks"), e o custo
// aqui e so ler a posicao de quem esta online. Uma linha por jogador a
// cada 250 ms: com quatro jogadores, dezesseis linhas por segundo.
//
// A posicao so e escrita quando muda de bloco, para nao encher o log
// enquanto o pessoal constroi parado. Mas quem esta parado tambem precisa
// continuar aparecendo no mapa, entao a cada 4 s sai um pulso mesmo sem
// movimento - e assim o painel sabe a diferenca entre "parado" e "saiu".
const ULTIMO_LUGAR = new Map();
const PULSO_TICKS = 80;
let tique = 0;

system.runInterval(() => {
  tique += 5;
  const ts = timestamp();
  const pulso = tique % PULSO_TICKS < 5;

  for (const jogador of world.getAllPlayers()) {
    const coords = getCoords(jogador);
    if (!coords) continue;
    const agora = `${coords.x},${coords.y},${coords.z}|${coords.dim}`;
    if (!pulso && ULTIMO_LUGAR.get(jogador.name) === agora) continue;
    ULTIMO_LUGAR.set(jogador.name, agora);

    // Vida no fim da linha, campo opcional: se o componente falhar por
    // qualquer razao, a linha sai igual a de sempre, sem o "|hp=".
    let hp = "";
    try {
      const vida = jogador.getComponent("minecraft:health");
      hp = `|hp=${Math.round(vida.currentValue)}/${Math.round(vida.effectiveMax || 20)}`;
    } catch {}

    console.warn(`POS|${jogador.name}|${agora}|${ts}${hp}`);
  }
}, 5);

// ── MOBS AO VIVO ─────────────────────────────────────────────────────
//
// O mapa mostrava o mundo e ninguem nele. Aqui as criaturas viram pontos
// que andam - vermelho para hostil, cinza para o resto.
//
// Duas cautelas, e as duas sao por causa do Core Craft: aquele addon ja
// derrubou o servidor tres vezes travando o watchdog do Bedrock sob carga.
// Uma varredura de entidades a cada dois segundos e exatamente o tipo de
// coisa que faz isso acontecer de novo, entao:
//
//   1. So varre PERTO de quem esta jogando. Um mundo inteiro de entidades
//      nao interessa a ninguem - o que importa e o que esta chegando perto.
//   2. Mede quanto demorou e se cala se estiver caro. Melhor um mapa sem
//      mobs do que um servidor no chao.

const RAIO_DE_VARREDURA = 96;      // blocos ao redor de cada jogador
const TETO_DE_MOBS = 120;          // o mapa nao ganha nada acima disso
const ORCAMENTO_MS = 12;           // acima disto a varredura desacelera

// Quem e hostil. A lista e curta de proposito: o que nao esta aqui vira
// cinza, e um mob de addon desconhecido aparecer como neutro e melhor do
// que nao aparecer.
const HOSTIS = new Set([
  "zombie", "husk", "drowned", "zombie_villager", "zombie_pigman", "zoglin",
  "skeleton", "stray", "wither_skeleton", "bogged",
  "creeper", "spider", "cave_spider", "enderman", "endermite", "silverfish",
  "witch", "slime", "magma_cube", "blaze", "ghast", "phantom", "vex",
  "pillager", "vindicator", "evocation_illager", "ravager", "witherboss",
  "guardian", "elder_guardian", "shulker", "hoglin", "piglin_brute",
  "warden", "breeze", "ender_dragon",
]);

let _passosPulados = 0;

system.runInterval(() => {
  // Depois de uma varredura cara, pula ciclos ate a coisa acalmar.
  if (_passosPulados > 0) { _passosPulados--; return; }

  const jogadores = world.getAllPlayers();
  if (jogadores.length === 0) return;

  const comecou = Date.now();
  const vistos = new Map();   // chave "tipo,x,z" evita contar o mesmo bicho
                              // duas vezes quando dois jogadores estao perto

  for (const jogador of jogadores) {
    if (vistos.size >= TETO_DE_MOBS) break;
    let perto = [];
    try {
      perto = jogador.dimension.getEntities({
        location: jogador.location,
        maxDistance: RAIO_DE_VARREDURA,
        excludeTypes: ["minecraft:player", "minecraft:item", "minecraft:xp_orb",
                       "minecraft:arrow", "minecraft:tnt", "minecraft:falling_block",
                       "minecraft:armor_stand", "minecraft:leash_knot"],
      });
    } catch (e) { continue; }

    for (const bicho of perto) {
      if (vistos.size >= TETO_DE_MOBS) break;
      let tipo, x, z;
      try {
        tipo = String(bicho.typeId || "").replace("minecraft:", "");
        x = Math.round(bicho.location.x);
        z = Math.round(bicho.location.z);
      } catch (e) { continue; }
      if (!tipo) continue;
      vistos.set(`${tipo},${x},${z}`, `${HOSTIS.has(tipo) ? "h" : "n"}${tipo}:${x},${z}`);
    }
  }

  const gastou = Date.now() - comecou;
  if (gastou > ORCAMENTO_MS) {
    // Cinco ciclos de folga por milissegundo passado do orcamento, ate
    // um limite - assim uma varredura cara de 40 ms compra 2 s de calma.
    _passosPulados = Math.min(40, Math.round((gastou - ORCAMENTO_MS) / 2) * 5);
    console.warn(`MOBS|caro|${gastou}ms|pulando ${_passosPulados} ciclos`);
  }

  // Linha vazia tambem vale: e assim que o painel sabe que nao ha mais
  // ninguem por perto, em vez de manter pontos fantasma na tela.
  console.warn("MOBS|" + Array.from(vistos.values()).join(";"));
}, 40);   // 40 ticks = 2 s

// STAT a cada 60 s
system.runInterval(() => {
  const ts = timestamp();
  world.getAllPlayers().forEach(jogador => {
    let blocos = 0, mortes = 0, segundos = 0;
    try {
      blocos = jogador.getDynamicProperty(PROP_BLOCK_COUNT) || 0;
      mortes = jogador.getDynamicProperty(PROP_DEATH_COUNT) || 0;
      segundos = jogador.getDynamicProperty(PROP_PLAY_TIME) || 0;
    } catch {}
    console.warn(`STAT|${jogador.name}|blocos=${blocos}|mortes=${mortes}|segundos=${segundos}|${ts}`);
  });
}, 1200); // 1200 ticks = 60 s

console.warn("[Casa do Rafael v2] carregado - Beta APIs ativo - use !ajuda");
