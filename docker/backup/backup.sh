#!/bin/bash
#
# Backup a quente do mundo Bedrock, sem desconectar ninguém.
#
#   save hold    -> servidor para de gravar e faz o flush
#   save query   -> devolve a lista de arquivos E o tamanho válido de cada um
#   (copia)      -> copia truncando cada arquivo no tamanho informado
#   save resume  -> servidor volta a gravar
#
# O truncamento não é detalhe: o LevelDB mantém arquivos abertos e maiores
# do que a parte já consolidada. Copiar sem truncar gera um backup que
# parece bom e não abre.
#
set -euo pipefail

SERVER="${SERVER_CONTAINER:-mc-bedrock}"
KEEP="${BACKUP_KEEP:-7}"

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
SAIDA="/backups"
STAGING="/tmp/bk.$$"

log() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

servidor_rodando() {
  [ "$(docker inspect -f '{{.State.Running}}' "$SERVER" 2>/dev/null || echo false)" = "true" ]
}

enviar() {
  docker exec "$SERVER" send-command "$1" >/dev/null 2>&1 || true
}

soltar_servidor() {
  if [ "${SEGUROU:-0}" = "1" ]; then
    enviar "save resume"
    SEGUROU=0
    log "servidor liberado para gravar de novo"
  fi
}

limpar() {
  soltar_servidor
  rm -rf "$STAGING"
}
trap limpar EXIT

[ -d "$MUNDO" ] || { log "ERRO: mundo nao encontrado em $MUNDO"; exit 1; }
mkdir -p "$STAGING" "$SAIDA"

CARIMBO="$(date '+%Y-%m-%d_%H%M')"
NOME="${LEVEL}_${CARIMBO}.mcworld"

log "iniciando backup de '${LEVEL}'"

if servidor_rodando; then
  enviar "save hold"
  SEGUROU=1
  sleep 2

  LISTA=""
  for tentativa in $(seq 1 30); do
    enviar "save query"
    sleep 2

    # --since em SEGUNDOS RELATIVOS, de propósito: passar um horário
    # absoluto sem fuso faz o daemon interpretar como hora local dele.
    # Como o container calcula em UTC, a janela cai no futuro e o log
    # volta vazio - o backup falha sem motivo aparente.
    JANELA=$(( 6 + tentativa * 3 ))
    LOG="$(docker logs "$SERVER" --since "${JANELA}s" 2>&1 || true)"

    if printf '%s\n' "$LOG" | grep -q 'ready to be copied\.'; then
      # A lista vem numa linha só, logo depois da linha "Data saved",
      # e é a única sem o timestamp na frente. Pega a mais recente.
      LISTA="$(printf '%s\n' "$LOG" \
        | grep -v '^\[20' \
        | grep -E '/[^ ]*:[0-9]+' \
        | tail -1 \
        | tr ',' '\n')"
      [ -n "$LISTA" ] && break
    fi
  done

  if [ -z "$LISTA" ]; then
    log "ERRO: o servidor nao respondeu ao 'save query' - nada foi alterado"
    exit 1
  fi

  COPIADOS=0
  while IFS= read -r item; do
    item="$(printf '%s' "$item" | tr -d '\r' | sed 's/^ *//; s/ *$//')"
    [ -z "$item" ] && continue
    case "$item" in */*:[0-9]*) ;; *) continue ;; esac

    rel="${item%:*}"          # NomeDoMundo/db/000123.ldb
    tam="${item##*:}"         # 123456
    rel="${rel#*/}"           # db/000123.ldb

    origem="${MUNDO}/${rel}"
    destino="${STAGING}/${rel}"
    [ -f "$origem" ] || continue

    mkdir -p "$(dirname "$destino")"
    cp "$origem" "$destino"
    truncate -s "$tam" "$destino"
    COPIADOS=$((COPIADOS + 1))
  done <<< "$LISTA"

  if [ "$COPIADOS" -eq 0 ]; then
    log "ERRO: nenhum arquivo copiado - lista nao pode ser interpretada"
    exit 1
  fi
  log "$COPIADOS arquivos copiados no ponto exato do save"

  soltar_servidor

  # Packs e listas não mudam durante o jogo e não vêm no save query, mas
  # precisam estar no .mcworld para o backup abrir completo.
  for extra in behavior_packs resource_packs world_behavior_packs.json \
               world_resource_packs.json world_icon.jpeg texts manifest.json; do
    [ -e "${MUNDO}/${extra}" ] && cp -a "${MUNDO}/${extra}" "${STAGING}/"
  done

  # Confere em vez de confiar: um backup sem os addons parece completo,
  # porque o mundo está lá.
  if [ ! -f "${STAGING}/world_behavior_packs.json" ]; then
    log "ERRO: os packs nao entraram no backup"
    exit 1
  fi
  log "addons incluidos"
else
  log "servidor parado - copiando direto (tambem seguro)"
  cp -a "${MUNDO}/." "${STAGING}/"
fi

# -1: os .ldb já são comprimidos internamente pelo LevelDB, então
# comprimir com força custa tempo e economiza pouco.
log "compactando"
( cd "$STAGING" && zip -r -q -1 "${SAIDA}/${NOME}" . )

TAM="$(du -m "${SAIDA}/${NOME}" | cut -f1)"
log "pronto: ${NOME} (${TAM} MB)"

# ------------------------------------------------------------------ rotação
cd "$SAIDA"
TOTAL="$(ls -1t ./*.mcworld 2>/dev/null | wc -l)"
if [ "$TOTAL" -gt "$KEEP" ]; then
  ls -1t ./*.mcworld | tail -n "+$((KEEP + 1))" | while IFS= read -r velho; do
    rm -f "$velho"
    log "apagado (rotacao): $(basename "$velho")"
  done
fi

RESTAM="$(ls -1 ./*.mcworld 2>/dev/null | wc -l)"
MB="$(du -cm ./*.mcworld 2>/dev/null | tail -1 | cut -f1)"
log "${RESTAM} backups guardados, ${MB} MB no total (limite: ${KEEP})"
