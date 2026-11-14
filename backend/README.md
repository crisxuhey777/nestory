# Nestory 本地后端

用 Python 标准库写的本地 HTTP 服务：**MySQL 持久化 + 注册登录 + 每个账号一份 AppState**，
另外提供每日一句、AI 小结、成长分析、相册故事四个模型端点。

前端启动先请求 `GET /api/auth/me`：没登录显示登录/注册页；登录成功后直接用数据库里的
`AppState` 渲染，之后每次改动 800ms 防抖自动 `PUT /api/state`。**数据在渲染前一定来自 MySQL**，
不会先闪一帧本地假数据。

## 运行

Windows 下直接**双击 `start_server.bat`**：

1. 检查 8000 端口：已在跑 Nestory 就提示并退出，被别的程序占用会说明原因；
2. `mysql_ctl.py ensure` 自动拉起便携 MySQL（未初始化会自动初始化；它在后台无窗口运行，
   错误日志在 `%LOCALAPPDATA%\Nestory\mysql-data\mysqld.log`）；
3. 启动后端，并打印一次真实的模型探测。

也可以手动在命令行启动：

```bash
python backend/mysql_ctl.py ensure   # 先确保 3306 在监听
python backend/server.py             # 默认 http://127.0.0.1:8000
python backend/server.py --port 9000
python backend/server.py --log-level DEBUG          # 控制台与文件都更详细
python backend/server.py --log-dir D:\nestory-logs  # 换日志目录
python backend/server.py --no-log-file              # 只打控制台
```

另开一个终端跑前端：

```bash
npm run dev                          # http://localhost:5178
```

Vite 已把 `/api` 代理到 `127.0.0.1:8000`（`vite.config.ts`），前端只写相对路径，
不涉及 CORS，也不需要改端口。预览模式 `npm run preview` 同样生效。

### 首次准备（换一台机器时）

```bash
python -m pip install PyMySQL
# 本机还没有 MySQL 时：先按 mysql_ctl.py 顶部注释放好便携版，或改成连接已有实例
python backend/setup_mysql.py        # 用 root 建库 nestory、账号 nestory、三张表
```

默认连接（可用 `backend/db.env` 覆盖，环境变量优先级更高）：

```ini
NESTORY_DB_HOST=127.0.0.1
NESTORY_DB_PORT=3306
NESTORY_DB_USER=nestory
NESTORY_DB_PASSWORD=nestory
NESTORY_DB_NAME=nestory
```

`backend/db.env` 已加进 `.gitignore`，不要提交真实密码。

### 启动时看到什么

窗口里除了端口信息，还会打印数据库与当前生效的模型：

```text
MySQL
  target   : nestory@127.0.0.1:3306/nestory
  ping     : ok · nestory@127.0.0.1:3306/nestory · 27 ms
  schema   : ready (users / sessions / user_state)
AI model
  provider : openai-compatible
  host     : open.bigmodel.cn
  model    : glm-4-flash
  key      : ***xxxx
  config   : llm.env (3 active keys)
  probe    : ok via openai-compatible (875 ms)
```

`probe: FAILED` 只表示模型暂时不可用，服务照常启动，AI 卡片会退回内置文案；
数据库不通时 `/api/health` 会标红，注册/登录返回 503。加 `--no-ai-probe` 可跳过启动探测。

## 账号与会话

- 密码用 **PBKDF2-HMAC-SHA256（260000 次、16 字节盐）** 存哈希，不存明文。
- 会话令牌是 `secrets.token_urlsafe(32)`，数据库只存它的 SHA-256；Cookie 名
  `nestory_session`，`HttpOnly; SameSite=Lax; Path=/`，有效期 30 天。
- 每个账号在 `user_state` 里存一整份 `AppState` JSON；`users` 同时冗余宝宝昵称/生日，
  方便账号列表和重置时重建。
- 接口互不越权：所有读写都从会话解析 `user_id`，不接受客户端传 user id。

## 日志

控制台实时输出，同时写文件：

- 控制台每行：`13:28:10 INFO  rid=f5fbbe23 POST /api/auth/login -> 200 205.3ms 10911B user=1`。
- 文件在 `backend/logs/nestory.log`，按天切分（旧文件为 `nestory.log.2026-11-12`），保留 14 天。
  文件是带 BOM 的 UTF-8；PowerShell 5.1 请用 `Get-Content -Encoding UTF8` 查看，避免中文变乱码。
- 后台线程每 2 秒 `flush + fsync` 一次，进程被关掉或杀掉时，最后几行也不会留在缓冲区。
- 每次请求带 8 位 `rid`；同一次请求的账号事件、AI 调用共用这个 id，
  `Select-String rid=f5fbbe23` 就能把整条链路串起来。
- 耗时 ≥1500ms 的请求标 `slow`；4xx 记 WARNING，5xx 记 ERROR；未捕获异常写完整 traceback。
- 会记：启动配置、注册/登录/退出、失败登录（邮箱打码）、状态保存体积、AI 的 provider/model/耗时与兜底原因、每个 HTTP 请求。
- 不会记：密码、会话令牌、Cookie、`AppState` 内容。

