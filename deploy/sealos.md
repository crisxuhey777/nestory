# 把 Nestory 放到 Sealos（容器形态）

目标是「一个镜像、一个端口」：容器里 `python backend/server.py --host 0.0.0.0 --static-dir /app/dist`
同时提供前端页面和 `/api/*`，不再需要 nginx + systemd 两套东西。

## 1. 镜像里有什么

| 层 | 内容 | 说明 |
| --- | --- | --- |
| `node:22-alpine`（构建期） | `npm ci` → `npm run build` | 产物 `/app/dist` |
| `python:3.12-slim`（运行期） | `backend/` + `dist/` | 只装 `PyMySQL[rsa]`，非 root 运行，日志走 stdout |

```bash
# 本机验证（需要 Docker）
docker build -t nestory:latest .
docker run --rm -p 8000:8000 \
  -e NESTORY_DB_HOST=... -e NESTORY_DB_PORT=3306 \
  -e NESTORY_DB_USER=... -e NESTORY_DB_PASSWORD=... -e NESTORY_DB_NAME=nestory \
  nestory:latest
# 浏览器打开 http://127.0.0.1:8000/
```

容器启动时会 `db.ping()` → `db.init_schema()`，所以托管 MySQL **只要给一个空库 + 有建表权限的账号**，
users / sessions / user_state / media 四张表会自动建出来，不用手动导 SQL。

## 2. 必须配的环境变量

| 变量 | 作用 | 上线时怎么填 |
| --- | --- | --- |
| `NESTORY_DB_HOST` / `NESTORY_DB_PORT` | 托管 MySQL 地址 | Sealos 建 MySQL 集群后给的私网地址与端口 |
| `NESTORY_DB_USER` / `NESTORY_DB_PASSWORD` / `NESTORY_DB_NAME` | 账号与库名 | 用该集群给的账号；库名一般是 `nestory` |
| `NESTORY_COOKIE_SECURE` | 会话 Cookie 是否只走 HTTPS | **公网 HTTPS 必须设 `1`**（Sealos 默认给 https 域名） |
| `NESTORY_LLM_BASE` | AI 接口地址 | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| `NESTORY_LLM_MODEL` | 模型名 | `glm-4-flash` |
| `NESTORY_LLM_KEY` | 智谱 API Key | 平台「环境变量 / Secret」里填，**别写进仓库** |
| `NESTORY_LLM_TIMEOUT` | AI 超时（秒） | 默认 45；平台入口超时要比它长 |
| `NESTORY_S3_ENDPOINT` / `NESTORY_S3_BUCKET` / `NESTORY_S3_REGION` | 媒体对象存储（R2 / MinIO / S3） | 建议必配；R2 用 `https://<账号>.r2.cloudflarestorage.com` + `auto` |
| `NESTORY_S3_ACCESS_KEY` / `NESTORY_S3_SECRET_KEY` | 对象存储密钥 | 放平台 Secret，**别写进仓库** |
| `NESTORY_S3_PREFIX` | 对象前缀 | 默认 `nestory`，多环境可分开 |
| `NESTORY_S3_CDN_BASE` | 可选：公开/CDN 域名 | 配了浏览器直连该域名，不再 302 到签名地址 |
| `NESTORY_MEDIA_MAX_MB` / `NESTORY_MEDIA_QUOTA_MB` | 单文件上限 / 每账号配额 | 默认 200 / 5120（5 GB） |

> 媒体存储不配 `NESTORY_S3_*` 时会退回容器内 `backend/media/`，**容器重建就丢**，只适合本地开发。
> 私有桶就够用：后端 `GET /api/media/blob/<id>` 会 302 到短时效（1 小时）签名地址，前端不用拿密钥。
> 桶需要允许浏览器跨域 PUT（预签名直传），CORS 里放行站点域名、方法 `PUT`、请求头 `Content-Type`。

`backend/db.env`、`backend/llm.env` 已被 `.gitignore` 和 `.dockerignore` 排除，不会进镜像。

## 3. 已经走通的路线：sealos-skills 插件 + Template API

Sealos 网页版 2.0 也能贴仓库，但仓库是 private 时要授权 GitHub App；下面这条是本项目实际用过的、
可重复执行的路径（不依赖 `kubectl`，只走 443 上的 Template API）。

