<#
.SYNOPSIS
    Reinstala o servidor do zero num PC novo.

    Baixa o mundo e os addons da release do GitHub, poe o mundo dentro do
    WSL (no DATA_PATH do .env), os addons na pasta addons\ e sobe tudo.

    Antes de rodar, o PC precisa de:
      - WSL com a distro Ubuntu      wsl --install -d Ubuntu
      - Docker Desktop aberto, com Settings > Resources > WSL Integration > Ubuntu ligado
      - GitHub CLI logado            winget install GitHub.cli ; gh auth login

.EXAMPLE
    .\scripts\Restaurar.ps1                          # release mais recente
    .\scripts\Restaurar.ps1 -Tag mundo-2026-09-24    # uma release especifica
    .\scripts\Restaurar.ps1 -Force                   # sobrescreve um mundo que ja exista
#>
[CmdletBinding()]
param(
    [string]$Tag,
    [string]$Repo = 'Rafael-CN/minecraft-bedrock',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot '_Comum.ps1')

$envMap = Read-DotEnv (Join-Path $root '.env')
$distro = if ($envMap['WSL_DISTRO']) { $envMap['WSL_DISTRO'] } else { 'Ubuntu' }
$dataPath = $envMap['DATA_PATH']
if (-not $dataPath -or -not $dataPath.StartsWith('/')) {
    throw "DATA_PATH no .env precisa ser um caminho do WSL (ex: /home/rafael/minecraft-bedrock/data)."
}

foreach ($cmd in 'gh', 'docker', 'wsl') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Falta o '$cmd' neste PC. Veja o topo deste script." }
}

$wslHome = (wsl -d $distro -e sh -c 'echo $HOME' 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $wslHome) { throw "A distro '$distro' nao existe. Rode: wsl --install -d $distro" }
if (-not $dataPath.StartsWith("$wslHome/")) {
    Write-Warning "O DATA_PATH ($dataPath) nao fica dentro do seu home no WSL ($wslHome)."
    Write-Warning "Se o usuario do Ubuntu novo nao for 'rafael', troque /home/rafael no .env e no docker-compose.yml antes."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'O Docker Desktop nao esta rodando. Abra ele e rode de novo.' }

$existe = (wsl -d $distro -e sh -c "test -d '$dataPath/worlds' && echo sim" | Out-String).Trim()
if ($existe -eq 'sim' -and -not $Force) {
    throw "Ja existe um mundo em $dataPath. Nada foi mexido. Use -Force para sobrescrever."
}

$tmp = Join-Path $env:TEMP 'mc-restaurar'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$ghArgs = @('release', 'download')
if ($Tag) { $ghArgs += $Tag }
$ghArgs += @('--repo', $Repo, '--dir', $tmp, '--clobber')
Write-Host "Baixando a release de $Repo..." -ForegroundColor Cyan
& gh @ghArgs
if ($LASTEXITCODE -ne 0) { throw 'Nao consegui baixar a release. Confira o gh auth login.' }

$mundo = Get-ChildItem $tmp -Filter 'mundo-*.tar.gz' | Sort-Object Name | Select-Object -Last 1
$addons = Get-ChildItem $tmp -Filter 'addons-*.tar' | Sort-Object Name | Select-Object -Last 1
if (-not $mundo) { throw "A release nao tem o arquivo mundo-*.tar.gz." }

Write-Host "Colocando o mundo em $dataPath..." -ForegroundColor Cyan
$mundoWsl = ConvertTo-WslPath $mundo.FullName
$parent = $dataPath.Substring(0, $dataPath.LastIndexOf('/'))
wsl -d $distro -e bash -lc "mkdir -p '$dataPath' '$parent/backups' '$parent/data-teste' && tar -xzf '$mundoWsl' --strip-components=1 -C '$dataPath'"
if ($LASTEXITCODE -ne 0) { throw 'Falhou ao extrair o mundo.' }

if ($addons) {
    Write-Host 'Colocando os addons em addons\...' -ForegroundColor Cyan
    tar -xf $addons.FullName -C $root
}

Write-Host 'Subindo os containers (a primeira vez compila painel, mapa e backup)...' -ForegroundColor Cyan
Invoke-Compose -RootDir $root -ComposeArgs @('up', '-d', '--build')

Write-Host ''
Write-Host 'Pronto. O servidor leva ~1 min para aceitar conexao.' -ForegroundColor Green
Write-Host 'Painel: http://localhost:8080   Mapa: http://localhost:8081' -ForegroundColor White
Write-Host 'Os arquivos baixados ficaram em' $tmp '- pode apagar.' -ForegroundColor DarkGray
