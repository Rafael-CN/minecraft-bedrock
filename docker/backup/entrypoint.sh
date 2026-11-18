#!/bin/bash
set -euo pipefail

: "${BACKUP_CRON:=0 5 * * *}"
: "${TZ:=America/Sao_Paulo}"

echo "[backup] fuso: $TZ"
echo "[backup] agenda: $BACKUP_CRON"
echo "[backup] guardando os $BACKUP_KEEP mais recentes em /backups"

# Repassa as variaveis para o cron, que roda com ambiente limpo.
{
  echo "SERVER_CONTAINER=${SERVER_CONTAINER}"
  echo "LEVEL_NAME=${LEVEL_NAME}"
  echo "BACKUP_KEEP=${BACKUP_KEEP}"
  echo "TZ=${TZ}"
  echo "$BACKUP_CRON /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1"
} > /etc/crontabs/root

if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  echo "[backup] rodando um backup agora (BACKUP_ON_START=true)"
  /usr/local/bin/backup.sh || echo "[backup] o backup inicial falhou"
fi

# O guarda roda ao lado do cron: um cuida da hora marcada, o outro
# vigia se o mundo continua visivel. Se o guarda morrer, o container
# inteiro cai e o restart policy levanta os dois de novo.
/usr/local/bin/guard.sh &
GUARDA=$!

echo "[backup] no ar, esperando a hora marcada"
crond -f -l 8 &
CRON=$!

wait -n "$GUARDA" "$CRON"
echo "[backup] um dos processos morreu - saindo para o docker reiniciar"
exit 1