`--log-level` / `--log-dir` / `--no-log-file` 与 `NESTORY_LOG_LEVEL` / `NESTORY_LOG_DIR`
等价，命令行参数优先。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册：邮箱、密码、昵称、宝宝昵称/生日；写库并种 Cookie |
| POST | `/api/auth/login` | 登录，返回 `{ user, state }` |
| POST | `/api/auth/logout` | 退出，删除当前会话 |
| GET | `/api/auth/me` | 当前会话 → `{ user, state }`；未登录 401 |
| GET | `/api/state` | 当前用户的 `{ source: "mysql", state, user }`（需登录） |
| PUT | `/api/state` | 保存整份 `AppState`（需登录） |
| POST | `/api/state/reset` | 用示例数据重置当前账号（需登录） |
| POST | `/api/ai/summary` | 今日小结，追加 milestone 后返回完整 `AppState` |
| POST | `/api/ai/analysis` | 近 7 天成长分析（`headline` + 3 条观察 + 2 条建议） |
| POST | `/api/ai/story` | 相册故事（`title` + `body`） |
| POST | `/api/daily-quote` | 首页每日一句；生日/满月/百天/半岁/节日带 `label` |
| GET | `/api/health` | 健康检查（含 `db`、`ai`、`backup`） |
| GET | `/api/test-config` | 原始模板（时间仍是字符串），用于核对 `fixtures.py` |
| GET | `/api/media` | 当前账号的媒体列表 + 用量 `{ items, bytes, quotaBytes }` |
| POST | `/api/media/presign` | 预签名：`{ kind, mime, bytes, width?, height?, durationSec? }` → 上传地址 |
| POST | `/api/media/{id}/confirm` | 对象存储直传完成后确认，把记录标成 `ready` |
| PUT | `/api/media/blob/{id}` | 代理上传（没配对象存储时用这个地址） |
| GET | `/api/media/blob/{id}` | 读媒体：S3 → 302 到 1 小时签名地址；本地驱动 → 支持 `Range` 的流式响应 |
| DELETE | `/api/media/{id}` | 软删记录并删对象 |
| GET | `/` | 接口索引 |

`state` 里的时间全部是 **epoch 毫秒**，与 `src/data/types.ts` 一致；`state.baby.birthday`
是 `YYYY-MM-DD` 字符串。`state.viewerId` 表示当前登录的家庭成员，新记录作者由它解析。

错误约定：`400` 参数不合法、`401` 未登录/密码错误、`409` 邮箱已注册、
`503 db_unavailable`（MySQL 没起来，前端会提示先启动数据库）。

## AI 功能（模型优先、本地兜底）

| 页面 | 入口 | 端点 | 前端拿到什么 |
| --- | --- | --- | --- |
| 首页 | 每日一句 | `POST /api/daily-quote` | `{ text, occasion, label }`，hero 文案 |
| 首页 | AI 小结 | `POST /api/ai/summary` | 追加了一条 milestone 的完整 `AppState` |
| 成长 | AI 成长分析 | `POST /api/ai/analysis` | `{ headline, points[3], tips[2] }` |
| 相册 | AI 相册故事 | `POST /api/ai/story` | `{ title, body }` |

前端每次都把**当前整份 `AppState`** POST 过来，后端自己挑需要的字段：

- **每日一句**：先判断今天是不是满月（30 天）、百天、半岁、生日，或春节、中秋、
  母亲节、父亲节等；把「宝宝 3 个月 12 天 + 今天已记录喂奶/睡眠/尿布」和节日标签交给模型，
  要求 22 字内、只写一个画面、不重复标签里的天数。前端按「宝宝 + 日期」缓存进
  `sessionStorage`，同一天刷新不再请求；后端再按天缓存一层。
- **小结**：`llm.summarize()` 把今天的喂养/睡眠/尿布/体重压成几行事实 → prompt → 模型返回
  `{title, note}` → 追加成 milestone → **原样包回完整 `AppState`**，前端用 `hydrate` 接管。
- **成长分析**：`ai_insights.week_facts()` 统计近 7 天喂养次数、瓶喂 ml、睡眠段/夜觉、尿布、
  体重变化和里程碑，要求模型「说趋势、不报数字」。
- **相册故事**：`album_facts()` 取照片数量、时间跨度和标题，写 2–3 句，明确禁止编造照片里
  没有的衣物、天气和对白。

等待期间前端循环播放呼吸/轮播文案（模型通常 3–40 秒）。公网不通、被限流（402/429）或返回的
不是 JSON 时，后端自动退回本地规则生成，保证请求一定成功；`provider` 字段会标 `local`。

```bash
curl -X POST http://127.0.0.1:8000/api/ai/analysis \
  -H 'Content-Type: application/json' \
  -d '{"state": <GET /api/state 里的 state>}'
```

