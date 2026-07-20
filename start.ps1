# SyncStream - Start server + public tunnel together
# Usage: right-click this file -> "Run with PowerShell", OR run:
#   powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = 'Stop'

# Ensure Node.js is on PATH
$nodePath = "C:\Program Files\nodejs"
if (Test-Path $nodePath) { $env:Path += ";$nodePath" }

$root = $PSScriptRoot
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Starting SyncStream" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# 1. Build the client (so the server serves the latest UI)
Write-Host "`n[1/3] Building client..." -ForegroundColor Yellow
Push-Location (Join-Path $root "client")
npm run build
Pop-Location

# 2. Start the backend server (serves client + socket.io on port 3001)
Write-Host "`n[2/3] Starting server on http://localhost:3001 ..." -ForegroundColor Yellow
$server = Start-Process -FilePath "node" -ArgumentList "index.js" `
    -WorkingDirectory (Join-Path $root "server") -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 2

# 3. Start the Cloudflare tunnel
if (-not (Test-Path $cloudflared)) {
    Write-Host "cloudflared not found at $cloudflared" -ForegroundColor Red
    Write-Host "Install it with: winget install Cloudflare.cloudflared" -ForegroundColor Red
    exit 1
}

Write-Host "`n[3/3] Starting public tunnel..." -ForegroundColor Yellow
Write-Host "Look for the https://<name>.trycloudflare.com URL below." -ForegroundColor Green
Write-Host "Share that link with your phone / friends.`n" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop everything.`n" -ForegroundColor DarkGray

# Stop the server when the tunnel is closed
try {
    & $cloudflared tunnel --url http://localhost:3001
}
finally {
    Write-Host "`nStopping server..." -ForegroundColor Yellow
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "SyncStream stopped." -ForegroundColor Cyan
}
