# Servidor Minecraft Bedrock no Docker

Servidor dedicado de Bedrock (a versão de celular/console/Windows 10-11) rodando
no seu Docker, com um jeito automatizado de instalar addons.

---

## Antes de tudo: "mods" no Bedrock

Vale ajustar a expectativa, porque isso economiza horas de frustração:

**Bedrock não tem mods.** Não existe Forge, Fabric, nem `.jar` — aquilo é do
Minecraft Java. O que o Bedrock tem são **Add-Ons**, que são pacotes de dados
oficialmente suportados. Na prática dá pra fazer muita coisa (mobs novos, itens,
blocos, receitas, mecânicas via script), mas dentro do que a Mojang expõe.

Um Add-On é feito de até duas metades:

| Metade | Extensão típica | O que faz | Onde precisa estar |
|---|---|---|---|
| **Behavior Pack** (BP) | `.mcpack` | comportamento: mobs, loot, receitas, scripts | **no servidor** |
| **Resource Pack** (RP) | `.mcpack` | aparência: texturas, modelos, sons, nomes | **no servidor**, e o cliente baixa sozinho |

E os outros formatos que você vai encontrar:

- **`.mcaddon`** — um zip com vários `.mcpack` dentro (o BP e o RP juntos). Muito comum.
- **`.mcworld`** — um mundo inteiro exportado, já com os addons dele embutidos.
- **`.mctemplate`** — template de mundo. Para o servidor é a mesma coisa que um
  `.mcworld`: uma pasta de mundo dentro de um zip.

Detalhe importante: os três formatos são **zip renomeado**. Se quiser espiar o
conteúdo, troque a extensão para `.zip` e abra.

---

## Regras operacionais importantes

### Nunca use `docker compose down` direto

O comando `docker compose down` direto **derruba e remove todos os containers, redes e
volumes nomeados**. Não é seguro mesmo que o compose esteja em pasta diferente.
Se rodar em intervalo curto (e o autoheal tentar reiniciar no meio), pode derrubá-lo
mapa, mapa-render e autoheal — deixando o servidor rodando num mundo que não existe,
durante minutos, até alguém notar.

**Para parar o servidor, use:**

```
.\scripts\mc.ps1 down
```

Esse script chama `stop` + `down` de forma controlada. Se precisar apenas parar sem
remover, use `docker compose stop -t 120`. Se precisar recriar um container:

```
docker compose up -d --force-recreate <serviço>
```

### Procure todos os usos antes de remover `env`

Se mudar uma variável que outro lugar do código lê, procure **todas** as referências
antes de apagá-la ou renomear. Exemplo de 02/09: um agente removeu `LEVEL_NAME`
do compose de `bedrock`, sem notar que o `healthcheck` também usava. Resultado: o
servidor ficou `unhealthy` e o autoheal começou a reiniciar em loop.

Sempre rode antes de mudar:

```
grep -rn LEVEL_NAME docker-compose.yml docker/ scripts/ .env
```

---

## Ligando

Tudo se faz por um script só, na raiz desta pasta:

```powershell
.\scripts\mc.ps1 up
```

O primeiro boot baixa o servidor Bedrock (uns 240 MB) e gera o mundo. Leva
1–2 minutos. Acompanhe:

```powershell
.\scripts\mc.ps1 logs
```

Quando aparecer `Server started.` está no ar.

Comandos disponíveis:

