# Minecraft Bedrock Server on Docker

Stack completa em **Docker** para operação local de um servidor dedicado de **Minecraft Bedrock** (Windows + WSL2 ou Linux), incluindo painel de controle web, renderização automatizada do mapa do mundo, backups a quente sem desconectar jogadores, bancada isolada para homologação de Add-Ons e restauração em um único comando.

---

## Arquitetura dos serviços (`docker-compose.yml`)

| Serviço | Papel | Acesso padrão |
|---|---|---|
| `bedrock` (`itzg/minecraft-bedrock-server`) | Servidor dedicado principal com `stop_grace_period` estendido e healthcheck validando integridade do mount e `level-name` | `UDP 19132` (IPv4) / `19133` (IPv6) |
| `painel` (`./docker/painel`) | Painel web em Python (stdlib) para status ao vivo, console, troca de mundo, catálogo/instalação de Add-Ons e restauração de backups | `http://127.0.0.1:8080` |
| `mapa-render` + `mapa` (`./docker/mapa` + `nginx`) | Pipeline agendado com **uNmINeD** que renderiza tiles do mundo (incluindo blocos de Add-Ons) e publica com marcadores ao vivo | `http://127.0.0.1:8081` |
| `backup` (`./docker/backup`) | Rotina cron de **backup a quente** (`save hold` / `save query` / `save resume`) com rotação automática e guarda de integridade | Interno |
| `autoheal` (`willfarrell/autoheal`) | Monitora o healthcheck e reinicia automaticamente containers marcados caso o processo trave | Interno |
| `teste` (profile `teste`) | Bancada isolada na porta `19134` para testar novos `.mcaddon`/`.mcpack` antes de promovê-los ao mundo principal | `UDP 19134` |

> **Segurança por padrão:** tanto o painel (`8080`) quanto o mapa (`8081`) fazem bind exclusivamente em `127.0.0.1`. Não exponha essas portas em `0.0.0.0` sem configurar autenticação reversa.

---

## Estrutura do repositório

```text
minecraft-bedrock/
├── docker-compose.yml       # Orquestração completa dos containers
├── .env.example             # Modelo limpo de configuração de ambiente
├── docker/
│   ├── backup/              # Container de backup a quente (save hold) e guarda
│   ├── mapa/                # Renderizador uNmINeD + tema customizado + Nginx
│   └── painel/              # Aplicação web de administração local
├── scripts/
│   ├── mc.ps1               # CLI em PowerShell para operação diária
│   ├── Install-Addons.ps1   # Instalador/validador automatizado de .mcpack/.mcaddon/.mcworld
│   └── Restaurar.ps1        # Restauração completa (one-shot restore) a partir de backup
├── addons/                  # Diretório de entrada para pacotes .mcaddon / .mcpack
└── testes/                  # Suíte automatizada de verificação do painel e fluxos
```

---

## Início rápido

1. **Configure o ambiente:**
   ```powershell
   Copy-Item .env.example .env
   ```
   Edite o arquivo `.env` ajustando `SERVER_NAME`, `LEVEL_NAME` e os caminhos `DATA_PATH` / `BACKUPS_PATH` (em Windows com Docker Desktop, manter os volumes dentro do filesystem nativo do **WSL2** oferece ganho expressivo de I/O em relação a pastas NTFS montadas).

2. **Suba a stack pelo utilitário de linha de comando:**
   ```powershell
   .\scripts\mc.ps1 up
   .\scripts\mc.ps1 status
   ```

3. **Operações do dia a dia (`scripts/mc.ps1`):**
   ```powershell
   .\scripts\mc.ps1 logs              # Acompanha logs do servidor em tempo real
   .\scripts\mc.ps1 cmd "list"        # Envia comando ao console sem anexar o terminal
   .\scripts\mc.ps1 backup            # Dispara um backup a quente imediato
   .\scripts\mc.ps1 restore           # Restaura um backup existente com segurança
   .\scripts\mc.ps1 teste up          # Sobe o servidor isolado de testes (porta 19134)
   .\scripts\mc.ps1 painel            # Abre o painel web local (127.0.0.1:8080)
   .\scripts\mc.ps1 mapa              # Abre o mapa renderizado (127.0.0.1:8081)
   ```

4. **Restauração em um comando (máquina nova):**
   ```powershell
   .\scripts\Restaurar.ps1
   ```

Documentação operacional detalhada sobre Add-Ons, volumes WSL2 e proteção contra corrupção de LevelDB está disponível em [`LEIAME.md`](./LEIAME.md).
