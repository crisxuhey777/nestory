# Deploy Nestory to a Linux server: build -> pack -> upload -> restart -> health check.
# Run from the project root. Only backend/, dist/ and deploy/ are uploaded; the
# server keeps its own backend/db.env, backend/llm.env and database.
#
#   .\deploy\deploy.ps1 -Server 1.2.3.4
#   .\deploy\deploy.ps1 -Server baby.example.com -Key C:\Users\me\.ssh\id_ed25519
#   .\deploy\deploy.ps1 -Server 1.2.3.4 -SkipBuild
#   .\deploy\deploy.ps1 -Server 1.2.3.4 -SkipUpload     # remote steps only

param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$User = "root",
    [string]$Key = "",
    [switch]$SkipBuild,
    [switch]$SkipUpload
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Target = "$User@$Server"
$Tarball = Join-Path $env:TEMP "nestory-release.tgz"
$SshOpts = @("-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new")
if ($Key) { $SshOpts += @("-i", $Key) }

function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments, [string]$FailMessage)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw $FailMessage }
}

if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    throw "tar.exe not found. Run this on Windows 10 1803+ / Windows 11, or use Git Bash tar."
}

Write-Host "==> 1/4 build frontend" -ForegroundColor Cyan
if ($SkipBuild) {
    Write-Host "    skipped (-SkipBuild)"
} else {
    Invoke-Native "npm.cmd" @("run", "build") "npm run build failed"
}
if (-not (Test-Path (Join-Path $Root "dist\index.html"))) {
    throw "dist\index.html missing - run npm run build first"
}

if (-not $SkipUpload) {
    Write-Host "==> 2/4 pack backend / dist / deploy" -ForegroundColor Cyan
    if (Test-Path $Tarball) { Remove-Item $Tarball -Force }
    Invoke-Native "tar.exe" @(
        "-czf", $Tarball,
        "--exclude", "backend/logs",
        "--exclude", "backend/__pycache__",
        "--exclude", "backend/db.env",
        "--exclude", "backend/llm.env",
        "-C", $Root, "backend", "dist", "deploy"
    ) "tar packing failed"
    Write-Host ("    size {0:N2} MB" -f ((Get-Item $Tarball).Length / 1MB))

    Write-Host "==> 3/4 upload to $Target" -ForegroundColor Cyan
    Invoke-Native "scp.exe" ($SshOpts + @($Tarball, "${Target}:/tmp/nestory-release.tgz")) `
        "scp failed - check IP, password/key and that port 22 is open in the firewall"
} else {
    Write-Host "==> 2-3/4 skipped upload, using the tarball already on the server" -ForegroundColor Yellow
}

Write-Host "==> 4/4 unpack, restart, health check" -ForegroundColor Cyan
$remote = @'
set -e
if ! systemctl list-unit-files 2>/dev/null | grep -q '^nestory.service'; then
  echo "ERROR: nestory.service is not installed. Run deploy/install.sh on the server first."
  exit 2
fi
mkdir -p /opt/nestory /var/www/nestory
rm -rf /tmp/nestory-release && mkdir -p /tmp/nestory-release
tar -xzf /tmp/nestory-release.tgz -C /tmp/nestory-release

if [ -x /opt/nestory/venv/bin/pip ]; then
  /opt/nestory/venv/bin/pip install -q -r /tmp/nestory-release/backend/requirements.txt
fi

command -v rsync >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq rsync)
rsync -a --delete --exclude db.env --exclude llm.env --exclude logs --exclude __pycache__ \
  /tmp/nestory-release/backend/ /opt/nestory/backend/
rsync -a /tmp/nestory-release/deploy/ /opt/nestory/deploy/
rsync -a --delete /tmp/nestory-release/dist/ /var/www/nestory/
chown -R nestory:nestory /opt/nestory
chown -R www-data:www-data /var/www/nestory

systemctl restart nestory
sleep 2
systemctl is-active nestory
curl -fsS --max-time 5 http://127.0.0.1:8000/api/health
echo
nginx -t
systemctl reload nginx
echo "OK"
'@

$remote | & ssh.exe @SshOpts $Target "bash -s"
if ($LASTEXITCODE -ne 0) {
    throw "remote step failed - inspect: ssh $Target 'journalctl -u nestory -n 50'"
}

Write-Host ""
Write-Host "Deployed: http://$Server/" -ForegroundColor Green
