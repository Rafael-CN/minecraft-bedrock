<#
.SYNOPSIS
    Atalhos do servidor Minecraft Bedrock.

.EXAMPLE
    .\scripts\mc.ps1 up                       # sobe o servidor
    .\scripts\mc.ps1 logs                     # log ao vivo
    .\scripts\mc.ps1 cmd "list"               # manda comando sem entrar no console
    .\scripts\mc.ps1 backup                   # backup a quente, sem derrubar ninguem
    .\scripts\mc.ps1 restore                  # volta um backup
    .\scripts\mc.ps1 world                    # abre a pasta do mundo no Explorer
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'down', 'restart', 'logs', 'console', 'cmd', 'status', 'addons',
                 'backup', 'restore', 'update', 'ip', 'world', 'painel', 'mapa', 'teste', 'help')]
    [string]$Command = 'help',

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$container = 'mc-bedrock'

. (Join-Path $PSScriptRoot '_Comum.ps1')

# Atalho: o compose precisa rodar dentro do WSL quando o mundo mora la.
function Compose { Invoke-Compose -RootDir $root -ComposeArgs $args }

# Repassa "-Force", "-File x" etc. como parametros nomeados de verdade.
function ConvertTo-Splat {
    param([string[]]$Tokens)
    $splat = @{}
    $toks = @($Tokens)
    for ($i = 0; $i -lt $toks.Count; $i++) {
        if ($toks[$i] -notlike '-*') { continue }
        $key = $toks[$i].TrimStart('-')
        if (($i + 1) -lt $toks.Count -and $toks[$i + 1] -notlike '-*') {
            $splat[$key] = $toks[$i + 1]; $i++
        } else {
            $splat[$key] = $true
        }
    }
    return $splat
}

$envMap  = Read-DotEnv (Join-Path $root '.env')
$dataUnc = $envMap['DATA_UNC']
if (-not $dataUnc) { $dataUnc = Join-Path $root 'data' }
$levelName = if ($envMap['LEVEL_NAME']) { $envMap['LEVEL_NAME'] } else { 'Bedrock level' }

