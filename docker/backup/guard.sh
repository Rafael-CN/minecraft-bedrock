#!/bin/bash
#
# Guardião do mundo.
#
# Existe por causa de 02/09/2026: o bind mount do WSL2 ficou órfão, o
# container passou a enxergar uma pasta vazia no lugar do mundo, e o
# Bedrock fez o que ele sempre faz quando não acha mundo - criou um novo,
# em branco e sem addons. Ninguém percebeu por 3 horas.
#
# O servidor não tem como distinguir "mundo novo" de "mundo sumiu", então
# a checagem tem que vir de fora: se a pasta do mundo perdeu os addons, o
# mount está errado e o servidor precisa PARAR antes de gravar por cima.
#
# Parar é de propósito. Reiniciar não resolveria: um mount órfão continua
# órfão até o container ser recriado.
#
set -uo pipefail

SERVER="${SERVER_CONTAINER:-mc-bedrock}"
INTERVALO="${GUARD_INTERVAL:-60}"

# Ler level-name de server.properties com fallback para env
get_level_name() {
  if [ -f "/data/server.properties" ]; then
    grep -E '^level-name=' /data/server.properties | head -1 | cut -d= -f2- || true
  fi
}
LEVEL="$(get_level_name)"
[ -z "$LEVEL" ] && LEVEL="${LEVEL_NAME:-}"
[ -z "$LEVEL" ] && { echo "ERRO: LEVEL_NAME nao definido em env nem em server.properties"; exit 1; }

MUNDO="/data/worlds/${LEVEL}"
MARCA="${MUNDO}/world_behavior_packs.json"

log() { echo "[guarda $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "vigiando ${MARCA} a cada ${INTERVALO}s"

while true; do
  sleep "$INTERVALO"

  rodando="$(docker inspect -f '{{.State.Running}}' "$SERVER" 2>/dev/null || echo false)"
  [ "$rodando" = "true" ] || continue

  # A marca é o arquivo que liga os addons. Se ele sumiu mas a pasta do
  # mundo existe, ou a pasta inteira sumiu, o mount não está apontando
  # para o mundo de verdade.
  if [ -f "$MARCA" ]; then
    continue
  fi

  log "ALERTA: ${MARCA} nao existe - o mount do mundo esta errado"
  log "parando ${SERVER} para nao gravar por cima do mundo bom"

  if docker stop -t 60 "$SERVER" >/dev/null 2>&1; then
    log "servidor parado. Para consertar, recrie o container:"
    log "  docker compose up -d --force-recreate bedrock"
  else
    log "ERRO: nao consegui parar o ${SERVER}"
  fi
done
