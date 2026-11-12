<#
.SYNOPSIS
  就地更新 Nestory 的线上镜像（不重建实例、不动数据库）。

.DESCRIPTION
  只改 Deployment 里的镜像 tag，Kubernetes 滚动替换 pod；MySQL、对象存储桶、
  用户数据全部保留。失败可 -Rollback 回到上一个 revision。

.EXAMPLE
  .\deploy\update-image.ps1 -Tag 0.3.4
  .\deploy\update-image.ps1 -Rollback
#>
param(
  [Parameter(Mandatory = $false)]
  [string]$Tag,

  [string]$Repo = 'ghcr.io/crisxuhey777/nestory',
  [string]$Deployment,
  [string]$Namespace,
  [switch]$Rollback,
  [int]$TimeoutSec = 240
)

$ErrorActionPreference = 'Stop'
if (-not $env:KUBECONFIG) { $env:KUBECONFIG = Join-Path $env:USERPROFILE '.sealos\kubeconfig' }

function Invoke-Kubectl {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'  # kubectl 的 Warning 走 stderr，不该当异常
  try {
    $out = & kubectl @Args 2>&1
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LASTEXITCODE -ne 0) { throw "kubectl $($Args -join ' ') 失败:`n$($out -join "`n")" }
  return @($out | ForEach-Object { "$_" } | Where-Object { $_ -notmatch '^Warning:' })
}

# 自动找到 Nestory 的 Deployment（按镜像仓库匹配，避免误伤 mysql 之类）
if (-not $Deployment) {
  $deployJson = (kubectl get deploy -o json) | ConvertFrom-Json
  $match = $deployJson.items |
    Where-Object { $_.spec.template.spec.containers[0].image -like "$Repo*" } |
    Select-Object -First 1
  if (-not $match) { throw "没找到镜像仓库为 $Repo 的 Deployment" }
  $Deployment = $match.metadata.name
}
if (-not $Namespace) {
  $Namespace = kubectl config view --minify -o jsonpath='{.contexts[0].context.namespace}'
}

$container = kubectl get deploy $Deployment -o jsonpath='{.spec.template.spec.containers[0].name}'
$current = kubectl get deploy $Deployment -o jsonpath='{.spec.template.spec.containers[0].image}'
Write-Host "deployment : $Deployment (namespace $Namespace)"
Write-Host "container  : $container"
Write-Host "current    : $current"

if ($Rollback) {
  Write-Host "`n回滚到上一个 revision ..."
  Invoke-Kubectl rollout undo "deploy/$Deployment" | Out-Host
  Invoke-Kubectl rollout status "deploy/$Deployment" --timeout="$($TimeoutSec)s" | Out-Host
  $now = kubectl get deploy $Deployment -o jsonpath='{.spec.template.spec.containers[0].image}'
  Write-Host "now        : $now"
  return
}

if (-not $Tag) { throw '需要 -Tag（例如 0.3.4）或 -Rollback' }
$image = "$Repo`:$Tag"
$currentEnv = (kubectl get deploy $Deployment -o json | ConvertFrom-Json).spec.template.spec.containers[0].env |
  Where-Object { $_.name -eq 'NESTORY_VERSION' } | Select-Object -First 1
$sameImage = $image -eq $current
$sameEnv = $currentEnv -and $currentEnv.value -eq $Tag
if ($sameImage -and $sameEnv) { Write-Host "`n已经是 $image（NESTORY_VERSION=$Tag），无需更新。"; return }

Write-Host "`n更新到 $image ..."
if (-not $sameImage) { Invoke-Kubectl set image "deploy/$Deployment" "$container=$image" | Out-Host }
if (-not $sameEnv) { $null = Invoke-Kubectl set env "deploy/$Deployment" "NESTORY_VERSION=$Tag" }
Invoke-Kubectl rollout status "deploy/$Deployment" --timeout="$($TimeoutSec)s" | Out-Host

$now = kubectl get deploy $Deployment -o jsonpath='{.spec.template.spec.containers[0].image}'
$ready = kubectl get deploy $Deployment -o jsonpath='{.status.readyReplicas}'
Write-Host "now        : $now (ready $ready)"

$ingressJson = (kubectl get ingress -o json) | ConvertFrom-Json
$host_ = $ingressJson.items | ForEach-Object { $_.spec.rules[0].host } | Where-Object { $_ } | Select-Object -First 1
if ($host_) {
  try {
    $health = Invoke-RestMethod "https://$host_/api/health" -TimeoutSec 20
    Write-Host "health     : https://$host_/api/health → status=$($health.status) version=$($health.version) db=$($health.db.ok)"
  } catch {
    Write-Warning "健康检查失败: $($_.Exception.Message)"
  }
}
