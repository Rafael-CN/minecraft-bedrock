#!/bin/bash
set -euo pipefail

: "${MAP_CRON:=30 5 * * *}"
: "${TZ:=America/Sao_Paulo}"

echo "[mapa] fuso: $TZ"
echo "[mapa] agenda: $MAP_CRON"

# Repassa as variaveis para o cron, que roda com ambiente limpo.
{
  echo "LEVEL_NAME=${LEVEL_NAME}"
  echo "TZ=${TZ}"
  echo "UNMINED_EXTRA=${UNMINED_EXTRA:-}"
  echo "MAP_ZOOM_IN=${MAP_ZOOM_IN:-3}"
  echo "MAP_ZOOM_OUT_LEVELS=${MAP_ZOOM_OUT_LEVELS:-6}"
  echo "$MAP_CRON /usr/local/bin/render.sh >> /proc/1/fd/1 2>&1"
  echo ""
} > /etc/cron.d/mapa
chmod 0644 /etc/cron.d/mapa
crontab /etc/cron.d/mapa

if [ ! -f /mapa/index.html ] || [ "${MAP_ON_START:-true}" = "true" ]; then
  echo "[mapa] renderizando agora"
  /usr/local/bin/render.sh || echo "[mapa] a renderizacao inicial falhou"
fi

echo "[mapa] no ar, esperando a hora marcada"
exec cron -f
