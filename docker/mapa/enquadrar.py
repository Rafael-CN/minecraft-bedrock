#!/usr/bin/env python3
"""
Corrige o enquadramento inicial do mapa.

O problema: o uNmINeD abre o mapa em centerX=0, centerZ=0, defaultZoom=0,
e calcula minRegion/maxRegion a partir de TODA regiao que existe no
mundo. Basta um chunk perdido a 400 mil blocos de distancia - um portal
mal fechado, um /tp antigo - para o alcance do mapa virar meio milhao de
blocos. O Rafael abria o painel e via preto: o mundo de verdade estava
ali, so que fora do quadro e no zoom errado.

A correcao nao chuta nada: le os tiles que o proprio uNmINeD acabou de
gerar no zoom 0, joga fora as ilhas de tiles distantes do grosso, e
escreve centro e zoom que enquadram o que sobrou. Roda depois do render
e antes do tema, e por isso sobrevive a cada nova renderizacao.

Uso: enquadrar.py <pasta do mapa> [largura de referencia em pixels]
"""
import math
import os
import re
import sys

# Um tile do uNmINeD tem 256 pixels de lado, e no zoom 0 um pixel e um
# bloco. Cada nivel de zoom negativo dobra quantos blocos cabem no pixel.
LADO_DO_TILE = 256

# Distancia, em tiles, que separa duas ilhas de mapa. Chunks isolados
# costumam estar a milhares de tiles; o mundo em que se joga e continuo.
SALTO_DE_ILHA = 16


def ler_tiles(pasta_zoom0):
    """Devolve os pares (x, y) de todos os tiles do zoom 0."""
    achados = []
    padrao = re.compile(r"^tile\.(-?\d+)\.(-?\d+)\.")
    for base, _, arquivos in os.walk(pasta_zoom0):
        for nome in arquivos:
            m = padrao.match(nome)
            if m:
                achados.append((int(m.group(1)), int(m.group(2))))
    return achados


def maior_ilha(valores):
    """Corta a sequencia onde ha um salto grande e devolve o maior pedaco.

    Ordena os valores unicos e quebra a lista sempre que dois vizinhos
    estao longe demais para pertencerem ao mesmo mapa. Entre os pedacos,
    ganha o que cobre mais tiles - o mundo onde se joga de verdade.
    """
    unicos = sorted(set(valores))
    if not unicos:
        return None
    ilhas, atual = [], [unicos[0]]
    for anterior, seguinte in zip(unicos, unicos[1:]):
        if seguinte - anterior > SALTO_DE_ILHA:
            ilhas.append(atual)
            atual = []
        atual.append(seguinte)
    ilhas.append(atual)

    contagem = {v: valores.count(v) for v in unicos}
    return max(ilhas, key=lambda ilha: sum(contagem[v] for v in ilha))


def ensinar_zoom(mapa):
    """Faz o unmined.js respeitar o nivel de zoom que gravamos.

    O arquivo abre a visao com 'zoom: mapZoomLevels - maxZoom', um valor
    fixo que sempre da o mesmo nivel, independente do tamanho do mundo.
    Aqui esse trecho passa a preferir 'startZoomLevel' quando ele existe,
    e continua igualzinho quando nao existe - se o uNmINeD mudar essa
    linha numa versao futura, o patch nao casa, ninguem quebra, e o mapa
    volta a abrir no padrao dele.
    """
    caminho = os.path.join(mapa, "unmined.js")
    if not os.path.isfile(caminho):
        return
    codigo = open(caminho, encoding="utf-8").read()
    if "startZoomLevel" in codigo:
        return  # ja ensinado neste arquivo
    alvo = "zoom: mapZoomLevels - this.#options.maxZoom"
    if alvo not in codigo:
        print("enquadrar: o unmined.js mudou de forma - zoom de abertura fica no padrao dele")
        return
    troca = (
        'zoom: (typeof this.#options.startZoomLevel === "number" '
        "? this.#options.startZoomLevel : mapZoomLevels - this.#options.maxZoom)"
    )
    open(caminho, "w", encoding="utf-8").write(codigo.replace(alvo, troca, 1))


