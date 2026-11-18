#!/usr/bin/env python3
"""
Aplica o tema no index.html gerado pelo uNmINeD.

Faz quatro coisas, todas estáticas: injeta o <link> do CSS no <head>, o
overlay HTML e o script do fundo antes de </body>, troca o marcador do
nome do mundo na placa, e troca o título da aba. Não toca no JavaScript
do mapa - a tentativa de mexer no zoom por script deixou o comportamento
errático, então o tema fica na casca e o OpenLayers segue intacto.
"""
import json
import sys

index, tema_dir, nome_mundo = sys.argv[1], sys.argv[2], sys.argv[3]

html = open(index, encoding="utf-8").read()
overlay = open(f"{tema_dir}/overlay.html", encoding="utf-8").read()

head = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Pixelify+Sans:wght@400;600;700&display=swap">'
    '<link rel="stylesheet" href="mine.css">'
    "</head>"
)
# Carregar mine.js (tema + atualização de jogadores ao vivo)
# custom.markers.js é carregado pelo uNmINeD no head
corpo = overlay.replace("__NOME_DO_MUNDO__", nome_mundo) + \
    '<script src="mine.js"></script></body>'

html = html.replace("</head>", head, 1)
html = html.replace("</body>", corpo, 1)

# O uNmINeD escreve o próprio título da aba com o nome que ele leu do
# level.dat, sempre seguido de " - uNmINeD" - técnico demais para uma
# aba que o irmão do Rafael pode abrir no celular. Troca pelo nome
# limpo que já usamos na placa.
titulo_original = 'document.title = UnminedMapProperties.worldName + " - " + document.title;'
titulo_novo = "document.title = " + json.dumps(nome_mundo, ensure_ascii=False) + ";"
if titulo_original in html:
    html = html.replace(titulo_original, titulo_novo, 1)
else:
    print("aviso: nao achei a linha do titulo do uNmINeD - a aba fica com o nome tecnico")

# O uNmINeD guarda a instancia do mapa numa const dentro do script inline,
# fora do alcance de qualquer outro arquivo. Sem ela nao da para desenhar
# os jogadores ao vivo: a camada de marcadores so existe ali dentro.
# Publicar a instancia em window e a mudanca minima que abre essa porta -
# e se um dia a linha mudar de forma, o replace nao acha, ninguem quebra,
# e o mapa simplesmente segue sem jogadores.
antes = "const unmined = new Unmined("
if antes in html:
    html = html.replace(antes, "window.unmined = new Unmined(", 1)
else:
    print("aviso: nao achei a criacao do mapa - jogadores ao vivo ficam de fora")

open(index, "w", encoding="utf-8").write(html)
print("tema aplicado")
