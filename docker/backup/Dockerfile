# Backup a quente do mundo Bedrock, agendado, rodando como container.
# Precisa do cliente docker porque manda "save hold" no container do
# servidor via docker exec - e do socket montado para isso funcionar.
FROM docker:cli

RUN apk add --no-cache bash zip coreutils tzdata

COPY backup.sh /usr/local/bin/backup.sh
COPY guard.sh /usr/local/bin/guard.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/guard.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