def main():
    if len(sys.argv) < 2:
        print("uso: enquadrar.py <pasta do mapa> [largura de referencia]")
        return 1
    mapa = sys.argv[1]
    largura_ref = int(sys.argv[2]) if len(sys.argv) > 2 else 1600

    propriedades = os.path.join(mapa, "unmined.map.properties.js")
    zoom0 = os.path.join(mapa, "tiles", "zoom.0")
    if not os.path.isfile(propriedades) or not os.path.isdir(zoom0):
        print("enquadrar: nada a fazer (sem propriedades ou sem tiles no zoom 0)")
        return 0

    tiles = ler_tiles(zoom0)
    if not tiles:
        print("enquadrar: nenhum tile no zoom 0")
        return 0

    xs = [x for x, _ in tiles]
    ys = [y for _, y in tiles]
    ilha_x = maior_ilha(xs)
    ilha_y = maior_ilha(ys)
    if not ilha_x or not ilha_y:
        print("enquadrar: nao consegui separar as ilhas de tiles")
        return 0

    # O tile (0,0) cobre os blocos 0..255, entao o lado direito do
    # ultimo tile e (max + 1) * 256.
    centro_x = int((min(ilha_x) + max(ilha_x) + 1) / 2 * LADO_DO_TILE)
    centro_z = int((min(ilha_y) + max(ilha_y) + 1) / 2 * LADO_DO_TILE)
    largura_blocos = (max(ilha_x) - min(ilha_x) + 1) * LADO_DO_TILE
    altura_blocos = (max(ilha_y) - min(ilha_y) + 1) * LADO_DO_TILE

    texto = open(propriedades, encoding="utf-8").read()

    def valor(chave, padrao):
        m = re.search(chave + r"\s*:\s*(-?\d+)", texto)
        return int(m.group(1)) if m else padrao

    zoom_min, zoom_max = valor("minZoom", -6), valor("maxZoom", 3)

    # Quantos blocos precisam caber em cada pixel para o mundo inteiro
    # aparecer, e quantas vezes esse numero precisa dobrar a partir de 1.
    blocos_por_pixel = max(largura_blocos, altura_blocos) / max(1, largura_ref)
    zoom = 0 if blocos_por_pixel <= 1 else -math.ceil(math.log2(blocos_por_pixel))
    zoom = max(zoom_min, min(zoom_max, zoom))

    novo = texto
    for chave, valor_novo in (("centerX", centro_x), ("centerZ", centro_z), ("defaultZoom", zoom)):
        novo, trocas = re.subn(
            r"(" + chave + r"\s*:\s*)-?\d+", r"\g<1>" + str(valor_novo), novo, count=1
        )
        if not trocas:
            print(f"enquadrar: nao achei '{chave}' - arquivo deixado como estava")
            return 0

    # 'defaultZoom' e decorativo: nenhuma linha do unmined.js le esse campo.
    # Quem manda no zoom de abertura e o proprio unmined.js, que calcula um
    # nivel do OpenLayers. Entao gravamos tambem o nivel ja convertido e,
    # logo abaixo, ensinamos o unmined.js a usa-lo.
    nivel_ol = zoom - zoom_min
    if "startZoomLevel" in novo:
        novo = re.sub(r"(startZoomLevel\s*:\s*)-?\d+", r"\g<1>" + str(nivel_ol), novo, count=1)
    else:
        novo = re.sub(r"(defaultZoom\s*:\s*-?\d+)", r"\1,\n    startZoomLevel: " + str(nivel_ol), novo, count=1)

    open(propriedades, "w", encoding="utf-8").write(novo)
    ensinar_zoom(mapa)
    descartados = len(set(xs)) - len(ilha_x)
    print(
        f"enquadrar: centro ({centro_x}, {centro_z}), zoom {zoom}, "
        f"mundo de {largura_blocos}x{altura_blocos} blocos"
        + (f", {descartados} coluna(s) de tiles perdidas descartadas" if descartados else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
