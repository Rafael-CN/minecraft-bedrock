<#
.SYNOPSIS
    Instala .mcpack / .mcaddon / .mcworld no mundo do servidor Bedrock.

.DESCRIPTION
    Le os arquivos de ..\addons, descobre o que cada um e (lendo o
    manifest.json de dentro), copia para dentro da pasta do mundo e
    registra em world_behavior_packs.json / world_resource_packs.json.

    Instalar DENTRO do mundo (e nao na raiz do servidor) e de proposito:
    o mundo fica autocontido, sobrevive a update do servidor, e pode ser
    exportado depois como .mcworld com os addons junto.

.EXAMPLE
    .\Install-Addons.ps1
    .\Install-Addons.ps1 -Force
    .\Install-Addons.ps1 -File "C:\Downloads\MeuAddon.mcaddon"
#>
[CmdletBinding()]
param(
    # Instala um arquivo especifico em vez de varrer a pasta addons.
    [string]$File,

    [string]$AddonsDir,
    [string]$DataDir,

    # Sobrescreve o nome do mundo definido no .env
    [string]$LevelName,

    # Substitui packs/mundos ja instalados sem perguntar.
    [switch]$Force,

    # Ao importar um .mcworld, ja aponta LEVEL_NAME do .env para ele.
    [switch]$SetLevel
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
if (-not $AddonsDir) { $AddonsDir = Join-Path $root 'addons' }
$envFile = Join-Path $root '.env'

# ---------------------------------------------------------------- helpers

function Write-Step  { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "    OK   $m" -ForegroundColor Green }
function Write-Skip  { param($m) Write-Host "    --   $m" -ForegroundColor DarkGray }
function Write-Warn2 { param($m) Write-Host "    !    $m" -ForegroundColor Yellow }
function Write-Err2  { param($m) Write-Host "    X    $m" -ForegroundColor Red }

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

function Set-DotEnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $lines = @(Get-Content -LiteralPath $Path)
    $done = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") {
            $lines[$i] = "$Key=$Value"
            $done = $true
        }
    }
    if (-not $done) { $lines += "$Key=$Value" }
    Set-Content -LiteralPath $Path -Value $lines -Encoding ASCII
}

# manifest.json de addon quase sempre vem com comentario e virgula sobrando.
# Tira isso, mantendo o resto do texto intacto.
function Get-CleanJsonText {
    param([string]$Raw)
    $t = $Raw.TrimStart([char]0xFEFF)
    $t = [regex]::Replace($t, '/\*.*?\*/', '', 'Singleline')
    $t = [regex]::Replace($t, '(?m)^\s*//.*$', '')
    $t = [regex]::Replace($t, ',(\s*[\}\]])', '$1')
    return $t
}

function ConvertFrom-LooseJson {
    param([string]$Path)
    $clean = Get-CleanJsonText ([System.IO.File]::ReadAllText($Path))
    return ($clean | ConvertFrom-Json)
}

# O servidor Bedrock e MAIS rigoroso que o cliente: um manifest.json com
# comentario ou virgula sobrando faz ele recusar o pack inteiro, com
# "Unable to parse pack manifest" no log. Como o cliente aceita, muito addon
# publicado vem assim. Regrava o manifest limpo quando for o caso.
function Repair-Manifest {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    $raw = [System.IO.File]::ReadAllText($Path)
    $clean = Get-CleanJsonText $raw
    if ($clean -eq $raw) { return $false }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $clean, $utf8NoBom)
    return $true
}

function ConvertTo-PackVersion {
    param($Version)
    if ($null -eq $Version) { return @(1, 0, 0) }
    $nums = @()
    if ($Version -is [string]) {
        foreach ($p in ($Version -split '[\.\-]')) {
            $n = 0
            if ([int]::TryParse($p, [ref]$n)) { $nums += $n }
        }
    } else {
        foreach ($p in @($Version)) {
            $n = 0
            if ([int]::TryParse([string]$p, [ref]$n)) { $nums += $n } else { $nums += 0 }
        }
    }
    while ($nums.Count -lt 3) { $nums += 0 }
    return @($nums[0], $nums[1], $nums[2])
}

