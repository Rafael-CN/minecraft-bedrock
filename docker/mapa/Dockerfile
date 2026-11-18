# Mapa do mundo em 2D, navegavel no navegador.
#
# O uNmINeD le o LevelDB do Bedrock e exporta uma pagina web pronta. Roda
# em .NET, entao a base precisa de glibc - alpine nao serve aqui.
FROM debian:trixie-slim

ARG UNMINED_URL=https://unmined.net/download/unmined-cli-linux-x64-dev/

# Sem ICU: o nome do pacote muda a cada release do Debian (libicu72,
# libicu76...) e o uNmINeD nao precisa de globalizacao. O modo invariante
# do .NET dispensa a biblioteca inteira.
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl cron tzdata python3 \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/unmined \
 && curl -fsSL "$UNMINED_URL" -o /tmp/unmined.tar.gz \
 && tar -xzf /tmp/unmined.tar.gz -C /opt/unmined --strip-components=1 \
 && rm /tmp/unmined.tar.gz \
 && chmod +x /opt/unmined/unmined-cli \
 && /opt/unmined/unmined-cli --version || true

# Resource pack vanilla do Bedrock, do repositorio oficial da Mojang.
#
# Sem ele o uNmINeD nao consegue calcular a cor dos blocos que vieram dos
# addons e os desenha em rosa - foi o que encheu o mapa de manchas magenta.
# Com ele, cada bloco custom ganha a cor media da propria textura.
ARG BEDROCK_SAMPLES_URL=https://github.com/Mojang/bedrock-samples/archive/refs/heads/main.zip
RUN curl -fsSL "$BEDROCK_SAMPLES_URL" -o /opt/bedrock-samples.zip  && ls -la /opt/bedrock-samples.zip

# Tema visual (CSS + overlay) aplicado por cima do que o uNmINeD gera.
COPY tema/ /opt/tema/
COPY render.sh /usr/local/bin/render.sh
COPY enquadrar.py /usr/local/bin/enquadrar.py
COPY blocos_de_addon.py /usr/local/bin/blocos_de_addon.py
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/render.sh /usr/local/bin/entrypoint.sh /usr/local/bin/enquadrar.py /usr/local/bin/blocos_de_addon.py

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
