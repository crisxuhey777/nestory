# 手动部署到 Sealos 杭州区（hzh.sealos.run）

面向：Windows + PowerShell，仓库 `D:\OneDrive\桌面\NESTORY`，镜像已在 GHCR 上。

和之前美国区（usw-1）的区别只有两处：**登录时指定 `--region`**，以及**域名后缀变成 `.hzh.sealos.run`**。模板本身不用改。

---

## 0. 前置检查

```powershell
python --version          # 3.10+
docker version            # 需要 Docker Desktop 已启动
gh auth status            # 需要 write:packages（推送镜像用）
kubectl version --client  # 可选，验证阶段用
```

仓库和模板要就位：

```powershell
cd 'D:\OneDrive\桌面\NESTORY'
Test-Path .sealos\template.yaml   # 应为 True
```

**账号侧**：国内区（sealos.run）必须完成**手机号注册 + 实名认证**，否则创建不了数据库和对象存储；另外确认账户里有余额或试用额度。

---

## 1. 准备镜像（二选一）

### 1A. 直接用已经推好的镜像

GHCR 上已有 `ghcr.io/crisxuhey777/nestory:0.3.6`。私有包需要让集群能拉取，**最简单的做法是改成公开**：

> GitHub → 你的头像 → **Packages** → `nestory` → 右侧 **Package settings** → 最下面 **Change visibility** → Public

改完就不需要第 3 步里的 Secret 了，模板 `.sealos/template.yaml` 可以直接用。

### 1B. 自己重新构建推送

Docker Hub 在这台机器上拉不动基础镜像，得先用国内镜像源打底：

```powershell
docker start 2>$null
Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'   # 没启动的话
# 等 30 秒，直到 docker version 正常

docker pull docker.m.daocloud.io/library/node:22-alpine
docker tag  docker.m.daocloud.io/library/node:22-alpine node:22-alpine
docker pull docker.m.daocloud.io/library/python:3.12-slim
docker tag  docker.m.daocloud.io/library/python:3.12-slim python:3.12-slim

gh auth token | docker login ghcr.io -u crisxuhey777 --password-stdin

cd 'D:\OneDrive\桌面\NESTORY'
docker buildx build --platform linux/amd64 `
  -t ghcr.io/crisxuhey777/nestory:0.3.7 --push .
```

> 版本号自己定（0.3.7、0.4.0 都行），但**模板里的镜像 tag 要同步改**：
> `.sealos/template.yaml` 第 189 行 `image:`、第 239 行 `NESTORY_VERSION`、第 166 行 `originImageName`。

---

## 2. 登录杭州区

```powershell
# 先备份美国区的 kubeconfig，方便回头查旧实例
Copy-Item "$env:USERPROFILE\.sealos\kubeconfig" "$env:USERPROFILE\.sealos\kubeconfig.usw1" -Force

cd 'C:\Users\crist\.dsh\sealos-skills\plugins\sealos\skills\use-sealos'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

python scripts\sealos-api.py login --region https://hzh.sealos.run
```

终端会打印一个设备码和一串字符，在浏览器打开提示的地址、登录、输入设备码确认。成功后：

```powershell
python scripts\sealos-api.py status
```

要看到类似：

```json
{"authenticated": true, "region": "https://hzh.sealos.run",
 "workspace": "ns-xxxxxxxx", "kubeconfig": "C:\\Users\\crist/.sealos/kubeconfig"}
```

> `region` 必须是 `hzh.sealos.run`。如果还是 `usw-1`，说明 `--region` 没生效，重跑登录。
> `PYTHONUTF8=1` 不能省，否则脚本读 YAML 时会 `UnicodeDecodeError: 'charmap'`。

---

## 3. 准备部署文件

### 3A. 镜像已公开（1A 路线）

```powershell
cd 'D:\OneDrive\桌面\NESTORY'
Copy-Item .sealos\template.yaml .sealos\deploy.yaml -Force
```

### 3B. 镜像仍私有（1B 路线）

模板里 `imagePullSecrets` 引用的是同名 Secret，需要在文件末尾追加一个 dockerconfigjson Secret：

```powershell
cd 'D:\OneDrive\桌面\NESTORY'
$token = (gh auth token).Trim()
$json  = @{ auths = @{ 'ghcr.io' = @{ auth = [Convert]::ToBase64String(
            [Text.Encoding]::UTF8.GetBytes("crisxuhey777:$token")) } } } |
         ConvertTo-Json -Compress -Depth 5
$b64   = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))

$secret = @"

---
apiVersion: v1
kind: Secret
metadata:
  name: `${{ defaults.app_name }}
  labels:
    cloud.sealos.io/deploy-on-sealos: `${{ defaults.app_name }}
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: $b64
"@

$text = (Get-Content .sealos\template.yaml -Raw) + $secret
[IO.File]::WriteAllText('D:\OneDrive\桌面\NESTORY\.sealos\deploy.yaml', $text,
  (New-Object Text.UTF8Encoding($false)))