换模型（任何 OpenAI 兼容服务都可以，例如智谱 GLM-4-Flash、SiliconFlow 的免费模型）。
**改完要重启后端**（`llm.env` 只在进程启动时读一次）：

```ini
# backend/llm.env
NESTORY_LLM_BASE=https://open.bigmodel.cn/api/paas/v4/chat/completions
NESTORY_LLM_KEY=你的key
NESTORY_LLM_MODEL=glm-4-flash
```

真实环境变量优先级更高，可以临时覆盖。只换 Pollinations 的模型时写
`NESTORY_LLM_MODEL=openai-fast`。

## 媒体与对象存储

照片、视频、Live 短片不再写浏览器 IndexedDB：前端先 `POST /api/media/presign` 拿地址，
再直传对象存储（或代理上传），`AppState` 里只留 `/api/media/blob/<id>` 这种短地址。
元数据在 MySQL `media` 表，字节在桶里。

```ini
# 环境变量（或写 backend/media.env，优先级低于环境变量）
NESTORY_S3_ENDPOINT=https://<账号>.r2.cloudflarestorage.com
NESTORY_S3_BUCKET=nestory
NESTORY_S3_REGION=auto
NESTORY_S3_ACCESS_KEY=...
NESTORY_S3_SECRET_KEY=...
NESTORY_S3_PREFIX=nestory
NESTORY_S3_CDN_BASE=            # 可选：公开域名
NESTORY_MEDIA_MAX_MB=200        # 单文件上限
NESTORY_MEDIA_QUOTA_MB=5120     # 每账号配额
NESTORY_MEDIA_DIR=backend/media # 没配 S3 时的本地目录（开发用）
```

没配 `NESTORY_S3_*` 时自动退回本地目录，接口行为一致（`mode: "proxy"`），本地开发和 e2e 不用外部依赖。
冒烟测试：先起服务，再 `python backend/_media_smoke.py http://127.0.0.1:8000`。

## 每日备份

`backend/scheduler.py` 在进程内起一个后台线程，每天 `NESTORY_BACKUP_AT`（北京时间，默认 `03:30`）
把 `users` / `sessions` / `user_state` / `media` 四张表导成 gzip JSON，传到
`{NESTORY_S3_PREFIX}/backups/` 下，只留 `NESTORY_BACKUP_KEEP` 份（默认 14）。
启动时如果当天还没备份且已经过点，会立刻补一次；列目录失败时不重试，避免每轮都传。

```bash
python backend/backup.py --dry-run                 # 只统计，不写远程
python backend/backup.py --keep 30                 # 立刻备份一次，保留 30 份
python backend/backup.py --restore <key>           # 整表恢复（会覆盖当前数据）
```

状态在 `/api/health` 的 `backup` 字段里：`enabled` / `at` / `last` / `kept` / `lastError`。

## 代码结构

```
backend/
├── fixtures.py      # 演示数据，与 src/data/test_config.js 一一对应
├── app_state.py     # 模板 → AppState v3（前端 seed.ts 的 Python 版）
├── db.py            # MySQL 连接、db.env、建表、ping
├── auth.py          # PBKDF2 哈希、会话令牌、Cookie 属性
├── accounts.py      # 注册/登录/me/logout、读写每个账号的 AppState
├── storage.py       # 对象存储/本地磁盘、SigV4、put/put_stream/list_keys/download
├── media.py         # media 表：登记、配额、确认、列表、删除
├── backup.py        # 导出/恢复四张表（gzip JSON → 对象存储）
├── scheduler.py     # 进程内每日备份调度
├── setup_mysql.py   # 首次建库、建账号、建表
├── mysql_ctl.py     # 便携 MySQL 的 start/stop/status/ensure
├── llm.py           # prompt 组装 + 模型调用 + 解析 + 本地兜底
├── ai_insights.py   # 成长分析、相册故事
├── quote.py         # 每日一句：纪念日/节日判断 + 按天缓存
├── logsetup.py      # 控制台 + 按天文件日志、2 秒定时落盘
└── server.py        # HTTP 层：路由、Cookie 会话、CORS、访问日志
```

## 这一阶段的边界

- **单机**：只监听 `127.0.0.1`，会话与密码都没有限流/验证码，不要直接暴露到公网。
- **整体读写**：`AppState` 以整份 JSON 保存，简单可靠但会随记录变多而变大；
  记录到几千条后再按 `care_record` 拆表（架构说明书里的方案）。
- **AI 依赖公网**：免费接口没有 SLA，慢或限流时靠本地兜底，不阻塞页面。
- **媒体已进对象存储**：不再受 localStorage 5 MB 限制；容器部署时务必配 `NESTORY_S3_*`，
  否则文件落在容器磁盘上，重建即丢。旧版本留下的 data URL / IndexedDB 短片仍能正常显示。

下一步建议：把 `POST /api/records` 做成独立写接口（`client_record_id` 幂等），
再把整份 JSON 拆成记录表，HTTP 层和前端契约可以保持不变。