| Comando | Para quê |
|---|---|
| `mc.ps1 up` | sobe tudo (servidor, backup, vigia, painel, mapa) |
| `mc.ps1 down` | para |
| `mc.ps1 restart` | reinicia — use depois de mexer no `.env` ou instalar addon |
| `mc.ps1 status` | no ar? quantos jogadores? backups em dia? |
| `mc.ps1 logs` | log ao vivo |
| `mc.ps1 cmd "list"` | manda um comando e mostra a resposta |
| `mc.ps1 console` | console do servidor (sair: `Ctrl+P`, `Ctrl+Q`) |
| `mc.ps1 painel` | abre o painel de controle |
| `mc.ps1 mapa` | abre o mapa do mundo |
| `mc.ps1 addons` | instala o que estiver na pasta `addons\` |
| `mc.ps1 world` | abre a pasta do mundo no Explorer |
| `mc.ps1 backup` | backup a quente agora |
| `mc.ps1 restore` | volta um backup |
| `mc.ps1 teste up` | sobe a bancada de testes |
| `mc.ps1 ip` | endereços para conectar |
| `mc.ps1 update` | atualiza as imagens |

No `console`, os comandos vão **sem a barra**: `list`, `op SeuGamertag`,
`gamerule keepInventory true`. E para sair do console **use `Ctrl+P` seguido de
`Ctrl+Q`** — `Ctrl+C` ali dentro mata o servidor.

---

## Conectando

```powershell
.\scripts\mc.ps1 ip
```

No Minecraft: **Jogar → Servidores → Adicionar servidor**, e coloque o IP com a
porta `19132`.

- **No seu PC:** `127.0.0.1`.
- **Celular/console na mesma casa:** o IP da rede local (ex.: `192.168.1.100`).
- **Amigo de fora:** **você já tem Tailscale instalado** — é de longe o melhor
  caminho. O amigo instala o Tailscale, você compartilha a máquina com ele, e
  ele conecta no seu IP `100.x.x.x` porta 19132. Ninguém precisa abrir porta no
  roteador, e o servidor não fica exposto à internet.

  A alternativa é port forward **UDP 19132** no roteador, que deixa o servidor
  visível pra internet inteira. Se for por esse caminho, ligue a allow list
  (abaixo) — servidor Bedrock aberto é varrido por bot em questão de horas.

Se quiser trancar o servidor a uma lista de pessoas, no `.env`:

```
ALLOW_LIST=true
ALLOW_LIST_USERS=SeuGamertag,GamertagDoAmigo
```

---

## Instalando seus addons — o caminho curto

1. Jogue os arquivos (`.mcpack`, `.mcaddon`, `.mcworld`, `.mctemplate`) dentro da
   pasta **`addons\`**.
2. Rode:

```powershell
.\scripts\mc.ps1 addons
```

3. Reinicie:

```powershell
.\scripts\mc.ps1 restart
```

4. Confira no log se carregou:

```powershell
.\scripts\mc.ps1 logs
```

O script abre cada arquivo, lê o `manifest.json` de dentro pra descobrir se
aquilo é behavior ou resource pack, copia pra dentro da pasta do mundo e
registra na lista de packs ativos. Ele também avisa quando falta a outra metade
de um addon, e quando um pack usa script (que costuma exigir experimento ligado
— veja abaixo).

Reinstalar por cima, sobrescrevendo:

```powershell
.\scripts\mc.ps1 addons -Force
```

Instalar um arquivo solto sem copiar pra pasta `addons\`:

```powershell
.\scripts\Install-Addons.ps1 -File "C:\Downloads\SeuAddon.mcaddon"
```

---

## O que acontece por baixo (vale saber pra depurar)

O script coloca os packs **dentro da pasta do mundo**, não na raiz do servidor:

```
data\worlds\Bedrock level\
├── level.dat
├── behavior_packs\
│   └── Mobs_Novos_a1b2c3d4\      <- o pack copiado
├── resource_packs\
│   └── Mobs_Novos_e5f6a7b8\
├── world_behavior_packs.json     <- a LISTA do que está ligado
└── world_resource_packs.json
```

Ter o pack na pasta **não liga o pack**. Quem liga é o `world_*_packs.json`, um
arquivo assim:

```json
[
  {
    "pack_id": "11111111-2222-3333-4444-555555555555",
    "version": [1, 2, 3]
  }
]
```

O `pack_id` é o `header.uuid` do `manifest.json` do pack, e o `version` tem que
bater com o `header.version`. Se um dos dois estiver errado, o servidor
simplesmente ignora o pack em silêncio — é a causa nº 1 de "instalei e não
aconteceu nada". O script cuida disso pra você, mas agora você sabe onde olhar.

Por que dentro do mundo e não na raiz do servidor? Porque assim o mundo fica
autocontido: sobrevive a atualização do servidor, dá pra fazer backup levando
os addons junto, e dá pra exportar como `.mcworld` completo.

Na lista de resource packs, **a ordem importa**: quando dois packs mexem na mesma
textura ou modelo, **o último da lista vence**. Se alguma coisa aparecer com a
textura errada no jogo, mova o pack que você quer que ganhe para o fim do
`world_resource_packs.json`.

---

## Experimentos — a pegadinha que pega todo mundo

Muitos addons (praticamente todos que usam script, e vários com blocos/itens
customizados) exigem que o mundo tenha um **experimento ligado** — normalmente
**"Beta APIs"**, às vezes "Holiday Creator Features" ou "Custom Biomes".

O problema: **experimento é uma flag gravada dentro do `level.dat`**, um arquivo
binário. Não tem linha no `server.properties` que ligue isso. Se o addon precisa
de experimento e o mundo não tem, o servidor sobe normalmente e o addon
simplesmente não funciona.

**Este servidor já tem Beta APIs ligado.** Se você trouxer um novo mundo
(`.mcworld`) que não tenha, vai precisar ligá-lo.

### Como ligar Beta APIs

**Jeito 1 — trazer o mundo pronto do jogo (recomendado):**

1. No Minecraft (celular ou PC), crie um mundo novo.
2. Nas configurações do mundo, vá em **Experimentos** e ligue o que o addon pede.
3. Salve, saia, e no menu do mundo escolha **Exportar mundo** → gera um `.mcworld`.
4. Jogue esse `.mcworld` na pasta `addons\` e rode `mc.ps1 addons`.
   O script vai perguntar se você quer que o servidor passe a usar esse mundo —
   responda que sim.
5. `mc.ps1 restart`.

Esse é o caminho que eu recomendo pro seu caso, já que você tem `.mcworld` em
mãos. O mundo chega com os experimentos já ligados, e os `.mcpack` que você
instalar depois entram nele.

**Jeito 2 — se você já tem um mundo no servidor e não quer perder:** abra ele
uma vez no cliente (baixando a pasta), ligue o experimento, exporte e traga de
volta. Dá trabalho e é arriscado; prefira o jeito 1 desde o começo.

**Jeito 3 — usar o script de NBT (avançado):**

Se você já tem o mundo no servidor e não pode usar o cliente, o script
`scripts/nbt_beta.py` edita o `level.dat` direto (leitor e escritor NBT
little-endian que valida byte a byte). Para usar:

```powershell
# Parar o servidor ANTES
.\scripts\mc.ps1 down