Push-Location $root
try {
    switch ($Command) {

        'up' {
            Compose up -d
            Write-Host ''
            Write-Host 'Subindo. Esse mundo leva ~1 min para aceitar conexao.' -ForegroundColor Yellow
            Write-Host 'Acompanhe com:  .\scripts\mc.ps1 logs' -ForegroundColor White
        }

        'down' {
            # -t 120 casa com o stop_grace_period do compose: o servidor
            # precisa desse tempo para gravar o mundo antes de morrer.
            Compose stop -t 120
            Compose down
        }

        'restart' {
            Compose stop -t 120
            Compose up -d
            Write-Host 'Reiniciado.' -ForegroundColor Green
        }

        'logs' {
            $n = 120
            if ($Rest -and $Rest[0] -match '^\d+$') { $n = [int]$Rest[0] }
            Compose logs -f --tail $n
        }

        'console' {
            Write-Host ''
            Write-Host 'Console do servidor. Comandos vao SEM a barra: list, op Fulano...' -ForegroundColor Cyan
            Write-Host 'Para SAIR sem derrubar o servidor: Ctrl+P e depois Ctrl+Q' -ForegroundColor Yellow
            Write-Host '(Ctrl+C aqui MATA o servidor - nao use.)' -ForegroundColor Yellow
            Write-Host ''
            docker attach $container
        }

        'cmd' {
            if (-not $Rest -or $Rest.Count -eq 0) {
                Write-Host 'Uso: .\scripts\mc.ps1 cmd "list"' -ForegroundColor Yellow
                Write-Host 'Exemplos: "list", "say oi", "gamerule keepInventory true", "op Fulano"' -ForegroundColor DarkGray
                break
            }
            $comando = ($Rest -join ' ')
            $desde = (Get-Date).ToUniversalTime().AddSeconds(-1).ToString('yyyy-MM-ddTHH:mm:ss') + 'Z'
            docker exec $container send-command $comando | Out-Null
            Start-Sleep -Milliseconds 1200
            # A resposta sai no console do servidor, entao vem pelo log.
            $saida = docker logs $container --since $desde 2>&1 |
                     Where-Object { $_ -notmatch 'DEBU\[' }
            if ($saida) { $saida | ForEach-Object { $_ -replace '^\[[^\]]+\]\s*', '' } }
            else { Write-Host '(sem resposta no log)' -ForegroundColor DarkGray }
        }

        'status' {
            Compose ps
            Write-Host ''
            $ping = docker exec $container mc-monitor status-bedrock --host 127.0.0.1 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host $ping -ForegroundColor Green
            } else {
                Write-Host 'O servidor Bedrock ainda nao responde.' -ForegroundColor Yellow
                Write-Host 'Se o container acabou de subir, e normal - espere ~1 min.' -ForegroundColor DarkGray
            }
            Write-Host ''
            $bk = if ($envMap['BACKUPS_UNC']) { $envMap['BACKUPS_UNC'] } else { Join-Path $root 'backups' }
            if (Test-Path $bk) {
                $b = @(Get-ChildItem $bk -Filter '*.mcworld' -File | Sort-Object LastWriteTime -Descending)
                if ($b.Count -gt 0) {
                    $mb = [math]::Round((($b | Measure-Object Length -Sum).Sum) / 1MB, 1)
                    Write-Host ("Backups: {0} guardados, {1} MB. Mais recente: {2}" -f $b.Count, $mb, $b[0].LastWriteTime) -ForegroundColor Gray
                } else {
                    Write-Host 'Backups: NENHUM ainda.' -ForegroundColor Yellow
                }
            }
        }

        # O splat precisa de uma VARIAVEL hashtable: "@(...)" vira array
        # e o PowerShell repassa tudo como argumento posicional.
        'addons' { $sp = ConvertTo-Splat $Rest; & (Join-Path $PSScriptRoot 'Install-Addons.ps1') @sp }

        'backup' {
            # Uma implementacao so, a do container. Ter uma segunda aqui em
            # PowerShell era duplicacao esperando divergir - e o agendamento
            # ja vive no container mc-backup de qualquer forma.
            Write-Host 'Rodando o backup (o servidor continua no ar)...' -ForegroundColor Cyan
            docker exec mc-backup /usr/local/bin/backup.sh
        }

        'painel' {
            $porta = if ($envMap['PANEL_PORT']) { $envMap['PANEL_PORT'] } else { '8080' }
            Write-Host "Abrindo o painel em http://localhost:$porta" -ForegroundColor Cyan
            Start-Process "http://localhost:$porta"
        }

        'mapa' {
            $porta = if ($envMap['MAP_PORT']) { $envMap['MAP_PORT'] } else { '8081' }
            if ($Rest -and $Rest[0] -eq 'render') {
                Write-Host 'Renderizando o mapa agora (leva alguns minutos)...' -ForegroundColor Cyan
                docker exec mc-mapa-render /usr/local/bin/render.sh
            } else {
                Write-Host "Abrindo o mapa em http://localhost:$porta" -ForegroundColor Cyan
                Write-Host 'Dica: role o scroll para tras para ver o mundo inteiro.' -ForegroundColor DarkGray
                Start-Process "http://localhost:$porta"
            }
        }

        'restore' {
            # Os backups agora sao gravados pelo container, no WSL.
            $bk = if ($envMap['BACKUPS_UNC']) { $envMap['BACKUPS_UNC'] } else { Join-Path $root 'backups' }
            $lista = @(Get-ChildItem $bk -Filter '*.mcworld' -File -ErrorAction SilentlyContinue |
                       Sort-Object LastWriteTime -Descending)
            if ($lista.Count -eq 0) { throw 'nenhum backup .mcworld em backups\' }

            Write-Host ''
            Write-Host 'Backups disponiveis (mais novo primeiro):' -ForegroundColor Cyan
            for ($i = 0; $i -lt $lista.Count; $i++) {
                "{0,2}) {1,-46} {2}  {3,7:N1} MB" -f ($i + 1), $lista[$i].Name, $lista[$i].LastWriteTime, ($lista[$i].Length / 1MB)
            }
            Write-Host ''
            $esc = Read-Host 'Numero do backup para restaurar (Enter cancela)'
            if ([string]::IsNullOrWhiteSpace($esc)) { Write-Host 'Cancelado.' -ForegroundColor Yellow; break }
            $idx = [int]$esc - 1
            if ($idx -lt 0 -or $idx -ge $lista.Count) { throw 'numero invalido' }
            $escolhido = $lista[$idx]

            Write-Host ''
            Write-Host "Isso vai SUBSTITUIR o mundo '$levelName' pelo conteudo de:" -ForegroundColor Yellow
            Write-Host "  $($escolhido.Name)" -ForegroundColor White
            Write-Host 'O mundo atual sera guardado antes, como backup de seguranca.' -ForegroundColor DarkGray
            $ok = Read-Host "Confirma? (digite SIM)"
            if ($ok -ne 'SIM') { Write-Host 'Cancelado.' -ForegroundColor Yellow; break }

            Write-Host ''
            Write-Host 'Guardando o mundo atual antes de sobrescrever...' -ForegroundColor Cyan
            & (Join-Path $PSScriptRoot 'Backup-World.ps1')

            Compose stop -t 120 | Out-Null

            $destino = Join-Path $dataUnc "worlds\$levelName"
            if (Test-Path $destino) { Remove-Item -LiteralPath $destino -Recurse -Force }
            New-Item -ItemType Directory -Path $destino -Force | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($escolhido.FullName, $destino)

            Compose up -d | Out-Null
            Write-Host ''
            Write-Host "Restaurado. O servidor esta subindo com o mundo de $($escolhido.LastWriteTime)." -ForegroundColor Green
        }

        'teste' {
            # Segundo servidor, mundo criativo, porta 19134. Para instalar
            # addon novo sem arriscar o mundo bom.
            $sub = if ($Rest -and $Rest.Count -gt 0) { $Rest[0] } else { 'help' }
            $testeUnc = $envMap['TESTE_DATA_UNC']
            $testeLevel = if ($envMap['TESTE_LEVEL']) { $envMap['TESTE_LEVEL'] } else { 'Bancada' }
            $testePort = if ($envMap['TESTE_PORT']) { $envMap['TESTE_PORT'] } else { '19134' }

            switch ($sub) {
                'up' {
                    # O nome do servico no fim e obrigatorio: sem ele o compose
                    # mexe tambem no servidor principal.
                    Compose --profile teste up -d teste
                    Write-Host ''
                    Write-Host "Bancada de testes subindo na porta $testePort." -ForegroundColor Yellow
                    Write-Host 'Conecte em 127.0.0.1 com essa porta. Criativo, pacifico.' -ForegroundColor DarkGray
                }
                'down' {
                    # Idem: "stop" sem o nome do servico derruba o mundo bom junto.
                    Compose --profile teste stop -t 60 teste
                    Compose --profile teste rm -f teste
                }
                'logs' { docker logs -f --tail 100 mc-bedrock-teste }
                'addons' {
                    # Mesmo instalador, apontado para a pasta do mundo de teste.
                    & (Join-Path $PSScriptRoot 'Install-Addons.ps1') -DataDir $testeUnc -LevelName $testeLevel @(ConvertTo-Splat ($Rest | Select-Object -Skip 1))
                }
                'status' { docker ps -a --filter name=mc-bedrock-teste --format "table {{.Names}}	{{.Status}}" }
                default {
                    Write-Host ''
                    Write-Host 'Bancada de testes - mundo separado para experimentar addon' -ForegroundColor Cyan
                    Write-Host ''
                    Write-Host '  mc.ps1 teste up        sobe a bancada (porta ' -NoNewline; Write-Host "$testePort)"
                    Write-Host '  mc.ps1 teste down      derruba e remove'
                    Write-Host '  mc.ps1 teste status    esta de pe?'
                    Write-Host '  mc.ps1 teste logs      log ao vivo'
                    Write-Host '  mc.ps1 teste addons    instala os addons da pasta addons\ NA BANCADA'
                    Write-Host ''
                    Write-Host '  O mundo bom nao e tocado por nada disso.' -ForegroundColor DarkGray
                    Write-Host ''
                }
            }
        }

        'world' {
            $p = Join-Path $dataUnc "worlds\$levelName"
            Write-Host "Abrindo $p" -ForegroundColor Cyan
            explorer.exe $p
        }

        'update' {
            Compose pull
            Compose stop -t 120
            Compose up -d
            Write-Host 'Imagem atualizada. O servidor Bedrock segue VERSION do .env.' -ForegroundColor Green
        }

        'ip' {
            $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                     Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' })
            $ruido = 'vEthernet|WSL|Hyper-V|Docker|Loopback|Default Switch'
            $vpn = @($ips | Where-Object { $_.InterfaceAlias -match 'Tailscale|ZeroTier' -or $_.IPAddress -match '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.' })
            $lan = @($ips | Where-Object { $_.InterfaceAlias -notmatch $ruido -and $_ -notin $vpn })
            $resto = @($ips | Where-Object { $_ -notin $vpn -and $_ -notin $lan })

            Write-Host ''
            Write-Host 'No proprio PC:' -ForegroundColor Cyan
            Write-Host '    127.0.0.1        porta 19132' -ForegroundColor White
            if ($lan.Count -gt 0) {
                Write-Host ''
                Write-Host 'Xbox / celular na mesma casa:' -ForegroundColor Cyan
                foreach ($i in $lan) { Write-Host ("    {0,-16} porta 19132   ({1})" -f $i.IPAddress, $i.InterfaceAlias) -ForegroundColor White }
            }
            if ($vpn.Count -gt 0) {
                Write-Host ''
                Write-Host 'Amigos de fora, pela VPN:' -ForegroundColor Cyan
                foreach ($i in $vpn) { Write-Host ("    {0,-16} porta 19132   ({1})" -f $i.IPAddress, $i.InterfaceAlias) -ForegroundColor Green }
            }
            if ($resto.Count -gt 0) {
                Write-Host ''
                Write-Host 'Ignore (interfaces virtuais):' -ForegroundColor DarkGray
                foreach ($i in $resto) { Write-Host ("    {0,-16} ({1})" -f $i.IPAddress, $i.InterfaceAlias) -ForegroundColor DarkGray }
            }
            Write-Host ''
        }

        default {
            Write-Host ''
            Write-Host 'Servidor Minecraft Bedrock' -ForegroundColor Cyan
            Write-Host ''
            Write-Host '  DIA A DIA' -ForegroundColor White
            Write-Host '    mc.ps1 up            sobe o servidor'
            Write-Host '    mc.ps1 down          para (o mundo fica salvo)'
            Write-Host '    mc.ps1 restart       reinicia - use apos mexer no .env ou instalar addon'
            Write-Host '    mc.ps1 status        no ar? quantos jogadores? backups em dia?'
            Write-Host '    mc.ps1 logs [n]      log ao vivo'
            Write-Host ''
            Write-Host '  COMANDOS DO JOGO' -ForegroundColor White
            Write-Host '    mc.ps1 cmd "list"    manda um comando e mostra a resposta'
            Write-Host '    mc.ps1 console       entra no console (sair: Ctrl+P, Ctrl+Q)'
            Write-Host ''
            Write-Host '  MUNDO E ADDONS' -ForegroundColor White
            Write-Host '    mc.ps1 addons        instala .mcpack/.mcaddon/.mcworld da pasta addons'
            Write-Host '    mc.ps1 world         abre a pasta do mundo no Explorer'
            Write-Host '    mc.ps1 teste up      sobe um mundo separado so para testar addon'
            Write-Host ''
            Write-Host '  SEGURANCA' -ForegroundColor White
            Write-Host '    mc.ps1 backup        backup a quente agora, sem derrubar ninguem'
            Write-Host '    mc.ps1 restore       volta um backup (pede confirmacao)'
            Write-Host '    (o backup diario das 05:00 e o vigia rodam sozinhos, em container)' -ForegroundColor DarkGray
            Write-Host ''
            Write-Host '  JANELAS' -ForegroundColor White
            Write-Host '    mc.ps1 painel        abre o painel de controle no navegador'
            Write-Host '    mc.ps1 mapa          abre o mapa do mundo'
            Write-Host '    mc.ps1 mapa render   redesenha o mapa agora'
            Write-Host ''
            Write-Host '  MANUTENCAO' -ForegroundColor White
            Write-Host '    mc.ps1 ip            enderecos para conectar'
            Write-Host '    mc.ps1 update        atualiza a imagem do Docker'
            Write-Host ''
        }
    }
}
finally {
    Pop-Location
}