```

> 必须写成 **UTF-8 无 BOM**。带 BOM 的 YAML 会让部署接口直接报解析错误。

### 3C. 填 AI Key

`.sealos\args.json` 存的是模板输入参数（智谱 GLM 的 key），**不要提交进 git**（已在 `.gitignore` 里）：

```json
{"llmKey":"你的智谱 key"}
```

不填也能部署，只是 `/api/ai/*` 会返回未配置。已有文件的话直接复用。

---

## 4. 部署

先空跑一次（不创建任何资源，只校验模板 + 预估配额）：

```powershell
cd 'C:\Users\crist\.dsh\sealos-skills\plugins\sealos\skills\use-sealos'
$env:PYTHONUTF8 = '1'

python scripts\sealos-api.py deploy 'D:\OneDrive\桌面\NESTORY\.sealos\deploy.yaml' `
  --dry-run --args-file 'D:\OneDrive\桌面\NESTORY\.sealos\args.json'
```

看到 `ok` / 资源清单就说明模板合法。确认删除 `--dry-run` 正式部署：

```powershell
python scripts\sealos-api.py deploy 'D:\OneDrive\桌面\NESTORY\.sealos\deploy.yaml' `
  --args-file 'D:\OneDrive\桌面\NESTORY\.sealos\args.json'
```

输出里记下两个值：

- **`name`**：实例名，形如 `nestory-xxxxxxxx`（后面查状态、删除都用它）
- **`host`**：公网域名，形如 `nestory-yyyyyyyy.hzh.sealos.run`

> 杭州区属于 `*.sealos.run`，脚本**不会**做 Brain Project 认领，这是正常的，不用管。
> 如果报 `409 ALREADY_EXISTS`：先用 `kubectl get all -l "cloud.sealos.io/deploy-on-sealos=<实例名>"` 看资源是不是其实已经建出来了，再决定是否重试；别直接原地重试。

---

## 5. 等 MySQL 起来并验证

首次部署要等 1–3 分钟：KubeBlocks 建 MySQL 集群 → init Job 建库 → 应用启动等 DB → 建表 → 健康检查通过。应用本身有等待逻辑（`NESTORY_DB_WAIT` 默认 600 秒），所以不会因为 DB 慢而崩。

```powershell
$host_ = 'nestory-yyyyyyyy.hzh.sealos.run'   # 换成你自己的

# 1) 健康检查：status=ok 且 db.ok=true 才算好
curl.exe -s "https://$host_/api/health"

# 2) 页面能打开
curl.exe -s -o NUL -w "%{http_code}`n" "https://$host_/"

# 3) 全链路冒烟（注册→签发上传→直传 S3→确认→取图→删除）
cd 'D:\OneDrive\桌面\NESTORY'
python _smoke_deployed.py "https://$host_"
```

期望：`/api/health` 返回 `{"status":"ok","version":"0.3.6","db":{"ok":true,...},"backup":{"enabled":true,...}}`，冒烟脚本最后打印 `deployed media smoke passed`。

用 kubectl 看状态（如果 6443 通的话）：

```powershell
$env:KUBECONFIG = "$env:USERPROFILE\.sealos\kubeconfig"
kubectl get deploy,pod,cluster,objectstoragebucket -l "cloud.sealos.io/deploy-on-sealos=<实例名>"
kubectl logs deploy/<实例名> -f
```

---

## 6. 出问题怎么查

| 现象 | 大概率原因 / 处理 |
|---|---|
| Pod `ImagePullBackOff` | 镜像私有但没配 Secret（走 3B），或 tag 写错，或镜像不是 amd64 |
| Pod `CrashLoopBackOff` | `kubectl logs` 看真实报错；多为环境变量缺失 |
| 页面 503 / 404 | Ingress 端口 ≠ Service 端口（都应是 8000） |
| `db.ok=false` 但 `/api/health` 能开 | MySQL 还没就绪，等 1–2 分钟；超 10 分钟就看 Cluster 状态 |
| 部署 403 / quota | 配额或余额不足，去控制台看 |
| `UnicodeDecodeError: 'charmap'` | 忘了 `$env:PYTHONUTF8='1'` |
| YAML 解析报错 | `deploy.yaml` 带了 BOM，用 3B 里的写法重写 |

---

## 7. 计费与清理

- 国内区按人民币计费（套餐/按量），在控制台 **Team / Billing** 看。
- 删实例会把 Deployment、Service、Ingress、MySQL 集群、对象存储桶一起删掉，**数据不可恢复**：

```powershell
cd 'C:\Users\crist\.dsh\sealos-skills\plugins\sealos\skills\use-sealos'
$env:PYTHONUTF8 = '1'
python scripts\sealos-api.py instances          # 列出现有实例
python scripts\sealos-api.py delete <实例名>     # 删除
```

- 美国区那个旧实例 `nestory-wmmuakji` 仍在跑，确认不需要后同样用 `login --region https://usw-1.sealos.io` + `delete` 清掉，避免两份计费。

---

## 8. 可选：把美国区的数据搬过来

如今线上只有测试账号（没有真实用户），**建议直接空站上线**，跳过这一节。

真要搬的话：旧区备份已在对象存储 `nestory/backups/*.json.gz`，流程是

1. 用旧区凭据把最新 `json.gz` 下载下来（`backend/storage.py` 的 `download()` 可直接用）；
2. 上传到新区桶的 `nestory/backups/` 下；
3. 在新区 pod 里执行 `python backend/backup.py --restore nestory/backups/<文件名>`；
4. 再把旧桶 `nestory/<user_id>/` 下的媒体对象逐个 `download` → `put` 到新区桶。

`state` 里存的是相对路径 `/api/media/blob/<id>`，换域名不影响显示。

---

## 9. 上线后要做的三件事

1. **确认没有 demo 账号**：模板已设 `NESTORY_DEMO_EMAIL=''`，任何账号都不会有示例数据特权；不要手工注册 `demo@nestory.local`。
2. **验证每日备份**：次日 03:30 后看 `/api/health` 的 `backup.last` 是否出现新 key。
3. **记下域名**：以后做 PWA/APK 时 `start_url` 要写死这个地址，别再用随机域名。
