$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeHome = Join-Path $projectRoot ".tools\node-v24.20.0-win-x64"
$pnpmHome = Join-Path $projectRoot ".tools\pnpm"

$env:Path = "$nodeHome;$pnpmHome;$env:Path"
Set-Location -LiteralPath $projectRoot

Write-Host "Delightive development environment activated."
node --version
pnpm --version
