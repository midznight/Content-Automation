param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot
Set-Location -LiteralPath $ProjectDir

Write-Host "=== Automation-Content Hub | Local Rp0 Host ===" -ForegroundColor Cyan

$PythonLauncher = Get-Command "py" -ErrorAction SilentlyContinue
if (-not $PythonLauncher) {
    throw "Python Launcher tidak ditemukan. Pasang Python 3.12 dari https://www.python.org/downloads/windows/ lalu centang Python Launcher saat instalasi."
}
& py -3.12 --version
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.12 belum tersedia. Pasang Python 3.12 lalu jalankan script ini lagi."
}

$CloudflaredCommand = Get-Command "cloudflared" -ErrorAction SilentlyContinue
if (-not $CloudflaredCommand) {
    throw "cloudflared belum terpasang. Ikuti panduan resmi: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
}

$VenvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
    Write-Host "Membuat virtual environment Python..." -ForegroundColor Yellow
    & py -3.12 -m venv (Join-Path $ProjectDir ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Gagal membuat virtual environment." }
}

Write-Host "Memasang dependensi Hub..." -ForegroundColor Yellow
& $VenvPython -m pip install --disable-pip-version-check -e .
if ($LASTEXITCODE -ne 0) { throw "Instalasi dependensi gagal." }

$DataDir = Join-Path $ProjectDir "data"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$DatabasePath = [System.IO.Path]::GetFullPath((Join-Path $DataDir "hub.db")).Replace([char]92, [char]47)
$env:DATABASE_URL = "sqlite:///$DatabasePath"
$env:MCP_ALLOWED_ORIGINS = ""

$StdoutLog = Join-Path $env:TEMP "automation-content-cloudflared-out.log"
$StderrLog = Join-Path $env:TEMP "automation-content-cloudflared-error.log"
Remove-Item -LiteralPath $StdoutLog, $StderrLog -Force -ErrorAction SilentlyContinue

Write-Host "Membuat Cloudflare Quick Tunnel gratis..." -ForegroundColor Yellow
Write-Host "Tunnel URL bersifat sementara dan akan berubah ketika script dijalankan ulang." -ForegroundColor DarkYellow

$TunnelProcess = Start-Process -FilePath $CloudflaredCommand.Source -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port", "--no-autoupdate") -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -WindowStyle Hidden -PassThru

try {
    $PublicUrl = $null
    $Deadline = (Get-Date).AddSeconds(90)

    do {
        Start-Sleep -Seconds 1
        $LogText = ""
        foreach ($LogFile in @($StdoutLog, $StderrLog)) {
            if (Test-Path -LiteralPath $LogFile) {
                $LogText += Get-Content -LiteralPath $LogFile -Raw -ErrorAction SilentlyContinue
            }
        }

        $Match = [regex]::Match($LogText, "https://[a-z0-9-]+\.trycloudflare\.com")
        if ($Match.Success) {
            $PublicUrl = $Match.Value
            break
        }

        if ($TunnelProcess.HasExited) {
            throw "cloudflared berhenti sebelum URL tunnel dibuat. Periksa instalasi cloudflared dan koneksi internet."
        }
    } while ((Get-Date) -lt $Deadline)

    if (-not $PublicUrl) {
        throw "URL Quick Tunnel tidak muncul dalam 90 detik. Periksa koneksi internet dan cloudflared."
    }

    $PublicHost = ([uri]$PublicUrl).Host
    $env:MCP_ALLOWED_HOSTS = $PublicHost + "," + $PublicHost + ":*,localhost,localhost:*,127.0.0.1,127.0.0.1:*,[::1]:*"

    Write-Host ""
    Write-Host "URL publik Hub:" -ForegroundColor Green
    Write-Host ($PublicUrl + "/mcp") -ForegroundColor Green
    Write-Host ("Health check: " + $PublicUrl + "/health")
    Write-Host ""
    Write-Host "Quick Tunnel tidak mendukung SSE. Hub memakai respons MCP JSON untuk panggilan tool." -ForegroundColor Yellow
    Write-Host "Simpan URL ini di konfigurasi konektor Muse/Cue. Bila URL berubah, perbarui konfigurasi agen."
    Write-Host "Tekan Ctrl+C untuk menghentikan Hub dan tunnel."
    Write-Host ""

    Write-Host "Menjalankan migrasi database lokal..." -ForegroundColor Yellow
    & $VenvPython -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw "Migrasi database gagal. Periksa output Alembic." }

    Write-Host "Menjalankan Automation-Content Hub..." -ForegroundColor Green
    & $VenvPython -m uvicorn hub.main:app --host 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw "Uvicorn berhenti dengan kode $LASTEXITCODE." }
}
finally {
    if ($TunnelProcess -and -not $TunnelProcess.HasExited) {
        Stop-Process -Id $TunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $StdoutLog, $StderrLog -Force -ErrorAction SilentlyContinue
}