# Editar o level.dat na bancada primeiro (sempre!)
.\scripts\mc.ps1 teste up
# ... testar ...
.\scripts\mc.ps1 teste down

# Se tudo correr bem, rodar no mundo bom:
# No WSL, dentro do /home/rafael/minecraft-bedrock:
wsl -d Ubuntu -e bash -lc "python3 scripts/nbt_beta.py data/worlds/Aether_Legends_World_Template/level.dat"

# Resultado: level.dat.antes-beta (backup), e level.dat atualizado com gametest=1
.\scripts\mc.ps1 up
```

### Efeitos colaterais

- Ligar experimento em um mundo é **irreversível** — o mundo passa a ser marcado
  como experimental. Não é problema pra servidor pessoal, mas saiba que não tem
  volta.
- A API estável não expõe `beforeEvents.chatSend` — precisa da versão **`-beta`**
  do módulo `@minecraft/server` (única beta aceita pelo servidor). Ver "O que está
  instalado" acima.

---

## Trazendo um mundo (`.mcworld`)

Jogue o `.mcworld` em `addons\` e rode `mc.ps1 addons`. Ele extrai pra
`data\worlds\<nome-do-arquivo>` e pergunta se deve apontar o servidor pra lá
(isso atualiza o `level-name` no `server.properties`, e o `.env` fica como espelho).

Mundo existente com o mesmo nome não é sobrescrito sem você mandar — use
`-Force` se for essa a intenção. **Faça `mc.ps1 backup` antes.**

Se o `.mcworld` já vinha com addons embutidos, eles vêm junto e já ligados. Não
precisa reinstalar nada.

---

## Quando o addon não funciona

Vá na ordem:

1. **`mc.ps1 logs`** e procure por `Pack` ou por erro em vermelho. O `.env` já
   liga o log de conteúdo (`CONTENT_LOG_*`), então erro de manifest e de script
   aparecem ali.
2. **`Unable to parse pack manifest` no log.** O servidor Bedrock é mais
   rigoroso que o cliente: comentário (`//`) ou vírgula sobrando no
   `manifest.json` fazem ele recusar o pack inteiro. Como o cliente aceita,
   muito addon publicado vem assim e "só não funciona" no servidor. O script já
   limpa isso na instalação — se aparecer o aviso *"manifest tinha
   comentario/virgula sobrando; foi limpo"*, é exatamente esse caso.
3. **O addon é só resource pack?** Aí ele muda aparência, não comportamento. E
   se o cliente não estiver baixando a textura, ative `TEXTUREPACK_REQUIRED=true`
   no `.env` (o jogador é obrigado a baixar antes de entrar).
4. **Faltou a outra metade?** Behavior pack que depende de resource pack não
   funciona sozinho. O script avisa isso no final — releia a saída dele.
5. **Precisa de experimento?** Veja a seção acima. Se o pack tem script, quase
   certamente precisa.
6. **Versão do addon vs. versão do servidor.** Addon feito pra 1.20 pode quebrar
   na 1.21. Se suspeitar disso, fixe a versão do servidor no `.env`
   (`VERSION=1.21.51.02`, por exemplo) em vez de `LATEST`.
7. **O pack entrou no mundo certo?** Confira que o `level-name` no
   `server.properties` é a mesma pasta onde o script instalou. Ele imprime o caminho
   no começo.

---

## Tudo roda em container

Nada mais fica agendado no Windows — não brota terminal, não precisa de
sessão aberta. Os serviços sobem junto com o `mc.ps1 up`:

| Container | Para quê |
|---|---|
| `mc-bedrock` | o servidor |
| `mc-backup` | backup a quente todo dia às 05:00, com rotação |
| `mc-autoheal` | reinicia o servidor sozinho se ele ficar doente |
| `mc-painel` | painel de controle em `localhost:8080` |
| `mc-mapa` + `mc-mapa-render` | mapa do mundo em `localhost:8081`, redesenhado às 05:30 |
| `mc-bedrock-teste` | a bancada, só quando você pede |

---

## Painel de controle

```powershell
.\scripts\mc.ps1 painel
```

Ou direto em **http://localhost:8080**. Tem a cara dos menus do jogo: fundo de
terra, fonte pixel, painéis de inventário, botões com bisel, barras de CPU e
memória no estilo da barra de XP, e uma linha igual à da lista de servidores
(com as barrinhas de ping).

### Console de comandos

O painel tem um console completo de linha de comando:

- **Histórico persistente**: navegável com ↑/↓ no campo, e lista clicável com busca
  nos últimos 200 comandos.
- **Repetir o último**: botão ou `Ctrl+Enter`.
- **Enviar N vezes**: campos para quantidade e intervalo (ms), com barra de
  progresso e botão cancelar. Limite de segurança: 500 vezes.
- **Lote**: área multi-linha; cada linha é um comando, executados em ordem.
- **Favoritos**: salvar comando com nome, chips clicáveis, remover.
- **Chips de jogadores online**: clicar insere o nick no cursor. Atualiza a cada 10 s.
- **Templates prontos**: `give`, `enchant`, `effect`, `tp`, `summon`, `time set`,
  `weather`, `gamerule`, `kick`, `op`, com placeholders `{jogador}`.
- **Saída como terminal**: cada envio vira `> comando` e resposta; rolagem infinita
  (limite 2000 linhas); botão limpar; botão copiar.
- Bloqueados: `stop` / `shutdown` (use o botão Parar).

Use comandos que respondem para validar (`time query daytime`, `gamerule X`, `list`).
`say` não ecoa no console do Bedrock — não serve como prova.

### Operações no mundo

- **Instalar addon**: lista o que está em `/addons` e não está instalado; botão
  "na bancada" (sempre) e "no mundo bom" (com confirmação); reinicia ao fim.
- **Remover addon**: lista instalados (nome, versão, tipo, uuid); remove tira do
  JSON e apaga a pasta; confirmação.
- **Restaurar backup**: lista `.mcworld` da pasta de backups; confirmar digitando o
  nome do mundo atual; faz backup preventivo, restaura, reinicia. Progresso visual.
- **Criar mundo novo**: nome + seed + modo (survival/creative) + dificuldade; cria
  pasta vazia, escreve no `server.properties`, reinicia.
- **Trocar de mundo**: seletor com os mundos que existem; confirmar digitando o nome
  do mundo atual; reinicia no novo.

Nenhuma operação destrutiva roda com jogadores online (usa `list` para checar).

### Linha do tempo

Lista de eventos (entrou/saiu/morreu/chat) dos últimos N horas, com hora, ícone,
nome do jogador e coordenada clicável (abre o mapa centrado, se o mapa suportar).

### Placar

Ranking de jogadores com tempo total, blocos quebrados, mortes — agregado das
últimas `STAT|` de cada um. Estilo "lista de servidores" do jogo.

### Catálogo de addons

Abas: instalados (nome, versão, tipo, uuid, botão remover) e disponíveis em
`/addons` (botão instalar na bancada / mundo bom).

**Ele é publicado só em `127.0.0.1`, de propósito** — não tem senha, então só
existe para quem já está nesta máquina. Se um dia quiser acessar de fora, põe
autenticação antes de mudar isso.

### Permissões de arquivo

O painel roda como root para acessar o socket do Docker, mas o servidor Bedrock
roda como uid 1000 (o dono do mount em WSL). Quando o painel escreve (instalar
addon, criar mundo, restaurar backup), os arquivos nascem com permissão root —
e o servidor não consegue abrir. Solução: `ajustar_dono()` é chamado
automaticamente no final de cada operação, revertendo as permissões.

**Se você ver `Permission denied` no log do servidor,** confira:

```powershell
find \\wsl.localhost\Ubuntu\home\rafael\minecraft-bedrock\data -not -user 1000 | wc -l
```

Resultado deve ser 0 (ou poucos arquivos temporários). Se houver muitos, o
painel teve problema. Se adicionar nova rota que escreve, adicione também ela
à lista `ROTAS_QUE_ESCREVEM` em `docker/painel/app.py`.

---

## Mapa do mundo