前置：`C:\Users\crist\.dsh\sealos-skills`（sealos 插件 v2.0.0；若缺依赖，在里面跑
`node "D:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install --omit=dev`）。
下文命令都在 `C:\Users\crist\.dsh\sealos-skills\plugins\sealos\skills\use-sealos` 下执行。

```powershell
$env:PYTHONUTF8='1'; $env:PYTHONIOENCODING='utf-8'

# 1) 登录（OAuth2 device flow，浏览器里输一次码）
python scripts/sealos-api.py login

# 2) 构建并推镜像（linux/amd64）
docker buildx build --platform linux/amd64 -t ghcr.io/crisxuhey777/nestory:<tag> --push .

# 3) 部署（模板在仓库 .sealos/template.yaml，密钥参数在 .sealos/args.json，均不入库）
python scripts/sealos-api.py deploy D:\OneDrive\桌面\NESTORY\.sealos\deploy.yaml `
  --args-file D:\OneDrive\桌面\NESTORY\.sealos\args.json
```

要点：

- **必须 `PYTHONUTF8=1`**，否则脚本用系统编码读 YAML 会 `UnicodeDecodeError: 'charmap' codec`。
- 每次 `deploy` 都会新建一个带随机后缀的实例（`nestory-<random8>`），**数据是全新的**；
  要覆盖旧实例先 `python scripts/sealos-api.py delete <实例名>`（返回 204）。
- 公网域名 = `https://<app_host>.usw-1.sealos.app`（`SEALOS_CLOUD_DOMAIN` 是 `usw-1.sealos.app`，
  不是 `.io`；`.io` 下返回 404）。`app_host` 随机，部署后从实例详情取：
  `GET https://template.usw-1.sealos.io/api/instance/list`，`Authorization` 头放 urlquote 后的 kubeconfig，
  读 `spec.defaults.app_host.value`。
- GHCR 包是私有的（OAuth token 改不了可见性，`PATCH /user/packages` 一律 404），所以模板里挂了
  `imagePullSecrets: [{name: <app_name>}]` + 一个 `kubernetes.io/dockerconfigjson` Secret，
  它由 `gh auth token` 现场拼出来写进 `.sealos/deploy.yaml`（该文件含凭据，已 gitignore）。
- 模板里 MySQL 是 KubeBlocks 集群（`nestory-mysql`），首次要等 2–4 分钟才 ready；应用启动时
  用后台线程等库（`NESTORY_DB_WAIT`，默认 600s）并自动建表，探针不会提前把 pod 杀掉。

### 当前线上实例（2026-11-12）

- 地址：<https://nestory-qdknrlol.usw-1.sealos.app>
- 实例：`nestory-wmmuakji`，镜像 `ghcr.io/crisxuhey777/nestory:0.3.3`
- `GET /api/health` → `db.ok=true`，AI 走 `glm-4-flash`
- 媒体：Sealos 对象存储桶（private，path-style，`NESTORY_S3_*` 由模板注入）
- 验证：`_smoke_deployed.py`（接口全链路）+ 浏览器 e2e 相册 20/20、设置 26/26

## 4. 上线后要核对的

- `GET https://<域名>/api/health` → `{"status":"ok", "db":{"ok":true}}`
- 注册 → 登录 → 记一条成长记录 → 刷新页面数据还在
- 上传一张照片，`/api/media/blob/<id>` 能打开（直传 S3 + confirm 成功）
- 浏览器 Cookie 里 `nestory_session` 带 `Secure`（说明 HTTPS 生效）
- AI 摘要页能出内容（`/api/ai/summary` 走智谱）

## 5. 已知限制（和上线无关，但会先撞上）

- 照片/视频已经走对象存储：`state` 里只存 `/api/media/blob/<id>` 短地址，媒体元数据在 MySQL `media` 表，
  字节在 S3 桶里。上线前记得配 `NESTORY_S3_*`，否则媒体会落在容器磁盘上。
- 后端把整份 AppState 存在 `user_state.state_json`（MEDIUMTEXT，16 MB 上限），请求体上限 12 MB。
- 没有限流和验证码；公网开放后建议后面加。
- 账号配额的用量是「预签名时登记的大小」，直传完成后没有回查对象实际大小；配额被绕过的风险很低但存在。
