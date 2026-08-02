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
python -m pip install -r backend\requirements.txt pyinstaller pillow
if ($LASTEXITCODE) { exit 1 }
python build\make-icon.py
if ($LASTEXITCODE) { exit 1 }

Write-Host "[4/4] PyInstaller build (usually under 2 minutes)"
$pyinstallerArgs = @(
    "--noconfirm", "--clean",
    "--distpath", "dist",
    "--workpath", ".pyinstaller-build",
    "--name", "NewerTabX",
    "--windowed",
    "--icon", "assets/icon.ico",
    "--add-data", "backend/public;public",
    "--add-data", "backend/app-meta.json;.",
    "--collect-all", "uvicorn",
    "--collect-all", "wsgidav",
    "--collect-all", "fastapi",
    "--collect-all", "starlette",
    "--collect-all", "pydantic",
    "--collect-submodules", "httpx",
    "--collect-submodules", "anyio",
    "backend\main.py"
)
python -m PyInstaller @pyinstallerArgs
if ($LASTEXITCODE) { exit 1 }
Remove-Item assets\icon.ico -ErrorAction SilentlyContinue
Remove-Item .pyinstaller-build, NewerTabX.spec -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Build complete: dist\NewerTabX\NewerTabX.exe"
Write-Host "To make a portable zip, run: build\package-portable.ps1 $AppVersion"
