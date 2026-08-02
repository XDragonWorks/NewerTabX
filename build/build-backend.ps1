param(
    [string]$Version = "",
    [string]$Repo = $env:GITHUB_REPO
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$AppVersion = & $PSScriptRoot\Get-AppVersion.ps1 $Version

Write-Host "[1/4] Writing app-meta.json (version=$AppVersion, repo=$Repo)"
@{ version = $AppVersion; repo = $Repo } | ConvertTo-Json -Compress | Set-Content -Encoding ascii backend\app-meta.json

Write-Host "[2/4] Building frontend"
Push-Location frontend
try {
    if (Test-Path node_modules) { npm install } else { npm ci }
    if ($LASTEXITCODE) { exit 1 }
    npm run build
    if ($LASTEXITCODE) { exit 1 }
} finally {
    Pop-Location
}

Write-Host "[3/4] Installing Python dependencies"
python -m pip install -r backend\requirements.txt nuitka pillow
if ($LASTEXITCODE) { exit 1 }
python build\make-icon.py
if ($LASTEXITCODE) { exit 1 }

Write-Host "[4/4] Nuitka standalone build (first run takes several minutes)"
$nuitkaArgs = @(
    "--standalone",
    "--windows-console-mode=disable",
    "--windows-icon-from-ico=assets/icon.ico",
    "--include-package=uvicorn",
    "--include-package=wsgidav",
    "--include-package-data=wsgidav",
    "--nofollow-import-to=tkinter",
    "--nofollow-import-to=turtle",
    "--nofollow-import-to=idlelib",
    "--nofollow-import-to=unittest",
    "--nofollow-import-to=doctest",
    "--nofollow-import-to=pydoc",
    "--include-data-dir=backend/public=public",
    "--include-data-file=backend/app-meta.json=app-meta.json",
    "--assume-yes-for-downloads",
    "--output-dir=dist",
    "--output-filename=NewerTabX.exe",
    "backend\main.py"
)
python -m nuitka @nuitkaArgs
if ($LASTEXITCODE) { exit 1 }

Remove-Item assets\icon.ico -ErrorAction SilentlyContinue
if (Test-Path dist\NewerTabX) { Remove-Item dist\NewerTabX -Recurse -Force }
Move-Item dist\main.dist dist\NewerTabX

Write-Host ""
Write-Host "Build complete: dist\NewerTabX\NewerTabX.exe"
Write-Host "To make a portable zip, run: build\package-portable.ps1 $AppVersion"