```powershell
.\scripts\mc.ps1 mapa
```

Ou **http://localhost:8081**. É o mundo inteiro visto de cima, navegável como um
mapa comum, com o mesmo tema do painel por cima. O uNmINeD lê o banco do mundo
direto e redesenha todo dia às 05:30 (meia hora depois do backup). Para forçar
agora:

```powershell
.\scripts\mc.ps1 mapa render
```

### Pinos das bases

O mapa mostra um pino em cada base (última posição que alguém marcou com `!sethome`).
Paire sobre o pino para ver o nome do jogador. Atualiza quando o `render` roda (ou
à noite a cada madrugada). Começa vazio (0 bases) até alguém dar `!sethome`.

### Jogadores ao vivo

A posição de quem está online aparece no mapa e atualiza a cada 10 segundos enquanto
você olha. O nginx do mapa repassa `/api/pos` para o container do painel pela rede
do compose (mesma origem, sem CORS). A página do mapa lê a API e escreve em
`UnminedPlayers` — se não atualizar, recarregue a página. **Nota:** não há prova
de que o uNmINeD redesenha os marcadores após a inicialização (pendente de teste
em jogo com jogador).

### Características do render

- **Zoom até 8x** (`MAP_ZOOM_IN=3` no `.env`): 1 bloco vira 8 pixels. Antes
  parava em 1:1, por isso parecia que "não zoomava".
- **Sombras 3D** (`--shadows=3d`): montanha parece montanha, árvore tem relevo.
- **Modelos de bloco** (`--blockrender`): nos níveis mais próximos desenha o
  bloco em vez de um pixel chapado.
- **WebP** em vez de JPEG: mais nítido pelo mesmo tamanho.
- **Abertura centrada**: o mapa tenta abrir no centro das bases (cálculo de
  mediana das `HOME|`), senão no spawn.

**Ao abrir, o mapa parece preto. Role o scroll uma vez.** Os tiles estão lá —
o OpenLayers só não repinta a primeira tela até a primeira interação. Tentei
forçar isso por script (wheel sintético, updateSize) e o comportamento ficou
errático, então deixei como está: uma rolagem e está resolvido.

O mundo é montado como somente-leitura no renderizador: ele nunca pode escrever
no seu mundo.

---

## Backup e recuperação

Roda sozinho **todo dia às 05:00**, dentro do container `mc-backup`. Para rodar
na hora:

```powershell
.\scripts\mc.ps1 backup
```

**Ninguém é desconectado.** Usa o protocolo oficial do Bedrock: manda
`save hold` (o servidor para de gravar e faz o flush), `save query` (que devolve
a lista de arquivos **e o tamanho válido de cada um**), copia truncando cada
arquivo nesse tamanho, e manda `save resume`. Leva cerca de 25 segundos.

O truncamento não é frescura: o LevelDB mantém arquivos abertos e maiores do que
a parte já consolidada. Copiar sem truncar gera um backup que parece bom e não
abre. O script confere no fim se os addons entraram — um backup só com o mundo
também parece completo, e não é.

O resultado é um `.mcworld` que **abre direto no Minecraft**: dois cliques e você
inspeciona o backup antes de decidir restaurar. Ficam em:

```
\wsl.localhost\Ubuntu\home\rafael\minecraft-bedrock\backups
```

**A rotação é automática:** guarda os `BACKUP_KEEP` mais recentes (7 por padrão,
~2,6 GB no total) e apaga o resto. Para guardar menos, mude no `.env`.

Para voltar um backup:

```powershell
.\scripts\mc.ps1 restore
```

Ele lista o que existe, pede confirmação por extenso, e **faz um backup do mundo
atual antes de sobrescrever**.

### Cópia na nuvem e PC novo

O backup diário fica dentro do WSL, e formatar o Windows apaga o WSL junto. Por
isso existe uma cópia fora do PC: a pasta `data/` inteira (mundo, configs, packs
e o binário do servidor na versão exata) e os addons de terceiros ficam como
arquivos de uma **release** do repositório privado `Rafael-CN/minecraft-bedrock`.
O repositório guarda só o código e as configs; o que é pesado mora na release.

Num PC novo, com WSL (Ubuntu), Docker Desktop (integração WSL ligada) e
`gh auth login` feitos:

```powershell
gh repo clone Rafael-CN/minecraft-bedrock
cd minecraft-bedrock
.\scripts\Restaurar.ps1
```

