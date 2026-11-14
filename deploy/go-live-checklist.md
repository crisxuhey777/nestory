# 上线清单（Go-Live Checklist）

面向：把 Nestory 部署到公网（Sealos / 任意容器平台），给家人长期使用。
配套：`deploy/sealos.md`（部署细节）、`deploy/README.md`（运维总览）、`REFACTOR-STAGE1-REPORT-2026-11-14.md`（阶段一改动）。

> 判定：下面 **第 1 步的 4 个「必填」+ 第 3 步的 12 条验收** 全过，才算「可以上线」。只过第 2 步属于「能跑起来」。

---

## 第 1 步 · 四个必填项（不做就别上线）

| # | 项 | 怎么设 | 为什么是硬性 |
| --- | --- | --- | --- |
| 1 | `NESTORY_COOKIE_SECURE=1` | 平台环境变量 | 公网是 HTTPS，不设则会话 Cookie 无 `Secure`，凭证可能在明文链路上泄露 |
| 2 | `NESTORY_DEMO_EMAIL=`（**空字符串**） | 平台环境变量 | 仓库里 `demo@nestory.local` / `nestory123` 是公开凭据；空值才会关掉演示特权与示例数据重置 |
| 3 | `NESTORY_S3_*` 全套 | `ENDPOINT`/`BUCKET`/`REGION`/`ACCESS_KEY`/`SECRET_KEY` | 不配就落容器磁盘，**重建即丢照片** |
| 4 | 反向代理 + 域名证书 | Sealos 应用入口 / Caddy / Nginx | 应用只监听 `0.0.0.0:8000`，本身不做 TLS |

建议同时设：`NESTORY_LLM_KEY`（没有则 AI 卡片全部失败）、`NESTORY_BACKUP_ENABLED=1`、`NESTORY_BACKUP_AT=03:30`、`NESTORY_BACKUP_KEEP=14`、`NESTORY_MEDIA_MAX_MB=200`、`NESTORY_MEDIA_QUOTA_MB=5120`、`NESTORY_VERSION=<tag>`。

**数据库迁移不需要手跑**：容器启动时 `db.init_schema()` 自动建表 + 幂等补列（含 `household_state.rev`）。

---

## 第 2 步 · 部署

```powershell
# 本机（已验证：多阶段构建，前端 dist + python:3.12-slim，非 root uid 10001）
docker build -t nestory:2026.11.14 .
docker run --rm -p 8010:8000 `
  -e NESTORY_DB_HOST=... -e NESTORY_DB_USER=... -e NESTORY_DB_PASSWORD=... -e NESTORY_DB_NAME=nestory `
  -e NESTORY_COOKIE_SECURE=1 -e NESTORY_DEMO_EMAIL= -e NESTORY_LLM_KEY=... nestory:2026.11.14
Invoke-WebRequest http://127.0.0.1:8010/api/health -UseBasicParsing
```

Sealos 路径（网页 / Template API）见 `deploy/sealos.md`；镜像推上去后用同一个 tag 部署，别用 `latest` 裸标签。

---

## 第 3 步 · 上线验收 12 条

| # | 验收项 | 判定标准 |
| --- | --- | --- |
| 1 | 健康检查 | `GET /api/health` → `status ok`、`db.ok true` |
| 2 | 结构迁移 | `GET /api/state`（登录后）响应含 `rev`；DB 里 `household_state` 有 `rev` 列 |
| 3 | 登录 | 注册 → 登录成功；错误口令 401 `bad_credentials` |
| 4 | Cookie 安全 | 浏览器 DevTools → Application → Cookies：`nestory_session` 带 `Secure`、`HttpOnly`、`SameSite=Lax` |
| 5 | 演示账号已关 | 尝试登录 `demo@nestory.local` → 失败（或该账号不存在） |
| 6 | 核心写入 | 记一条喂养 + 一张照片 → 刷新仍在；服务器 `GET /api/state` 有对应数据 |
| 7 | 媒体持久化 | 上传照片后**重建容器** → 照片仍能显示（证明走 S3 而非容器盘） |
| 8 | 备份产物 | 次日 03:30 后，对象存储出现 `nestory/backups/YYYYmmdd-HHMMSS.json.gz`；下载可 gunzip |
| 9 | 跨设备冲突 | 两个浏览器登同一账号，A 先改、B 再改 → B 收到「记录已在另一台设备上更新」，重载拿到 A 的版本（不静默覆盖） |
| 10 | 回收站恢复 | 删一张照片 → 回收站恢复 → 列表与缩略图都正常（Live Photo 也是） |
| 11 | 邀请闭环 | 生成邀请链接 → 第二账号打开 → 加入成功，加入前自己的记录被合并而不是丢失 |
| 12 | 真机 | iPhone Safari + Android Chrome 各走一遍：首页轮播横滑、灯箱捏合缩放、上传照片/视频、通知授权、加桌面图标（PWA） |

1–11 有明确的程序化判定；**12 必须在真机上做**，桌面 Chrome + 移动视口模拟证明不了手势与 iOS 媒体。

---

## 第 4 步 · 数据迁移（如果你的本地库要带走）

本地库现在有 `users 232 / media 406 / sessions 1219`，其中绝大多数是 e2e 建出来的测试账号与媒体。**不要整库导入**。

建议：
1. 生产起新库，只让真实家人注册（或 `INSERT` 真实账号后让她们改密码）。
2. 家庭合并走「邀请 + 加入家庭」：加入时服务端会把双方记录并集合并（`merge_states`），这是已有能力。
3. 删掉 `demo@nestory.local` 与所有 e2e 账号（`media` 会随账号孤立，导入前先在本地清一遍）。

---

## 第 5 步 · 回滚

| 场景 | 动作 | 数据风险 |
| --- | --- | --- |
| 新版本有问题 | 镜像 tag 回退到上一个，重新部署 | 无（`rev` 列保留，旧代码不读写它） |
| 迁移出错 | 保留 `household_state.rev` 列即可；不要 `DROP COLUMN` | 无 |
| 数据被误删 | 用最近一次 `backups/*.json.gz` + `python -m backend.backup restore <file>` | 会覆盖 8 张表；恢复前先 dump 当前库 |
| 前端回退但后端已升级 | 可混跑：旧前端不发 `If-Match`，走无条件写 | 无 |

---

## 第 6 步 · 上线后 48 小时观察

- 日志关键字：`state_conflict`（多设备频率）、`quota_exceeded`、`upload_missing`、`too_many_attempts`、`ERROR`。
- 备份：连续两天都有产物，且大小在 700KB 量级（8 张表）。
- 资源：容器内存随媒体上传达阈值（`NESTORY_MEDIA_QUOTA_MB` 是每账号配额，不是总量）。
- 第一周别开多副本：登录限流与提醒调度是进程内状态，单实例才准。

---

## 已知限制（写给你自己，不是给用户）

1. 单进程 `ThreadingHTTPServer`，家庭规模够用，不能水平扩容。
2. 登录限流表在内存，重启即清零。
3. 关掉浏览器后不会推送提醒（无 push / Background Sync）。
4. 两设备同时编辑，冲突方那一次编辑会丢（提示后重载，需重做）。
