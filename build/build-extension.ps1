param([string]$Version = "")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$AppVersion = & $PSScriptRoot\Get-AppVersion.ps1 $Version

$staging = Join-Path $env:TEMP "newertabx-ext-$([System.IO.Path]::GetRandomFileName())"
New-Item -ItemType Directory $staging | Out-Null
Copy-Item browser-plugin\manifest.json, browser-plugin\newtab.html $staging

(Get-Content "$staging\manifest.json") -replace '"version": "[^"]*"', ('"version": "' + $AppVersion + '"') |
    Set-Content "$staging\manifest.json"

New-Item -ItemType Directory -Force dist | Out-Null
Compress-Archive -Path "$staging\*" -DestinationPath "dist\NewerTabX-extension-$AppVersion.zip" -Force
Remove-Item $staging -Recurse -Force

Write-Host "Extension package: dist\NewerTabX-extension-$AppVersion.zip"