Ele baixa a release mais recente, extrai o mundo no `DATA_PATH` do `.env`, põe os
addons em `addons\` e sobe tudo com `--build`. Se já existir mundo, ele recusa
sem mexer em nada, e só sobrescreve com `-Force`. Se o usuário do Ubuntu novo
não for `rafael`, troque `/home/rafael` no `.env` e no `docker-compose.yml` antes.

Para mandar um snapshot novo pra nuvem, com o servidor **parado**
(`.\scripts\mc.ps1 down`):

```powershell
$d = Get-Date -Format yyyy-MM-dd
wsl -d Ubuntu -e bash -lc "cd ~/minecraft-bedrock && tar --exclude='data/ContentLog*' -czf /mnt/c/Users/Public/mundo-$d.tar.gz data"
tar --exclude=addons/LEIA-ME.txt -cf "C:\Users\Public\addons-$d.tar" addons
gh release create "mundo-$d" "C:\Users\Public\mundo-$d.tar.gz" "C:\Users\Public\addons-$d.tar" --repo Rafael-CN/minecraft-bedrock --title "Mundo $d"
```

---

## Quando o servidor cai

O container `mc-autoheal` confere a cada minuto e **reinicia sozinho** qualquer
container marcado como doente. O healthcheck do servidor testa a porta do
Bedrock de verdade, então isso cobre os dois casos: o container morrer, e o
servidor travar de pé.

---

## O acidente do mundo fantasma (02/09/2026)

Vale entender, porque a proteção que existe hoje nasceu disto.

O mundo mora dentro da distro Ubuntu do WSL, e o Docker Desktop monta esse
caminho a partir dela. O WSL **encerra distro ociosa**. Se um container sobe
nesse intervalo, o bind mount não encontra nada e o Docker cria uma **pasta
vazia** no lugar. O Bedrock, ao abrir uma pasta vazia, faz o que sempre faz:
gera um mundo novo em branco e começa a gravar nele.

Foi isso. Durante três horas o servidor respondeu normalmente, o ping estava
verde, o painel dizia "no ar" — e todo mundo jogando num mundo vazio, sem addon
nenhum. O mundo bom nunca foi tocado: ele estava intacto no disco o tempo todo,
com os 278 MB e os 13 packs. O que faltava era alguém perceber que o servidor
estava olhando para o lugar errado.

**O sintoma:** mundo diferente e sem nenhum addon. Se isso acontecer de novo, é
quase certo que seja o mount.

**Como conferir em 10 segundos** — compare o que o disco tem com o que o
container enxerga:

```powershell
wsl -d Ubuntu -e ls "/home/rafael/minecraft-bedrock/data/worlds/Aether_Legends_World_Template"
docker exec mc-bedrock ls "/data/worlds/Aether_Legends_World_Template"
```

Se o segundo mostrar menos coisa que o primeiro (sem `behavior_packs`, sem
`world_behavior_packs.json`), é o mount. **A cura é recriar o container** —
reiniciar não resolve, um mount órfão continua órfão:

```powershell
wsl -d Ubuntu -e bash -lc "cd /mnt/c/caminho/para/minecraft-bedrock && docker compose up -d --force-recreate bedrock"
```

### As três camadas que impedem a repetição

| Camada | O que faz | Quando age |
|---|---|---|
| **Trava no `up`** | confere que `data/worlds` está acessível na distro **antes** de subir; se não estiver, não sobe nada | toda vez que você liga o servidor |
| **Guarda** | vigia se `world_behavior_packs.json` continua visível; se sumir, **para o servidor** | a cada 60 s, dentro do `mc-backup` |
| **Healthcheck** | além do ping, exige o arquivo do mundo — o ping sozinho não percebeu nada no dia | a cada 30 s |

O guarda **para** em vez de reiniciar de propósito: reiniciar um container com
mount órfão só devolve o mesmo problema, e cada minuto rodando é mais um minuto
gravando no mundo errado. Servidor parado é chato; mundo sobrescrito não tem
volta.

---

## Onde o mundo mora

O mundo **não fica mais na pasta do projeto**. Ele vive no sistema de arquivos
do WSL2:

```
\wsl.localhost\Ubuntu\home\rafael\minecraft-bedrock\data
```

Esse caminho abre normalmente no Explorer — cole na barra de endereços. O
`mc.ps1 world` já leva direto na pasta do mundo.

Por que a mudança? Medição de 01/09/2026, escrevendo 2.000 arquivos pequenos:

| destino | escrita | leitura |
|---|---|---|
| pasta do Windows | 4.898 ms | 3.650 ms |
| WSL2 | **61 ms** | **53 ms** |

O banco do mundo é LevelDB, que faz exatamente esse tipo de acesso. Na prática:
boot caiu de 3–5 minutos para **16 segundos**, e o backup de 472 s para **49 s**.

### Qual mundo está ativo?

**A fonte da verdade é `level-name=...` no arquivo `/data/server.properties`**, não
o `.env`. O painel lê lá quando você muda de mundo, e o `mc.ps1` também agora faz
o mesmo quando possível.

- **`LEVEL_NAME` no `.env`:** agora é um espelho para compatibilidade. Scripts
  Windows que precisam do caminho leem o `.env`, mas o servidor sempre lê o
  `server.properties`.
- **Se você trocar de mundo pelo painel,** o `server.properties` é atualizado
  automaticamente. O `.env` pode ficar desatualizado — não é problema, o servidor
  vai ignorar.
- **Se você mexer no `.env` diretamente,** depois da próxima troca de mundo pelo
  painel o `.env` será atualizado também.

Três detalhes que vieram junto e não são óbvios:

- **O `docker compose` roda dentro do WSL.** Do Windows, o Docker Desktop não
  resolve o caminho `/home/rafael/...` — ele aceita a string, cria uma pasta
  vazia e o servidor sobe com um mundo novo em branco. Os scripts já cuidam
  disso sozinhos (`Invoke-Compose`, em `scripts\_Comum.ps1`).
- **Precisa da integração WSL ligada** em Docker Desktop → Settings → Resources
  → WSL Integration → `Ubuntu`. Sem ela nada disso funciona.
- **`cap_add: SYS_PTRACE` no compose.** Como `/data` agora pertence ao usuário
  do WSL, o servidor passou a rodar como uid 1000, e o `send-command` (que o
  backup a quente usa) precisa varrer `/proc` para achar o processo. Sem essa
  capability o backup não consegue mandar `save hold`.

---

## Mundo de testes

```powershell
.\scripts\mc.ps1 teste up
```

Sobe um **segundo servidor**, na porta `19134`, com mundo criativo e pacífico
próprio. É onde você instala addon novo para ver se quebra, antes de colocar no
mundo onde estão as construções.

| Comando | O que faz |
|---|---|
| `mc.ps1 teste up` | sobe a bancada |
| `mc.ps1 teste down` | derruba e remove |
| `mc.ps1 teste status` | está de pé? |
| `mc.ps1 teste logs` | log ao vivo |
| `mc.ps1 teste addons` | instala os addons da pasta `addons\` **na bancada** |

Mundo, porta, pasta e container separados — nada disso encosta no Aether.

---

## O addon da casa

Em `meus-addons\CasaDoRafael_BP\` mora um behavior pack escrito aqui, com a
mesma Script API que os outros addons usam. Ele não adiciona bloco, mob nem
textura — só as regras da convivência. Por isso não pesa nada e não aumenta a
contagem de permutações de bloco.

O que faz: escuta comandos no chat com `!`, valida cooldown e permissões,
executa a ação, e envia sinais para o log (posição, eventos, stats).

### Comandos de chat

Digite no chat (sem barra), cancelam automaticamente do servidor (ninguém vê):

| Comando | O quê |
|---|---|
| `!sethome` | marca este lugar como sua casa |
| `!home` | teleporta pra sua casa |
| `!back` | volta pro ponto da morte |
| `!tpa Nome` | pede pra teleportar pra Nome (expira em 30 s) |
| `!aceitar` | aceita um TPA |
| `!regras` | mostra as regras da casa |
| `!ajuda` | lista todos os comandos |
| `!online` | quem está jogando agora |
| `!coord` | suas coordenadas atuais |
| `!give <item> [qtd] [encant:niv,...]` | entrega item (só op). Ex: `!give diamond_sword 1 sharpness:5,unbreaking:3` |
| `!summon <mob> [leather\|iron\|diamond\|netherite] [arma]` | invoca mob com armadura (só op) |

**Cooldown global:** 10 segundos entre qualquer comando (isso está anotado como
possível ajuste futuro — `!tpa` seguido de `!aceitar` em menos de 10 s não funciona).

### Sinais de log

O addon escreve no log (use `mc.ps1 logs`) para que outros sistemas leiam:

- `EVT|entrou|Nome|ts` — jogador entrou
- `EVT|saiu|Nome|ts` — jogador saiu
- `EVT|morreu|Nome|x,y,z|ts` — morreu em (x,y,z)
- `EVT|chat|Nome|texto|ts` — digitou algo no chat
- `POS|Nome|x,y,z|dim|ts` — posição do jogador (a cada 10 s)
- `HOME|Nome|x,y,z|dim` — marcou home
- `STAT|Nome|blocos=N|mortes=N|segundos=N` — stats (a cada 60 s)

Linha do tempo, placar e mapa leem esses sinais. Máquina local do log (segundos
desde janeiro de 1970, UTC).

Para mexer no addon, edite `meus-addons\CasaDoRafael_BP\scripts\main.js` e depois:

```powershell
.\scripts\mc.ps1 addons -Force
.\scripts\mc.ps1 restart
```

Se a mudança for grande, teste antes na bancada.

---

## Estrutura da pasta

```
minecraft-bedrock\
├── docker-compose.yml       o container
├── .env                     TODA a configuração do servidor fica aqui
├── addons\                  <- você joga os .mcpack/.mcaddon/.mcworld aqui
├── data\                    o servidor de verdade (mundos, packs, properties)
│   └── worlds\
├── backups\                 zips gerados pelo mc.ps1 backup
└── scripts\
    ├── mc.ps1               atalhos do dia a dia
    └── Install-Addons.ps1   o instalador de addons