function Get-Slug {
    param([string]$Text)
    $s = $Text -replace '[^A-Za-z0-9\-_ ]', ''
    $s = $s.Trim() -replace '\s+', '_'
    if ($s.Length -gt 40) { $s = $s.Substring(0, 40) }
    if ([string]::IsNullOrWhiteSpace($s)) { $s = 'pack' }
    return $s
}

function Expand-ArchiveTo {
    param([string]$Zip, [string]$Dest)
    if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }
    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Dest)
    } catch {
        $nome = [System.IO.Path]::GetFileName($Zip)
        throw "nao consegui abrir '$nome' como zip: $($_.Exception.Message)"
    }
}

# .mcaddon costuma ter .mcpack dentro. Abre ate nao sobrar zip aninhado.
function Expand-NestedArchives {
    param([string]$Dir)
    for ($round = 0; $round -lt 5; $round++) {
        $nested = @(Get-ChildItem -LiteralPath $Dir -Recurse -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Extension -match '^\.(mcpack|mcaddon|zip)$' })
        if ($nested.Count -eq 0) { return }
        foreach ($n in $nested) {
            $target = Join-Path $n.DirectoryName ([System.IO.Path]::GetFileNameWithoutExtension($n.Name) + '_x')
            try {
                Expand-ArchiveTo -Zip $n.FullName -Dest $target
            } catch {
                Write-Warn2 "ignorando $($n.Name): $($_.Exception.Message)"
            }
            Remove-Item -LiteralPath $n.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-PackRoots {
    param([string]$Dir)
    $manifests = @(Get-ChildItem -LiteralPath $Dir -Recurse -File -Filter 'manifest.json' -ErrorAction SilentlyContinue |
                   Sort-Object { $_.FullName.Length })
    $roots = @()
    foreach ($m in $manifests) {
        $packDir = $m.DirectoryName
        $inside = $false
        foreach ($r in $roots) {
            if ($packDir.StartsWith($r.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { $inside = $true; break }
        }
        if (-not $inside) { $roots += $packDir }
    }
    return $roots
}

function Get-PackInfo {
    param([string]$PackDir)
    $m = ConvertFrom-LooseJson -Path (Join-Path $PackDir 'manifest.json')

    $uuid = $null
    if ($m.header) { $uuid = $m.header.uuid }
    if (-not $uuid) { return $null }

    $types = @()
    if ($m.modules) {
        foreach ($mod in $m.modules) {
            if ($mod.type) { $types += ([string]$mod.type).ToLower() }
        }
    }

    $kind = $null
    if ($types -contains 'data' -or $types -contains 'script' -or $types -contains 'client_data') {
        $kind = 'behavior_packs'
    } elseif ($types -contains 'resources') {
        $kind = 'resource_packs'
    } elseif ($types -contains 'skin_pack') {
        $kind = 'skin_pack'
    } elseif ($types -contains 'world_template') {
        $kind = 'world_template'
    }

    $deps = @()
    if ($m.dependencies) {
        foreach ($d in $m.dependencies) {
            if ($d.uuid) { $deps += [string]$d.uuid }
        }
    }

    $name = ''
    if ($m.header.name) { $name = [string]$m.header.name }

    return [pscustomobject]@{
        Dir       = $PackDir
        Uuid      = [string]$uuid
        Version   = (ConvertTo-PackVersion $m.header.version)
        Kind      = $kind
        Types     = $types
        Name      = $name
        DependsOn = $deps
        HasScript = ($types -contains 'script')
    }
}

function Read-WorldPackList {
    param([string]$Path)
    $list = New-Object System.Collections.ArrayList
    if (Test-Path $Path) {
        try {
            foreach ($e in @(ConvertFrom-LooseJson -Path $Path)) {
                if ($e.pack_id) {
                    [void]$list.Add(@{ pack_id = [string]$e.pack_id; version = (ConvertTo-PackVersion $e.version) })
                }
            }
        } catch {
            Write-Warn2 "$(Split-Path -Leaf $Path) estava ilegivel, sera recriado"
        }
    }
    # A virgula e obrigatoria: sem ela o PowerShell desenrola a lista
    # e uma lista vazia volta como $null.
    return ,$list
}

function Write-WorldPackList {
    param([string]$Path, $List)
    $out = @()
    foreach ($e in $List) {
        $out += [pscustomobject]@{ pack_id = $e.pack_id; version = @($e.version) }
    }
    $json = ConvertTo-Json -InputObject @($out) -Depth 5
    if (-not $json.TrimStart().StartsWith('[')) { $json = "[$json]" }
    Set-Content -LiteralPath $Path -Value $json -Encoding ASCII
}

# ---------------------------------------------------------------- setup

$envMap = Read-DotEnv -Path $envFile

# O mundo vive no WSL2 (~80x mais rapido que pasta do Windows). O caminho
# UNC funciona igual para o PowerShell: \wsl.localhost\Ubuntu\home\...
if (-not $DataDir) {
    if ($envMap['DATA_UNC']) { $DataDir = $envMap['DATA_UNC'] }
    else { $DataDir = Join-Path $root 'data' }
}
if (-not (Test-Path $DataDir)) {
    throw "pasta de dados nao encontrada: $DataDir  (o WSL2 esta rodando? tente: wsl -d Ubuntu -e true)"
}

if (-not $LevelName) {
    if ($envMap.ContainsKey('LEVEL_NAME') -and $envMap['LEVEL_NAME']) {
        $LevelName = $envMap['LEVEL_NAME']
    } else {
        $LevelName = 'Bedrock level'
    }
}

$worldsDir = Join-Path $DataDir 'worlds'
$levelDir  = Join-Path $worldsDir $LevelName

Write-Host ''
Write-Step "Mundo alvo: $LevelName"
Write-Host "    $levelDir" -ForegroundColor DarkGray

if ($File) {
    if (-not (Test-Path -LiteralPath $File)) { throw "arquivo nao encontrado: $File" }
    $files = @(Get-Item -LiteralPath $File)
} else {
    if (-not (Test-Path $AddonsDir)) { throw "pasta nao encontrada: $AddonsDir" }
    $files = @(Get-ChildItem -LiteralPath $AddonsDir -File |
               Where-Object { $_.Extension -match '^\.(mcpack|mcaddon|mcworld|mctemplate|zip)$' } |
               Sort-Object Name)
}

if ($files.Count -eq 0) {
    Write-Host ''
    Write-Warn2 "nenhum .mcpack / .mcaddon / .mcworld / .mctemplate encontrado em $AddonsDir"
    Write-Host ''
    return
}

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('mcaddon_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null

$installed   = @()
$scriptPacks = @()

try {
    # ---------------------------------------------------- 1) mundos (.mcworld)
    # .mctemplate e .mcworld sao a mesma coisa para o servidor: uma pasta de
    # mundo dentro de um zip. O template so traz um manifest.json a mais na
    # raiz, que o servidor ignora.
    foreach ($w in @($files | Where-Object { $_.Extension -eq '.mcworld' -or $_.Extension -eq '.mctemplate' })) {
        Write-Host ''
        Write-Step "Mundo: $($w.Name)"
        $wName = Get-Slug ([System.IO.Path]::GetFileNameWithoutExtension($w.Name))
        $wDest = Join-Path $worldsDir $wName

        if ((Test-Path $wDest) -and -not $Force) {
            Write-Skip "ja existe em worlds\$wName (use -Force para sobrescrever)"
        } else {
            if (Test-Path $wDest) { Remove-Item -LiteralPath $wDest -Recurse -Force }
            Expand-ArchiveTo -Zip $w.FullName -Dest $wDest
            if (-not (Test-Path (Join-Path $wDest 'level.dat'))) {
                Write-Warn2 'sem level.dat dentro - talvez nao seja um mundo valido'
            }
            Write-Ok "extraido em data\worlds\$wName"
        }

        if ($LevelName -ne $wName) {
            $answer = 'n'
            if ($SetLevel) {
                $answer = 's'
            } else {
                Write-Host ''
                Write-Host '    Este mundo NAO e o mundo ativo do servidor.' -ForegroundColor Yellow
                Write-Host "    Ativo hoje: '$LevelName'   |   Importado: '$wName'" -ForegroundColor Yellow
                $answer = Read-Host "    Apontar o servidor para '$wName'? (S/n)"
                if ([string]::IsNullOrWhiteSpace($answer)) { $answer = 's' }
            }
            if ($answer -match '^[sSyY]') {
                Set-DotEnvValue -Path $envFile -Key 'LEVEL_NAME' -Value $wName
                $LevelName = $wName
                $levelDir  = Join-Path $worldsDir $wName
                Write-Ok "LEVEL_NAME do .env agora e '$wName' (precisa de restart)"
            } else {
                Write-Skip 'mundo importado mas nao ativado'
            }
        }
    }

    if (-not (Test-Path $levelDir)) {
        New-Item -ItemType Directory -Path $levelDir -Force | Out-Null
        Write-Warn2 "a pasta do mundo '$LevelName' ainda nao existia; foi criada."
        Write-Warn2 'o servidor gera o mundo de verdade no primeiro boot.'
    }

    $bpListPath = Join-Path $levelDir 'world_behavior_packs.json'
    $rpListPath = Join-Path $levelDir 'world_resource_packs.json'
    $bpList = Read-WorldPackList -Path $bpListPath
    $rpList = Read-WorldPackList -Path $rpListPath

    # ---------------------------------------------------- 2) packs
    foreach ($f in @($files | Where-Object { $_.Extension -ne '.mcworld' -and $_.Extension -ne '.mctemplate' })) {
        Write-Host ''
        Write-Step "Pack: $($f.Name)"
        $work = Join-Path $tmpRoot ([guid]::NewGuid().ToString('N').Substring(0, 8))
        try {
            Expand-ArchiveTo -Zip $f.FullName -Dest $work
        } catch {
            Write-Err2 $_.Exception.Message
            continue
        }
        Expand-NestedArchives -Dir $work

        $roots = @(Get-PackRoots -Dir $work)
        if ($roots.Count -eq 0) {
            Write-Err2 'nenhum manifest.json dentro - nao parece um addon de Bedrock'
            continue
        }

        foreach ($r in $roots) {
            $info = $null
            try {
                $info = Get-PackInfo -PackDir $r
            } catch {
                Write-Err2 "manifest ilegivel em $(Split-Path -Leaf $r): $($_.Exception.Message)"
                continue
            }
            if (-not $info) {
                Write-Err2 "manifest sem uuid em $(Split-Path -Leaf $r)"
                continue
            }

            if ($info.Kind -eq 'skin_pack') {
                Write-Skip 'skin pack (roda no cliente, nao no servidor)'
                continue
            }
            if ($info.Kind -eq 'world_template') {
                Write-Skip 'world template - crie o mundo no jogo e traga o .mcworld exportado'
                continue
            }
            if (-not $info.Kind) {
                Write-Err2 "tipo de pack nao reconhecido (modules: $($info.Types -join ','))"
                continue
            }

            $label = $info.Name
            if ([string]::IsNullOrWhiteSpace($label) -or $label -match '^\s*pack\.') {
                $label = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
            }
            $folder  = (Get-Slug $label) + '_' + $info.Uuid.Replace('-', '').Substring(0, 8)
            $kindDir = Join-Path $levelDir $info.Kind
            $dest    = Join-Path $kindDir $folder
            $verStr  = ($info.Version -join '.')

            if ((Test-Path $dest) -and -not $Force) {
                $sameVersion = $false
                if (Test-Path (Join-Path $dest 'manifest.json')) {
                    try {
                        $old = Get-PackInfo -PackDir $dest
                        if ($old -and (($old.Version -join '.') -eq $verStr)) { $sameVersion = $true }
                    } catch { }
                }
                if ($sameVersion) {
                    Write-Skip "$label v$verStr ja instalado"
                } else {
                    Remove-Item -LiteralPath $dest -Recurse -Force
                    Copy-Item -LiteralPath $r -Destination $dest -Recurse -Force
                    if (Repair-Manifest (Join-Path $dest 'manifest.json')) { Write-Warn2 'manifest tinha comentario/virgula sobrando; foi limpo' }
                    Write-Ok "$label atualizado para v$verStr"
                }
            } else {
                if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
                if (-not (Test-Path $kindDir)) { New-Item -ItemType Directory -Path $kindDir -Force | Out-Null }
                Copy-Item -LiteralPath $r -Destination $dest -Recurse -Force
                if (Repair-Manifest (Join-Path $dest 'manifest.json')) { Write-Warn2 'manifest tinha comentario/virgula sobrando; foi limpo' }
                $tipo = 'behavior'
                if ($info.Kind -eq 'resource_packs') { $tipo = 'resource' }
                Write-Ok "$label v$verStr instalado como $tipo pack"
            }

            $targetList = $bpList
            if ($info.Kind -eq 'resource_packs') { $targetList = $rpList }

            $entry = $null
            foreach ($e in $targetList) { if ($e.pack_id -eq $info.Uuid) { $entry = $e; break } }
            if ($entry) {
                $entry.version = $info.Version
            } else {
                [void]$targetList.Add(@{ pack_id = $info.Uuid; version = $info.Version })
            }

            $installed += $info
            if ($info.HasScript) { $scriptPacks += $label }
        }
    }

    Write-WorldPackList -Path $bpListPath -List $bpList
    Write-WorldPackList -Path $rpListPath -List $rpList

    # ---------------------------------------------------- 3) conferencia
    Write-Host ''
    Write-Step 'Resultado'
    Write-Host "    behavior packs ativos no mundo: $($bpList.Count)"
    Write-Host "    resource packs ativos no mundo: $($rpList.Count)"

    $ativos = @()
    foreach ($e in $bpList) { $ativos += $e.pack_id }
    foreach ($e in $rpList) { $ativos += $e.pack_id }

    $faltando = @()
    foreach ($i in $installed) {
        foreach ($d in $i.DependsOn) {
            if ($ativos -notcontains $d) {
                $nome = $i.Name
                if ([string]::IsNullOrWhiteSpace($nome)) { $nome = $i.Uuid }
                $faltando += "$nome depende do pack $d, que nao esta instalado"
            }
        }
    }
    if ($faltando.Count -gt 0) {
        Write-Host ''
        Write-Warn2 'dependencias faltando:'
        foreach ($x in ($faltando | Select-Object -Unique)) {
            Write-Host "         $x" -ForegroundColor Yellow
        }
        Write-Host '         normalmente e a outra metade do addon (o resource pack).' -ForegroundColor DarkGray
    }

    if ($scriptPacks.Count -gt 0) {
        Write-Host ''
        Write-Warn2 "packs com script detectados: $(($scriptPacks | Select-Object -Unique) -join ', ')"
        Write-Host "         esses quase sempre exigem o experimento 'Beta APIs' LIGADO no mundo." -ForegroundColor DarkGray
        Write-Host "         experimento nao se liga por arquivo - veja 'Experimentos' em docs/operacao.md." -ForegroundColor DarkGray
    }

    Write-Host ''
    Write-Host '    Agora rode:  .\scripts\mc.ps1 restart' -ForegroundColor White
    Write-Host '    E confira:   .\scripts\mc.ps1 logs' -ForegroundColor White
    Write-Host ''
}
finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}
