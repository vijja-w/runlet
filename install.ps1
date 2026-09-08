$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repository = 'vijja-w/runlet'
$InstallRoot = if ($env:RUNLET_INSTALL_DIR) { $env:RUNLET_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\Runlet' }
$Asset = 'runlet-windows-x64.zip'
$ReleaseUrl = if ($env:RUNLET_VERSION) { "https://github.com/$Repository/releases/download/v$($env:RUNLET_VERSION)" } else { "https://github.com/$Repository/releases/latest/download" }

try {
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Runlet currently supports 64-bit Windows only.'
    }
    $Architecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
    if (-not $Architecture) { $Architecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE') }
    if ($Architecture -ne 'AMD64') {
        throw "Runlet currently supports Windows x64 only (detected $Architecture)."
    }

    $TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("runlet-install-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $TempRoot | Out-Null
    try {
        Write-Host 'Downloading Runlet for Windows x64...'
        $ArchivePath = Join-Path $TempRoot $Asset
        $ChecksumsPath = Join-Path $TempRoot 'SHA256SUMS'
        Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseUrl/$Asset" -OutFile $ArchivePath
        Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseUrl/SHA256SUMS" -OutFile $ChecksumsPath

        $ChecksumLine = Get-Content $ChecksumsPath | Where-Object { $_ -match "^[A-Fa-f0-9]{64}\s+\*?$([Regex]::Escape($Asset))$" } | Select-Object -First 1
        if (-not $ChecksumLine) { throw "No checksum was published for $Asset." }
        $Expected = ($ChecksumLine -split '\s+')[0].ToLowerInvariant()
        $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash.ToLowerInvariant()
        if ($Actual -ne $Expected) { throw 'The downloaded archive did not match its SHA-256 checksum.' }

        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $TempRoot -Force
        $ExtractedRoot = Join-Path $TempRoot 'runlet'
        if (-not (Test-Path -LiteralPath (Join-Path $ExtractedRoot 'runlet.cmd'))) { throw 'The release archive does not contain the Runlet launcher.' }
        if (-not (Test-Path -LiteralPath (Join-Path $ExtractedRoot 'runtime\node.exe'))) { throw 'The release archive does not contain its runtime.' }
        $InstalledVersion = (Get-Content -LiteralPath (Join-Path $ExtractedRoot 'package.json') -Raw | ConvertFrom-Json).version

        if (Test-Path -LiteralPath (Join-Path $InstallRoot 'runlet.cmd')) {
            & (Join-Path $InstallRoot 'runlet.cmd') kill 2>$null | Out-Null
        }
        if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path -Parent $InstallRoot) -Force | Out-Null
        Move-Item -LiteralPath $ExtractedRoot -Destination $InstallRoot

        $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $PathParts = @($UserPath -split ';' | Where-Object { $_ })
        if (-not ($PathParts | Where-Object { $_.TrimEnd('\') -ieq $InstallRoot.TrimEnd('\') })) {
            $NewUserPath = (@($PathParts) + $InstallRoot) -join ';'
            [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
        }
        if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $InstallRoot.TrimEnd('\') })) {
            $env:Path = "$InstallRoot;$env:Path"
        }

        Write-Host ''
        Write-Host "Runlet $InstalledVersion installed successfully."
        Write-Host 'Run: runlet'
        Write-Host 'Uninstall later with: runlet uninstall'
    }
    finally {
        if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
    }
}
catch {
    Write-Error "Runlet installation failed: $($_.Exception.Message)"
    exit 1
}
