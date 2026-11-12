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

## 3. 两条上线路线

### A. Sealos 2.0 网页版（不需要本机 Docker）

1. 登录 <https://sealos.io>，新用户有 7 天试用。
2. 新建项目 → 连接 GitHub → 选 `crisxuhey777/nestory`。
   - 仓库现在是 **private**：要么在该页面授权 Sealos 的 GitHub App，要么把仓库临时改成 public
     （已确认仓库里只有 `db.env.example` / `llm.env.example`，没有真实密钥）。
3. 它会读根目录的 `Dockerfile` 构建镜像，再让你加一个 MySQL（或自动建），把第 2 节的变量填进去。
4. 部署完拿到的 https 域名就是 Nestory 的正式地址；`NESTORY_COOKIE_SECURE=1`。

### B. 本机构建 + 推镜像（需要 Docker）

```powershell
docker build -t ghcr.io/crisxuhey777/nestory:0.1 .
gh auth token | docker login ghcr.io -u crisxuhey777 --password-stdin
docker push ghcr.io/crisxuhey777/nestory:0.1
```

然后在 Sealos 用「Docker 镜像」方式起应用，暴露 8000，环境变量同第 2 节。

> 本机现状（2026-11-12 核实）：Windows 10 **家庭版**，WSL 没装，Docker Desktop 起不来
> （`Docker Desktop is unable to start`）。要用 B 路线得先 `wsl --install`（需要管理员 + 重启一次）。

## 4. 上线后要核对的

- `GET https://<域名>/api/health` → `{"status":"ok", "db":{"ok":true}}`
- 注册 → 登录 → 记一条成长记录 → 刷新页面数据还在
- 浏览器 Cookie 里 `nestory_session` 带 `Secure`（说明 HTTPS 生效）
- AI 摘要页能出内容（`/api/ai/summary` 走智谱）

## 5. 已知限制（和上线无关，但会先撞上）

- 照片/视频已经走对象存储：`state` 里只存 `/api/media/blob/<id>` 短地址，媒体元数据在 MySQL `media` 表，
  字节在 S3 桶里。上线前记得配 `NESTORY_S3_*`，否则媒体会落在容器磁盘上。
- 后端把整份 AppState 存在 `user_state.state_json`（MEDIUMTEXT，16 MB 上限），请求体上限 12 MB。
- 没有限流和验证码；公网开放后建议后面加。
- 账号配额的用量是「预签名时登记的大小」，直传完成后没有回查对象实际大小；配额被绕过的风险很低但存在。