```

Para **maioria das configurações**, mexa no `.env` e o container reescreve o
`server.properties` a cada boot. **Exceção:** `level-name` é lido do que já está
no `server.properties` (o painel altera lá direto quando você troca de mundo) —
editar `LEVEL_NAME` no `.env` não trocará de mundo. Ver "Onde o mundo mora".

---

## O que está instalado hoje

Mundo ativo: **`Aether_Legends_World_Template`** (o template do Aether, nome
interno `Aether_Final`). `level-name` no `server.properties` aponta pra ele
(leia a seção "Onde o mundo mora" para entender por que isso mudou).

| Pack | Versão | Tipo |
|---|---|---|
| Aether Legends | 1.0.8 | BP + RP (vieram no template) |
| Core Craft | 1.2.4 | BP + RP |
| Eternal Caves (Panascais) | 1.0.7 | BP + RP |
| Naturalist 26.1 | 1.0.34 | BP + RP |
| Connected Glass (Voxen) | 1.1.9 | BP + RP |
| Casa do Rafael | v2 | BP (scripts com `!` e sinais de log) |

### Experimentos

O mundo tem **Beta APIs ligado** (experimentos `gametest`, `experiments_ever_used`,
`saved_with_toggled_experiments` no `level.dat`). Isso permite que o addon da
casa leia eventos do chat com `world.beforeEvents.chatSend` — sem o experimento,
só `scriptevent` (sem a barra) funcionaria.

O módulo `@minecraft/server` nos packs está fixado em **`2.10.0-beta`** (a única
versão beta aceita por este build do servidor). A API estável não expõe
`beforeEvents.chatSend`.

Ver "Experimentos" abaixo para saber como isso mudou.

### Avisos no boot

- **`World with over 65536 block permutations` (~74.000 no mundo atual).** É o custo
  de empilhar Aether + Core Craft + Connected Glass + Eternal Caves + Casa do
  Rafael. O servidor sobe e funciona, mas é um aviso real de desempenho. Se o
  servidor ficar pesado com gente online, o primeiro candidato a sair é o addon
  que você menos usa — não adianta mexer em `VIEW_DISTANCE` antes disso.
- **`recipes/sf/nba/wool_from_fur.recipe.json ... require unlock data`.** É uma
  receita do Naturalist mal formada pelo próprio autor do addon. Afeta só essa
  receita (lã a partir de pelo); o resto do addon funciona. Não tem conserto do
  nosso lado sem editar o addon.

### Terreno e boot

O **Eternal Caves** muda a geração de terreno. O mundo do Aether **já vem gerado**,
então as cavernas novas só vão aparecer em pedaços do mapa que ninguém visitou
ainda. Perto do spawn, nada muda.

O boot desse mundo leva **4 a 5 minutos** (é muito conteúdo + disco do Windows).
Isso é normal. `mc.ps1 status` vai dizer que o servidor ainda não responde
durante esse tempo.

Os arquivos originais continuam em `addons\` — servem pra reinstalar com
`-Force` depois. Se quiser os ~350 MB de volta, pode apagá-los de lá que o
servidor não se importa.

---


### O Furniture Add-On foi removido (02/09/2026)

Era o addon que gerava **146 mil erros de script em 3 horas** (`InvalidEntityError`
e `getEquipment`, ~13 por segundo) e a maior fatia das 104.511 permutações de
bloco. Saiu do mundo bom e da bancada, e o arquivo foi tirado de `addons\` para
ninguém reinstalar com um clique (está guardado em
`_data-antiga-pode-apagar\FURNITURE Add-On.mcaddon.removido`).

Efeito medido: o aviso `World with over 65536 block permutations` **deixou de
aparecer no boot** — ou seja, o mundo voltou para dentro do limite recomendado.
Os móveis já colocados viraram bloco desconhecido; isso é esperado.

## Onde achar addons

Cuidado com site que empacota addon dentro de instalador `.exe` ou pede pra
desabilitar antivírus — addon legítimo é sempre um `.mcpack`/`.mcaddon`, que é
só um zip. Fontes conhecidas da comunidade: MCPEDL e o Marketplace oficial
(esse último só funciona no cliente, não dá pra usar em servidor dedicado).
