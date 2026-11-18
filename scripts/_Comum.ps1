<#
    Funcoes usadas por mais de um script. Carregue com:

        . (Join-Path $PSScriptRoot '_Comum.ps1')
#>

function Read-DotEnv {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        $t = $line.Trim()
        if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
    }
    return $map
}

# Converte C:\Users\... em /mnt/c/Users/... para uso dentro do WSL.
function ConvertTo-WslPath {
    param([string]$WindowsPath)
    $p = $WindowsPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):(.*)$') {
        return '/mnt/' + $Matches[1].ToLower() + $Matches[2]
    }
    return $p
}

<#
    Roda "docker compose" no lugar certo.

    O mundo mora em /home/rafael/... dentro do WSL2, e o Docker Desktop so
    resolve esse caminho quando o comando parte de dentro da distro. Rodando
    do Windows, ele aceita a string, cria uma pasta vazia e o servidor sobe
    sem o mundo - foi exatamente o que aconteceu na primeira tentativa.

    Quando DATA_PATH e um caminho do Windows, roda direto, como antes.
#>
<#
    Confere que o mundo esta MESMO acessivel na distro antes de subir.

    Isto existe por causa de 02/09/2026. O mundo mora dentro da distro do
    WSL e o Docker Desktop monta o caminho a partir dela. O WSL encerra
    distro ociosa; se o container subir nesse intervalo, o bind mount nao
    encontra nada e o Docker cria uma pasta VAZIA no lugar. O Bedrock, ao
    achar uma pasta vazia, faz o que sempre faz: gera um mundo novo em
    branco e comeca a gravar nele. Foram tres horas jogando num mundo
    fantasma, sem addon nenhum, ate alguem reclamar.

    Rodar qualquer comando na distro ja a acorda - e por isso a checagem
    tambem serve de cura. O que nao pode e subir sem checar.
#>
function Assert-MundoAcessivel {
    param(
        [Parameter(Mandatory = $true)][string]$Distro,
        [Parameter(Mandatory = $true)][string]$DataPath
    )

    # O proprio ato de executar acorda a distro, se ela estiver dormindo.
    $r = wsl -d $Distro -e sh -c "test -d '$DataPath/worlds' && echo ok || echo faltando" 2>$null
    if ("$r".Trim() -eq 'ok') { return }

    throw @"
O mundo nao esta acessivel em '$DataPath/worlds' na distro '$Distro'.

Subir assim faria o servidor criar um mundo novo, em branco, por cima -
foi exatamente o acidente de 02/09/2026. Nada foi iniciado.

Confira se a distro esta de pe:   wsl -l -v
E se o caminho existe:            wsl -d $Distro -e ls '$DataPath'
"@
}

function Invoke-Compose {
    # ComposeArgs entra como array explicito, nao como
    # ValueFromRemainingArguments: com o segundo, o binder do PowerShell tenta
    # casar "-d" com um nome de parametro e o argumento some - o compose roda
    # em foreground e o script trava esperando o container terminar.
    param(
        [Parameter(Mandatory = $true)][string]$RootDir,
        [Parameter(Mandatory = $true)][string[]]$ComposeArgs
    )
    $envMap = Read-DotEnv (Join-Path $RootDir '.env')
    $dataPath = $envMap['DATA_PATH']
    $distro = if ($envMap['WSL_DISTRO']) { $envMap['WSL_DISTRO'] } else { 'Ubuntu' }

    if ($dataPath -and $dataPath.StartsWith('/')) {
        # So checa quando o comando pode CRIAR container. Um "logs" ou
        # "ps" nao precisa do mundo e nao deve falhar por causa dele.
        if ($ComposeArgs -contains 'up') {
            Assert-MundoAcessivel -Distro $distro -DataPath $dataPath
        }
        $projLinux = ConvertTo-WslPath $RootDir
        $cmd = "cd '$projLinux' && docker compose " + ($ComposeArgs -join ' ')
        wsl -d $distro -e bash -lc $cmd
    } else {
        & docker compose @ComposeArgs
    }
}
