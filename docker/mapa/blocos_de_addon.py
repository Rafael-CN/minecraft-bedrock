#!/usr/bin/env python3
"""
Ensina ao uNmINeD as cores dos blocos que vieram dos addons.

O renderizador conhece os blocos do jogo, e pinta de rosa tudo que nao
reconhece. Os addons deste mundo trazem mais de dois mil blocos - cadeiras,
mesas, vitrais, folhagens - e por isso pedacos inteiros do mapa saiam
magenta, como se fossem terreno alienigena.

O uNmINeD resolve isso com um arquivo de tags: dizendo que
`cc:acacia_chair` e `#wood`, ele pinta a cadeira com a cor de madeira do
mapa. Escrever isso a mao para dois mil blocos nao e trabalho de gente,
entao aqui a gente deduz a tag pelo NOME do bloco - que nos addons segue
a mesma convencao do jogo (`_planks`, `_leaves`, `_stone`, `_glass`).

O que nao casar com regra nenhuma fica com `#stone`, que e cinza discreto:
melhor um telhado cinza no mapa do que uma mancha rosa gritante.

Uso: blocos_de_addon.py <pasta do mundo> <arquivo de saida>
"""
import json
import os
import re
import sys

# Ordem importa: a primeira regra que casar decide. As mais especificas
# vem antes - "dark_oak_leaves" tem que virar folha, nao madeira.
REGRAS = [
    # folhagem e plantas
    (r"(leaves|foliage|canopy)", "#leaves, #natural"),
    (r"(sapling|seedling|bush|shrub)", "#bush, #flora"),
    (r"(flower|rose|tulip|daisy|orchid|lilac|peony|dandelion|poppy)", "#flower, #flora"),
    (r"(vine|creeper_plant|ivy|hanging)", "#vine, #flora"),
    (r"(grass|fern|sprout)", "#grass, #flora"),
    (r"(crop|wheat|carrot|potato|beet|corn|rice)", "#crops, #flora"),
    (r"(mushroom|fungus|shroom)", "#mushroom, #flora"),
    (r"(kelp|seagrass|coral)", "#seagrass, #natural"),
    (r"(lily|lilypad)", "#lilypad, #flora"),
    (r"(cactus|bamboo|sugar_cane)", "#flora, #green"),
    (r"(seed|sapling)", "#crops, #flora"),
    (r"(apple|banana|berry|melon|pumpkin|fruit|grape|orange_tree)", "#fruit, #flora"),
    (r"(feast|meal|pie|cake|bread|stew|soup|salad|sushi|steak|meat|"
     r"beef|pork|chicken|fish|cheese)", "#cake, #artificial"),

    # madeira - os moveis do Core Craft caem quase todos aqui
    (r"(_log|_stem|_wood$|_bark|stripped_)", "#log, #wood"),
    (r"(plank|chair|table|stool|bench|desk|shelf|counter|cabinet|drawer|"
     r"wardrobe|couch|sofa|crate|barrel|chest|ladder|scaffold)", "#planks, #wood"),
    (r"(_door|_trapdoor|_gate|_fence|_sign|_post)", "#wood, #artificial"),

    # pedra e derivados
    (r"(deepslate)", "#deepslate, #stone"),
    (r"(blackstone|basalt|obsidian)", "#blackstone, #stone"),
    (r"(sandstone)", "#sandstone, #stone"),
    (r"(_sand$|sand_)", "#sand"),
    (r"(gravel|pebble|rubble)", "#gravel"),
    (r"(dirt|soil|mud|loam)", "#dirt, #ground"),
    (r"(clay|adobe)", "#clay"),
    (r"(brick)", "#bricks, #artificial"),
    (r"(terracotta)", "#terracotta, #artificial"),
    (r"(concrete)", "#concrete, #artificial"),
    (r"(cobble)", "#cobblestone, #stone"),
    (r"(granite)", "#granite, #stone"),
    (r"(andesite)", "#andesite, #stone"),
    (r"(diorite)", "#diorite, #stone"),
    (r"(_ore$|_ore_)", "#ore, #stone"),
    (r"(quartz)", "#quartz, #stone"),
    (r"(prismarine)", "#prismarine, #stone"),
    (r"(netherrack|nether_)", "#netherrack"),
    (r"(end_stone|endstone|purpur)", "#end_stone"),

    # vidro, metal, tecido
    (r"(glass|window|pane)", "#glass, #artificial"),
    (r"(wool|cloth|fabric|cushion|pillow|curtain|rug|banner)", "#wool, #artificial"),
    (r"(carpet|mat$)", "#carpet, #artificial"),
    (r"(iron|steel|metal|copper|bronze|chain)", "#metal, #artificial"),
    (r"(gold|golden)", "#metal, #yellow"),

    # luz e fogo
    (r"(torch|lantern|lamp|candle|chandelier|sconce|glow)", "#torch, #light"),
    (r"(campfire|fire|ember|forge|furnace)", "#fire"),
    (r"(magma|lava)", "#lava"),

    # agua, gelo, neve
    (r"(water|fountain|aquarium)", "#water"),
    (r"(ice|frost|frozen)", "#ice"),
    (r"(snow)", "#snow"),

    # mobilia e decoracao que sobrou
    (r"(bed$|_bed)", "#bed, #artificial"),
    (r"(stair)", "#stairs, #artificial"),
    (r"(slab)", "#slab, #artificial"),
    (r"(wall$|_wall)", "#wall, #artificial"),
    (r"(fence)", "#fence, #artificial"),
    (r"(pot|vase|planter)", "#potted, #artificial"),
    (r"(moss|lichen)", "#moss, #green"),
    (r"(sculk)", "#sculk"),
    (r"(amethyst|crystal|gem)", "#crystal"),
]

