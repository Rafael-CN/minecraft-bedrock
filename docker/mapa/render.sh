#!/bin/bash
# Renderiza o mundo em uma página web navegável, com cara de Minecraft.
#
# O mapa deixou de ser uma foto só. Cada CAMADA é uma renderização
# separada do mesmo mundo, respondendo a uma pergunta diferente:
#
#   superficie  como é o mundo visto de cima          (a de sempre)
#   caverna     o que existe debaixo do chão          (raio-x até y 50)
#   noite       onde está escuro, ou seja, onde nasce mob
#   nether      o Nether
#   end         o End
#
# A superfície continua na raiz, para todo link antigo seguir valendo; as
# outras vão para /mapa/<id>/. Um camadas.json na raiz diz quais deram
# certo, e é por ele que o painel monta o seletor - camada que não
# renderizou simplesmente não aparece, em vez de virar um botão quebrado.
set -euo pipefail

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
SAIDA="/mapa"
TRABALHO="/tmp/mapa-novo"
TEMA="/opt/tema"

log() { echo "[mapa $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# O nome que aparece na tela nunca foi o da pasta - a pasta e um id de
# diretorio ("Aether_Legends_World_Template"), cheio de sublinhado e sem
# acento. O Bedrock guarda o nome de verdade em levelname.txt dentro do
# proprio mundo; troca-se o sublinhado por espaco porque e assim que o
# jogo digita esse arquivo (sublinhado no lugar de espaco), nunca porque
# o nome tem sublinhado de verdade.
NOME_MUNDO="$(tr -d '\r\n' < "$MUNDO/levelname.txt" 2>/dev/null | tr '_' ' ')"
[ -z "$NOME_MUNDO" ] && NOME_MUNDO="$(echo "$LEVEL" | tr '_' ' ')"

# ------------------------------------------------------------ trava
# Dois renders ao mesmo tempo escrevem no mesmo /tmp/mapa-novo e um
# derruba o outro no meio - "IO_SharingViolation_File" num tile qualquer,
# e o mapa nao troca. E facil acontecer sem querer: o render do boot do
# container e o do cron, ou um render manual por cima de qualquer um dos
# dois. Quem chegar depois desiste na hora, com recado, em vez de
# estragar o trabalho de quem ja estava rodando.
exec 9>/tmp/render.lock
if ! flock -n 9; then
  log "ja existe um render em andamento - saindo sem fazer nada"
  exit 0
fi

[ -d "$MUNDO" ] || { log "ERRO: mundo nao encontrado em $MUNDO"; exit 1; }

log "renderizando '${LEVEL}' (pode levar alguns minutos)"
rm -rf "$TRABALHO"
mkdir -p "$TRABALHO"

# ------------------------------------------------ pinos e enquadramento
# Extrair pinos das bases (última HOME| de cada jogador).
# Se houver casas, calcular center para abrir o mapa centrado nelas.
CENTER_X=""
CENTER_Z=""
HOMES_JSON=$(docker logs mc-bedrock --since 168h 2>/dev/null | \
  python3 -c "
import json, re, sys
homes = {}
for line in sys.stdin:
    m = re.search(r'HOME\|([^|]+)\|([^|]+)\|(\w+)', line)
    if m:
        nome, coords_str, dim = m.groups()
        try:
            x, y, z = map(int, coords_str.split(','))
            homes[nome] = {'x': x, 'z': z}
        except: pass
print(json.dumps(homes))
" 2>/dev/null || echo "{}")

CENTROS=$(echo "$HOMES_JSON" | python3 -c "
import json, sys, statistics
homes = json.load(sys.stdin)
if homes:
    xs = [h['x'] for h in homes.values()]
    zs = [h['z'] for h in homes.values()]
    print(int(statistics.median(xs)), int(statistics.median(zs)))
" 2>/dev/null || true)
if [ -n "$CENTROS" ]; then
  CENTER_X="${CENTROS% *}"
  CENTER_Z="${CENTROS#* }"
fi

# ------------------------------------------------ blocos dos addons
# O uNmINeD pinta de rosa todo bloco que nao conhece, e os addons deste
# mundo trazem mais de mil e seiscentos - por isso o mapa tinha manchas
# magenta no lugar das construcoes. Aqui ele aprende a cor de cada um,
# deduzida do nome do bloco. Roda antes do render, a cada render, entao
# addon novo entra sozinho.
if [ -f "/usr/local/bin/blocos_de_addon.py" ]; then
  python3 /usr/local/bin/blocos_de_addon.py "$MUNDO" /opt/unmined/config/custom.blocktags.txt || log "aviso: os blocos dos addons vao sair em rosa"
fi

# O pack vanilla do Bedrock e o que destrava o calculo de cor dos blocos
# custom: sem ele o uNmINeD nem tenta, e pinta de rosa tudo que os addons
# trouxeram. Se o arquivo faltar, o render continua - so volta o rosa.
PACK_VANILLA=""
if [ -f /opt/bedrock-samples.zip ]; then
  PACK_VANILLA="--bedrock-vanilla-pack=/opt/bedrock-samples.zip"
else
  log "aviso: pack vanilla ausente - blocos de addon vao sair em rosa"
fi

# ------------------------------------------------ as camadas
#
# Formato: id|rótulo|argumentos extras do uNmINeD
#
# A ordem aqui é a ordem do seletor no painel, e ela é deliberada: começa
# no que você vê andando, desce para o que está escondido, e só depois vai
# para as outras dimensões.
#
# --gndxray é o que faz a caverna aparecer: sem ele o teto tapa tudo, e
# ele precisa do "=true" - sem o valor o uNmINeD recusa a linha inteira.
#
# São duas fatias de altura em vez de uma régua contínua: renderizar 320
# alturas custaria horas e ninguém olha 320 mapas. "Cavernas" corta em
# y 50, que é onde mina e dungeon vivem; "Fundo" corta em y 0, que é a
# faixa do deepslate e do diamante.
#
# Nether e End só aparecem depois que alguém for lá: enquanto o mundo não
# tiver chunk gerado nessas dimensões o uNmINeD recusa, a camada é pulada,
# e ela entra sozinha no próximo render do dia em que a viagem acontecer.
CAMADAS_PADRAO="superficie|Superfície|
caverna|Cavernas|--gndxray=true --topY=50
profundo|Fundo|--gndxray=true --topY=0
noite|Noite|--night=true
nether|Nether|--dimension=nether --topY=100
end|End|--dimension=end"

CAMADAS="${MAP_CAMADAS:-$CAMADAS_PADRAO}"

# --zoomin=3   : deixa aproximar até 8x (1 bloco = 8 px). Sem isso o zoom
#                parava em 1:1 e dava a impressão de "não zooma".
# --shadows=3d : relevo com sombra - montanha parece montanha.
# --blockrender: nos níveis mais próximos desenha o modelo do bloco em vez
#                de um pixel chapado.
# --players    : posição de quem entrou no servidor.
# webp lossy   : bem mais nítido que o jpeg padrão pelo mesmo tamanho.
# O mundo está montado como :ro - o render nunca escreve nele.
BASE_ARGS="$PACK_VANILLA --world=$MUNDO --zoomin=${MAP_ZOOM_IN:-3} --zoomout=${MAP_ZOOM_OUT_LEVELS:-6}"
BASE_ARGS="$BASE_ARGS --shadows=3d --blockrender=true --players"
BASE_ARGS="$BASE_ARGS --imageformat=webp --webp-format=lossy --webp-quality=85 --background=#1a1611"
[ -n "$CENTER_X" ] && BASE_ARGS="$BASE_ARGS --centerx=$CENTER_X"
[ -n "$CENTER_Z" ] && BASE_ARGS="$BASE_ARGS --centerz=$CENTER_Z"

# Acaba na lista as que renderizaram de verdade.
PRONTAS=""

renderizar_camada() {
  local id="$1" rotulo="$2" extras="$3"
  local destino
  if [ "$id" = "superficie" ]; then destino="$TRABALHO"; else destino="$TRABALHO/$id"; fi
  mkdir -p "$destino"

  log "camada '$id' ($rotulo)"
  # shellcheck disable=SC2086
  if ! /opt/unmined/unmined-cli web render $BASE_ARGS --output="$destino" $extras ${UNMINED_EXTRA:-} >/tmp/render-$id.log 2>&1; then
    log "aviso: a camada '$id' falhou - o mapa segue sem ela"
    tail -3 "/tmp/render-$id.log" | sed 's/^/         /'
    rm -rf "$destino"
    return 1
  fi

  # Camada sem nenhum tile é dimensão que este mundo não tem (End nunca
  # visitado, por exemplo). Não vira botão: vira nada.
  if [ ! -d "$destino/tiles" ] || [ -z "$(find "$destino/tiles" -name '*.webp' -print -quit 2>/dev/null)" ]; then
    log "camada '$id' saiu vazia - este mundo nao tem essa parte ainda"
    [ "$id" = "superficie" ] || rm -rf "$destino"
    return 1
  fi

  aplicar_tema "$destino" "$id" "$rotulo"
  PRONTAS="$PRONTAS$id|$rotulo"$'\n'
  return 0
}

# ------------------------------------------------------------ tema
# O uNmINeD gera um index.html seco. O tema entra como CSS e um overlay
# por cima, mais o mine.js que faz a ponte com o painel.
aplicar_tema() {
  local dir="$1" id="$2" rotulo="$3"
  local index="$dir/index.html"
  [ -f "$index" ] || return 0
  [ -d "$TEMA" ] || return 0

  cp "$TEMA/mine.css" "$dir/mine.css"
  cp "$TEMA/mine.js"  "$dir/mine.js"
  # python3 em vez de sed: o overlay tem & e | que o sed trata como
  # especiais, e escapar isso na mão foi o que quebrou da última vez.
  # Só o nome do mundo vai para a placa - a camada agora é o seletor,
  # não um parênteses colado no nome.
  python3 "$TEMA/aplicar.py" "$index" "$TEMA" "$NOME_MUNDO"

  # O uNmINeD sempre abre em (0,0) com zoom 0, e mede o mundo incluindo
  # qualquer chunk perdido. Este mundo tem um a 400 mil blocos daqui, o que
  # fazia o painel abrir numa tela preta com o mundo fora do quadro. O
  # enquadrar.py le os tiles recem-gerados, descarta as ilhas distantes e
  # escreve centro e zoom que mostram o mundo de verdade ao abrir.
  if [ -f "/usr/local/bin/enquadrar.py" ]; then
    python3 /usr/local/bin/enquadrar.py "$dir" "${MAP_LARGURA_REF:-1600}" || \
      log "aviso: nao consegui enquadrar a camada '$id'"
  fi

  gerar_marcadores "$dir"
}

# ------------------------------------------------------------ marcadores
# O uNmINeD lê custom.markers.js na inicialização; se o arquivo sair
# inválido ou com zero bytes, o mapa inteiro fica em branco. Então ele é
# sempre reescrito do zero, na estrutura exata que o uNmINeD espera.
gerar_marcadores() {
  local dir="$1"
  python3 - "$dir/custom.markers.js" "${HOMES_JSON:-}" <<'PYEOF' || log "AVISO: falha ao gerar markers em $1"
import json, os, sys
alvo, fonte = sys.argv[1], sys.argv[2]
homes = {}
try:
    homes = json.loads(fonte) if fonte else {}
except Exception:
    homes = {}
if not isinstance(homes, dict):
    homes = {}

marcadores = []
for nome, c in homes.items():
    try:
        marcadores.append({
            "x": int(c["x"]), "z": int(c["z"]),
            "image": "custom.pin.png", "imageAnchor": [0.5, 1], "imageScale": 0.5,
            "text": f"Base de {nome}", "textColor": "#ffff55",
            "offsetX": 0, "offsetY": 22,
            "font": "bold 16px 'Pixelify Sans', sans-serif",
        })
    except Exception:
        pass

corpo = "UnminedCustomMarkers = " + json.dumps(
    {"isEnabled": bool(marcadores), "markers": marcadores},
    ensure_ascii=False, indent=2) + ";\n"

tmp = alvo + ".novo"
open(tmp, "w", encoding="utf-8").write(corpo)
# Só substitui se o que foi escrito é válido - nunca deixa 0 bytes para trás.
if os.path.getsize(tmp) > 0 and "UnminedCustomMarkers" in open(tmp, encoding="utf-8").read():
    os.replace(tmp, alvo)
else:
    os.remove(tmp)
    raise SystemExit("gerado invalido, arquivo original mantido")
PYEOF
}

# ------------------------------------------------------------ rodar
while IFS='|' read -r id rotulo extras; do
  [ -z "$id" ] && continue
  renderizar_camada "$id" "$rotulo" "$extras" || true
done <<< "$CAMADAS"

# A superfície é a única obrigatória: sem ela não há mapa nenhum, e trocar
# o que está servindo por uma pasta vazia seria pior do que não trocar.
if [ ! -f "$TRABALHO/index.html" ]; then
  log "ERRO: a camada de superficie nao saiu - o mapa antigo continua no ar"
  rm -rf "$TRABALHO"
  exit 1
fi

# ------------------------------------------------------------ camadas.json
# O painel lê isto para montar o seletor. Só entra o que existe.
python3 - "$TRABALHO/camadas.json" "$PRONTAS" <<'PYEOF'
import json, sys
alvo, cru = sys.argv[1], sys.argv[2]
camadas = []
for linha in cru.splitlines():
    if not linha.strip():
        continue
    id, _, rotulo = linha.partition("|")
    camadas.append({
        "id": id,
        "rotulo": rotulo or id,
        # A superfície mora na raiz; as outras, numa pasta com o id delas.
        "caminho": "" if id == "superficie" else id + "/",
    })
json.dump({"camadas": camadas}, open(alvo, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"camadas.json: {len(camadas)} camada(s)")
PYEOF

# Troca só no fim: se a renderização falhar no meio, o mapa antigo continua
# servindo em vez de virar uma página quebrada.
mkdir -p "$SAIDA"
find "$SAIDA" -mindepth 1 -delete 2>/dev/null || true
cp -a "$TRABALHO/." "$SAIDA/"
rm -rf "$TRABALHO" 2>/dev/null || true

TAM="$(du -sm "$SAIDA" | cut -f1)"
QUANTAS="$(printf '%s' "$PRONTAS" | grep -c . || true)"
log "mapa pronto - ${QUANTAS} camada(s), ${TAM} MB - recarregue a pagina"
