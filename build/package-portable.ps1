param([string]$Version = "")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$AppVersion = & $PSScriptRoot\Get-AppVersion.ps1 $Version

if (-not (Test-Path dist\NewerTabX\NewerTabX.exe)) {
    Write-Host "dist\NewerTabX not found. Run build\build-backend.ps1 first."
    exit 1
}

Set-Content -NoNewline dist\NewerTabX\portable.txt "portable"
Compress-Archive -Path dist\NewerTabX -DestinationPath "dist\NewerTabX-portable-$AppVersion-windows.zip" -Force

Write-Host "Portable package: dist\NewerTabX-portable-$AppVersion-windows.zip"