# Cores no nome viram tag de cor junto com a tag principal: um
# "cc:red_cushion" fica vermelho em vez de um bege generico.
CORES = [
    "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink",
    "gray", "light_gray", "cyan", "purple", "blue", "brown", "green",
    "red", "black", "silver",
]

# Sem regra nenhuma: cinza de pedra. Discreto, some no mapa - que e
# exatamente o oposto do rosa, que gritava.
PADRAO = "#stone"


def blocos_dos_packs(raizes):
    """Identificadores de bloco declarados nos behavior packs."""
    achados = set()
    for raiz in raizes:
        if not os.path.isdir(raiz):
            continue
        for base, _, arquivos in os.walk(raiz):
            if os.sep + "loot_tables" in base or os.sep + "recipes" in base:
                continue
            for nome in arquivos:
                if not nome.endswith(".json"):
                    continue
                caminho = os.path.join(base, nome)
                try:
                    with open(caminho, encoding="utf-8", errors="ignore") as f:
                        texto = f.read(3000)
                except OSError:
                    continue
                if '"minecraft:block"' not in texto:
                    continue
                # O identifier que interessa e o da descricao do bloco, nao
                # o de um componente qualquer que apareca antes.
                m = re.search(
                    r'"description"\s*:\s*\{[^}]*?"identifier"\s*:\s*"([a-z0-9_]+:[a-z0-9_]+)"',
                    texto, re.S,
                )
                if m:
                    achados.add(m.group(1))
    return sorted(achados)


def tags_para(nome):
    curto = nome.split(":", 1)[1] if ":" in nome else nome
    for padrao, tags in REGRAS:
        if re.search(padrao, curto):
            base = tags
            break
    else:
        base = PADRAO
    for cor in CORES:
        if re.search(r"(^|_)" + cor + r"(_|$)", curto):
            base += ", #" + cor
            break
    return base


def main():
    mundo = sys.argv[1] if len(sys.argv) > 1 else "/data/worlds"
    saida = sys.argv[2] if len(sys.argv) > 2 else "/opt/unmined/config/custom.blocktags.txt"

    raizes = [os.path.join(mundo, "behavior_packs"), os.path.join(mundo, "resource_packs")]
    blocos = [b for b in blocos_dos_packs(raizes) if not b.startswith("minecraft:")]

    if not blocos:
        print("blocos de addon: nenhum encontrado - o arquivo de tags fica como esta")
        return 0

    linhas = [
        "// Gerado por blocos_de_addon.py - NAO EDITE A MAO.",
        "//",
        "// Cada bloco que os addons trazem recebe aqui a tag que mais combina",
        "// com o nome dele, para o uNmINeD pintar no mapa como pintaria o",
        "// equivalente do jogo. Sem isto o renderizador nao reconhece o bloco",
        "// e o desenha em rosa, o que enchia o mapa de manchas magenta.",
        "//",
        f"// {len(blocos)} blocos de addon neste mundo.",
        "",
    ]
    por_tag = {}
    for b in blocos:
        por_tag.setdefault(tags_para(b), []).append(b)

    for tags in sorted(por_tag, key=lambda t: -len(por_tag[t])):
        nomes = sorted(por_tag[tags])
        linhas.append(f"// {len(nomes)} blocos")
        # Uma linha por bloco: e mais longa, mas fica obvio de ler e de
        # corrigir na mao quando algum bloco cair na tag errada.
        for n in nomes:
            linhas.append(f"{n} = {tags}")
        linhas.append("")

    with open(saida, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas))

    resumo = sorted(por_tag.items(), key=lambda x: -len(x[1]))[:5]
    print(f"blocos de addon: {len(blocos)} etiquetados em {len(por_tag)} grupos")
    for tags, nomes in resumo:
        print(f"  {len(nomes):5d}  {tags}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
