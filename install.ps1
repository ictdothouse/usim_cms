# Non-technical installer (Windows): checks Docker, generates secrets if
# missing, builds and starts the stack. Run: .\install.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker not found. Install Docker Desktop first: https://docs.docker.com/desktop/install/windows-install/"
  exit 1
}
docker compose version *> $null
if (-not $?) {
  Write-Host "Docker Compose plugin not found. Update Docker Desktop."
  exit 1
}

if (-not (Test-Path .env)) {
  Write-Host "Creating .env from .env.example..."
  Copy-Item .env.example .env
}

function Set-IfBlank([string]$Key) {
  $content = Get-Content .env -Raw
  if ($content -match "(?m)^$Key=\s*$") {
    $value = node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
    $content = $content -replace "(?m)^$Key=.*", "$Key=$value"
    Set-Content .env $content -Encoding utf8 -NoNewline
    Write-Host "Generated a random $Key."
  }
}
Set-IfBlank "POSTGRES_SUPERUSER_PASSWORD"
Set-IfBlank "SESSION_SECRET"

Write-Host "Building and starting containers (this can take a few minutes the first time)..."
docker compose up -d --build

Write-Host ""
Write-Host "Waiting for the API to become healthy..."
for ($i = 0; $i -lt 30; $i++) {
  try {
    $res = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 2
    if ($res.StatusCode -eq 200) { break }
  } catch {}
  Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Done. Admin panel:    http://localhost:5173"
Write-Host "      Public site:    http://localhost:4321"
Write-Host "      API:            http://localhost:3000"
Write-Host ""
Write-Host "First-time setup (no superadmin account exists yet) - see README/wizard for creating one."
