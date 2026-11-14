# NESTORY 技术债清理与渐进式重构方案

- 版本：2026-11-14 · v1
- 输入：《项目代码健康度审计报告》（AUDIT-2026-11-14.md）、《历史遗留代码清理清单》（LEGACY-2026-11-14.md）、《业务逻辑与潜在 Bug 审计》（AUDIT-BUSINESS-2026-11-14.md）
- 状态：**计划，未执行任何代码修改**

---

## 0. 先对齐基线：哪些事已经做过了

前三轮审计之后，前四批修复已经落盘并通过回归，**本方案不重复这些工作**：

| 已修复 | 关键位置 |
| --- | --- |
| 重置数据需要管理员 + 重置前存档 | `backend/accounts.py` `reset_state`、`state_backups` 表 |
| 加入家庭不再删记录（备份 + 合并） | `backend/family.py` `_dissolve` / `merge_states` |
| 编辑亲喂记录不再把结束时间改成「现在」 | `src/pages/Feed.tsx` `save()` |
| 回收站恢复改走服务端 | `src/pages/Trash.tsx` `restoreLocal` |
| 保存链 flush / 卸载补发 / 64KiB keepalive 上限 | `src/data/store.tsx` `queueSave` / `flushPending` |
| 权限统一（上传要 edit、只读成员只能换自己头像） | `backend/media.py` `_writer`、`backend/family.py` |
| 邀请原子核销 | `backend/family.py` `_claim_invite` |
| 删除照片收集全部 media id（**删除侧**） | `src/lib/photoDelete.ts` |
| 调试端点收敛、日志脱敏、nosniff、静态缓存分流 | `backend/server.py` |
| 巨型组件拆分（AlbumPage 1119→~672、FeedPage 666→480、HomePage 774→453、BabyProfilePage 542→403） | `src/components/*` |
| apiClient 收口（`aiPost`）、路由回退改 popstate、抽屉登记表、浮层历史 | `src/data/api.ts`、`src/lib/route.ts`、`src/lib/sheets.ts` |
| 死码/死 CSS/死配置清理、ESLint + CI、备份表补全 | 见 AUDIT 附录 D |

当前基线（每次改动都必须不低于它）：

```
tsc 0 错误 · eslint 0 问题 · vitest 50 用例(10 文件) · 后端 unittest 12 用例
vite build  JS 442.6 kB / gzip 134.6  ·  CSS 275.3 kB / gzip 80.3
e2e 20 套（对 5178 dev server）：20/20
```

---

## 1. 明确「不做」的清单

这一节和后面的计划同样重要。以下事项**不建议重构**，理由是收益低、风险高或改动量与产品价值不成比例：

| 编号 | 事项 | 为什么不做 |
| --- | --- | --- |
| N-01 | 把 `backend/server.py`（1307 行）整体拆成多模块 | 路由已经表化（GET/POST 四张表），剩下的主要是请求解析与响应封装；整体拆分会产生大量 `self` 转发与循环导入风险，回归成本远大于可读性收益。**只做局部试点**（见阶段五 5.2）。 |
| N-02 | 把 `ThreadingHTTPServer` 换成 FastAPI/Django | 当前实现无框架依赖、已有鉴权/限流/静态/Range/多部分上传，替换等于重写后端，且要重做 12 个后端用例与 20 套 e2e。收益只是「更现代」。 |
| N-03 | 把整份 state 的读写改成「按记录增删改」的 REST | 这是产品级架构变更（离线、合并、冲突、回收站全部要重写），不属于「不改变现有功能」的重构。**只加乐观锁**（阶段一），不动数据模型。 |
| N-04 | 把 `config.js` + `config.d.ts` 合并成一个 `.ts` | 现状类型与实现同步、17 个分组全有消费方；合并要动 vite 解析与所有 import，属于纯形式统一，收益接近 0。 |
| N-05 | 把 `birth.ts` 与 `accounts.py` 的生日归档合并成一份 | 跨语言无法共享代码。**改为契约测试**（同一组输入断言两边输出一致），比合并更划算。 |
| N-06 | 继续把 AlbumPage 从 672 行拆到 300 行以下 | 已过拐点。再拆会把状态提升成大量 props/上下文，耦合反而上升。 |
| N-07 | 引入 Redux/Zustand/TanStack Query、替换自研路由 | 现有 60 个文件、单 store + 自研 hash 路由工作正常，替换属于「为了架构而架构」。 |
| N-08 | 删除 `user_state` 老表链路 | 它是「加入家庭前数据可回滚」的兜底，且 `backup.TABLES` 依赖它。保持只读兼容，不动。 |
| N-09 | 把 `shots/`（29.2MB）移出版本库 | 是仓库卫生问题，不是重构；且属于用户需拍板的操作，不在本方案执行范围。 |
| N-10 | 统一 `_test` 里两种断言风格 | 两种都能正确失败，统一只能减少「看起来不一致」，性价比低。新用例统一用 `describe/it` 即可。 |

---

## 2. 模块优先级

优先级依据：**是否丢数据 → 是否可被用户触发 → 改动面大小**。

| 优先级 | 模块 | 现状痛点 | 依赖 | 预估 |
| --- | --- | --- | --- | --- |
| **P0** | **M1 保存与同步** `store.tsx` + `accounts.save_state` | 失败不重试、多设备整份覆盖 | 无（最先做） | 1.5 人日 |
| **P0** | **M2 媒体生命周期** `media.ts`/`Trash`/`Album`/`backend/media.py` | 恢复只恢复主文件、上传无超时、取消产生孤儿 | 依赖 M1 的 flush | 2 人日 |
| **P1** | **M3 AI 回填** `Home.tsx`/`AiPanels`/`ai_insights.py` | hydrate 覆盖并发编辑 | 依赖 M1 的冲突处理 | 1 人日 |
| **P1** | **M4 权限模型** `store` permission/`Trash`/`Profile`/`family.py` | 降级不刷新、Profile 无防连点 | 依赖 M1（保存 403 回调） | 1 人日 |
| **P2** | **M5 时间与派生** `Home.tsx`/`date.ts`/`stats.ts` | 首页时间不走、hero id 永久丢失 | 无 | 0.5 人日 |
| **P2** | **M6 遗留死码**（LEGACY A/B） | 9 处约 120 行 + 9 项待验证 | 无 | 1 人日 |
| **P2** | **M7 重复实现**（LEGACY C） | 连接封装×3、SigV4×2、限流×2 | 依赖 M2（media 改动收敛后） | 1.5 人日 |
| **P3** | **M8 工程化与文档** | README 漂移、三份审计文档分散、无提交规范 | 依赖前面全部 | 1 人日 |

总预估：**约 9.5 人日**（单人；不含真机验证等待）。

---

## 3. 七阶段计划

每个阶段 = 一个独立分支 + 若干可单独 revert 的提交；**阶段内每完成一个模块就跑一次门禁**（见第 7 节）。

### 阶段一：修复 P0/P1 数据安全问题（对应 M1/M2/M3）

**目标**：把「用户以为存了其实丢了」「恢复后照片坏掉」这两类静默故障关掉。

> **执行状态（2026-11-14）**：1.1 ✅ `b444474`（保存失败 5s/15s/60s 退避重试 + `online` 立即补发）、1.2 ✅ `3416e9a`（恢复一张照片的全部 media id）、1.3 ✅ `edc6877`（`rev` + `If-Match`，409 `state_conflict`）、1.4 ✅（本次提交）。
> 与计划的偏差：① 1.1 没有把 `UNSAVED_KEY` 升级成「待发快照」，仍用标记 + 退避重试（标记只用于下次启动提示；重试已覆盖同一会话内的失败）；② 1.3 的错误码用 `state_conflict`（计划写 `stale_state`），冲突后前端直接 `reload()` 服务端版本并提示，不在客户端做并集合并（并集合并仍只用于「加入家庭」，在服务端 `merge_states`）；③ 1.4 后端不再返回 `state` 字段（该字段只有本项目前端消费，无外部兼容负担）。

**1.1 保存失败自动重试（BIZ-02）**
- 范围：保存链增加 `online` 监听与退避重试（5s/15s/60s），`dirty` 为真时重发；`UNSAVED_KEY` 从「标记」升级为「待发快照」。
- 文件：`src/data/store.tsx`（`queueSave`/`flushPending`/挂载 effect）、可选新增 `src/lib/retry.ts`。
- 依赖：无。
- 影响功能：全局自动保存。无 UI 变化（仅在持续失败时沿用现有 toast）。
- 兼容：`UNSAVED_KEY` 旧格式（布尔/时间戳）要做读兼容，读不出来就当空。
- 测试：新增单测（mock fetch 失败 N 次后成功）；e2e 用 `page.route` 注入失败。
- 回滚：`git revert` 单个提交即可；无数据迁移。

**1.2 回收站恢复全部 media id（BIZ-01）**
- 范围：恢复时提交该照片的全部 id；后端 `restore` 接受 id 数组（单 id 保持兼容）。
- 文件：`src/pages/Trash.tsx`、`src/lib/photoDelete.ts`（导出「一张照片的全部 id」）、`src/lib/media.ts`（`mediaIdsOf`）、`backend/media.py`（`restore`）、`backend/server.py`（`_media_action_post` 参数解析）。
- 依赖：与 1.1 无耦合，但同阶段做。
- 影响功能：回收站恢复；7 天清理逻辑不变。
- 兼容：接口新增 `ids` 参数，旧的 `{id}` 仍接受（后端先看 `ids` 再看 `id`）。
- 测试：单测断言恢复 3 条 id；e2e 恢复后断言 `thumb` 请求 200；把 `deleted_at` 改早跑 purge 后断言图片仍可加载。
- 回滚：代码 revert；已恢复的 media 行无需回滚（多恢复几条无害）。

**1.3 保存加乐观锁（BIZ-03）**
- 范围：`household_state` 增加 `rev BIGINT UNSIGNED NOT NULL DEFAULT 0`（幂等迁移）；`save_state` 接受可选 `rev`，不匹配返回 409 `stale_state` 并回传服务端 `rev`；前端保存失败 `stale_state` 时拉最新再合并（复用 `family.merge_states` 的服务端实现，或在客户端按 id 并集）。
- 文件：`backend/db.py`（SCHEMA + MIGRATIONS）、`backend/accounts.py`（`save_state`/`reset_state`/`load_state` 返回 rev）、`backend/server.py`（PUT /api/state 读取 `rev`）、`src/data/api.ts`（`saveState` 带 rev、`ApiError` 解析 409 载荷）、`src/data/store.tsx`（保存成功记录 rev、409 分支）。
- 依赖：M1.1 完成后再做（重试路径要认识 409）。
- 影响功能：保存语义；单设备无感。
- 兼容：**旧客户端不传 rev 时按现行无条件写**——这样已发布的 web 版本不会因为上线新后端而失败；新客户端拿到 rev 后逐步启用。上线顺序必须「先后端、后前端」。
- 测试：两个会话并发写，断言其中一个 409 且最终两条记录都在；`save_state` 单测覆盖 rev 递增与不匹配。
- 回滚：代码 revert；`rev` 列保留（旧代码忽略它），无需 DROP——这是「可回滚 DDL」的做法。

**1.4 AI 小结只追加里程碑（BIZ-05）**
- 范围：`/api/ai/summary` 返回 `{ milestone, ai }` 而不是整份 state；前端 `dispatch({type:'addMilestone'})`。
- 文件：`backend/ai_insights.py`（summary 返回结构）、`backend/server.py`（`_ai_summary`）、`src/pages/Home.tsx`（`generateSummary`）。
- 依赖：无（但要先做 1.3，因为要保留服务端「写入 milestone」的落库路径）。
- 影响功能：AI 小结卡片行为不变。
- 兼容：后端可临时**同时**返回旧字段 `state`（前端不再使用），保留一个版本后删除。
- 测试：AI 请求挂起时插入一条记录，返回后断言该记录仍在、milestone 只多一条。
- 回滚：前端单独 revert 即可（后端多返回字段无害）。

**阶段一门禁**：`npm run check` + `node _e2e_all.mjs` + 新增用例全绿；生产构建体积变化 <2%。

---

### 阶段二：清理已确认无效的历史代码（M6，对应 LEGACY A + B 决策）

**目标**：删掉约 120 行确认死码，处理 9 项「疑似废弃」中的可决部分。

**2.1 A 类删除（逐项提交，每项一个 commit）**

| 项 | 文件:行 | 删除内容 | 前置验证 |
| --- | --- | --- | --- |
| A-01 | `src/lib/media.ts` `compressImage` | 导出函数 | `tsc` + grep 零引用 |
| A-02 | `backend/accounts.py` `_birthday` | 函数 | 后端 unittest |
| A-03 | `backend/auth.py` `session_expiry` | 函数 | 同上 |
| A-04 | `backend/fixtures.py` `as_dict` | 函数（保留其余） | 同上 |
| A-05 | `backend/logsetup.py` `slow_ms` | 函数 | 同上 |
| A-06 | `backend/media.py` `bytes_for` | 函数 | 同上 |
| A-07 | `backend/server.py` 未用导入 `build_state` | import 行 | `py_compile` |
| A-08 | `backend/quote.py` 未用导入 `os` | import 行 | 同上 |
| A-09 | `src/data/types.ts` `lastSyncedAt` + `'sync'` action | 类型字段与 reducer 分支 | `tsc` |

**2.2 B 类按决策执行（默认动作见下，避免误删）**

| 项 | 默认动作 |
| --- | --- |
| `GET /api/media`、`GET /api/media/trash` 无前端消费者 | **保留**，文件头标注 `DEPRECATED`（删除属 API 破坏，收益低） |
| `_a11y_audit.mjs` 仍审计 `#/record` | 修脚本（不是删）：改审计 `#/home` 快捷面板 |
| 旧 `AUDIT.md`（写 7/7 用例） | 移到 `docs/audit/` 并在开头加「历史快照」说明 |
| `.dsh-vision-router` 2 张产物 PNG | 从索引移除（`git rm --cached`），文件留盘 |
| `_prd_build.py` / 4 个 `_shot_*.mjs` / `_pack.py` / `_ui_shot.mjs` / `_probe.mjs` | 移到 `tools/legacy/` 或删除（需用户确认，涉及个人工作流） |
| `p1@1200.jpg` | 保留（演示数据，`app_state.py` fixtures 可能引用） |
| `user_state` 旧链路 | 保留（N-08） |

**影响与兼容**：删除的均为零引用符号；接口只标注不删除。风险面 = 0。
**测试**：阶段二每删一项跑 `tsc`/`py_compile` + 后端 unittest；阶段结束跑完整门禁。
**回滚**：逐项 revert（每项一个提交是硬要求）。

---

### 阶段三：合并重复实现（M7，对应 LEGACY C）

只合并「同一规则写两遍」的项，不做风格统一。

**3.1 三套连接封装 → `db.session()`**
- 现状：`accounts._conn`、`media._conn`、`family.connect` 各自 `db.connect()` + close，`family` 还少了 503 转换。
- 做法：在 `db.py` 增加 `session()`（contextmanager，统一 close 与 `OperationalError → 503` 映射），三处改为调用；保留旧函数名做薄包装避免大改。
- 文件：`backend/db.py`、`backend/accounts.py`、`backend/media.py`、`backend/family.py`。
- 风险：连接生命周期变化 → 必须跑完整的后端用例 + 8016 冒烟。

**3.2 SigV4 只留一份**
- 现状：`storage.presign` 与 `storage._signed_request` 各实现一遍（约 80 行），`presign(..., content_type)` 是死参数。
- 做法：抽 `_canonical_request()`/`_authorization()` 给两者共用；删掉 `content_type` 形参（无调用方传值）。
- 文件：`backend/storage.py`。
- 测试：本地驱动下用固定 key/时间戳断言签名串一致（快照测试）。

**3.3 限流抽成一处**
- 现状：caption（6/60s）与 describe（24/60s）两段几乎相同的滑动窗口代码。
- 做法：`server.py` 抽 `_RateWindow(limit, window)` 小类，两处复用。
- 文件：`backend/server.py`。

**3.4 日期格式化收敛**
- 现状：`date.ts` 5 个格式化函数语义重叠、`Home.dateKey` 与 `toISODate` 重复。
- 做法：只删 `Home.dateKey`（改用 `toISODate`），其余保留（各有语境），**不做大合并**。
- 文件：`src/pages/Home.tsx`、`src/lib/date.ts`。

**3.5 契约测试替合并（生日规则）**
- 新增 `_test/contract.birth.test.ts` + `backend/tests/test_birth_contract.py`，共用一份 JSON 用例表（`_test/fixtures/birth-cases.json`），两边分别断言归档结果一致。
- 文件：新增 3 个文件，不动 `birth.ts`/`accounts.py` 逻辑。

**阶段三门禁**：后端 unittest ≥ 15、vitest ≥ 54；e2e 20/20。

---

### 阶段四：优化核心业务逻辑（M4/M5）

**4.1 未保存草稿保护（BIZ-04）**
- 范围：`store` 暴露 `dirty`/`hasDraft`，`switchTab`/`navigate`/`goBack` 前询问；或 `Feed`/`BabyProfile` 编辑态写 `sessionStorage` 草稿。
- 文件：`src/data/store.tsx`、`src/lib/route.ts`、`src/pages/Feed.tsx`、`src/pages/BabyProfile.tsx`、`src/components/ExitGuard.tsx`。
- 注意：**不改交互样式**——复用现有确认弹层组件。
- 测试：e2e「编辑后切 Tab 出现确认」。

**4.2 权限实时刷新（BIZ-08）**
- 范围：`/api/state`、`/api/auth/me` 响应带 `permission`；保存 403 `read_only` 时本地降级并提示；`Trash` 门禁以服务端结果为准。
- 文件：`backend/accounts.py`（`me`/`save_state` 返回 permission）、`backend/server.py`、`src/data/store.tsx`、`src/data/api.ts`、`src/pages/Trash.tsx`。
- 兼容：新增字段，老客户端忽略。

**4.3 重置/加入家庭前的 flush（BIZ-09/BIZ-10）**
- 范围：`reset` 先取消排队的保存并 flush；`join` 前 `flushPending()`。
- 文件：`src/data/store.tsx`、`src/pages/Join.tsx`、`src/pages/Settings.tsx`。

**4.4 时间与封面（BIZ-11/BIZ-12）**
- 范围：首页加 60s 刷新（前台时），`visibilitychange` 立即刷新一次；`normalizeBirthState` 不再丢弃 hero id（渲染时取交集）。
- 文件：`src/pages/Home.tsx`、`src/lib/birth.ts`、`src/pages/Home.tsx` 的 heroSlides 派生。
- 测试：单测 `normalizeBirthState` 改生日来回后 hero 保留。

**4.5 Profile 防连点（BIZ-13）**
- 文件：`src/pages/Profile.tsx`（加 `busyMemberId`）。

---

### 阶段五：优化模块架构与依赖（只做两件低风险的事）

**5.1 `App.tsx` 路由表化**
- 现状：13 段条件渲染。改为 `ROUTE_VIEWS: Record<Route, (ctx) => ReactNode>` + 两个特殊分支（onboarding、未知路由）。
- 文件：`src/App.tsx`（+ 可选 `src/lib/routeViews.tsx`）。
- 收益：新增页面只改一处；退出守卫的挂载规则集中。
- 风险：低（纯结构），但 e2e 的 back/exit 对挂载顺序敏感 → 必须跑 `_e2e_back`/`_e2e_exit`。

**5.2 后端媒体路由抽模块（试点，可放弃）**
- 现状：`server.py` 里 media 相关 handler 约 200 行。
- 做法：抽 `backend/routes_media.py`，暴露 `get_blob(handler, match)` 等函数；`server.py` 只保留表项与调用。
- 判定标准：如果抽出后 `server.py` 仍 >1100 行、且需要大量 `self._send_json` 透传，就**放弃**（对应 N-01）。
- 文件：`backend/server.py`、新增 `backend/routes_media.py`。

**不做**：整份 `server.py` 拆分、框架替换、状态库替换（N-01/N-02/N-07）。

---

### 阶段六：性能与安全（M2 收尾 + 平台加固）

| 项 | 内容 | 文件 | 验证 |
| --- | --- | --- | --- |
| 6.1 | 上传加 `AbortController` + 超时（照片 60s、视频按大小放宽），失败可重试/取消 | `src/lib/media.ts`、`src/components/AlbumAddSheet.tsx` | 弱网模拟 + e2e 超时用例 |
| 6.2 | 取消上传/放弃草稿时删除孤儿 media（BIZ-07） | `src/components/AlbumAddSheet.tsx`、`src/pages/Album.tsx`、`src/data/api.ts` | 单测断言无 ready 无引用行 |
| 6.3 | 已删除媒体的 blob 访问收敛（当前 `include_deleted=True` 对全家可读） | `backend/server.py` `_media_blob`、`backend/media.py` `row_for` | 只读成员请求已删媒体 → 404 |
| 6.4 | 媒体响应缓存策略：改为 `private, max-age=86400`（当前已是）→ 补 `Vary: Cookie` 复核 | `backend/server.py` | 冒烟看头部 |
| 6.5 | 前端体积：先测量再决定是否做路由级 `React.lazy`（当前单 chunk 442kB） | `src/App.tsx` | 变更前后 gzip 对比，<5% 收益则放弃 |

**测试**：新增上传超时/取消单测；冒烟脚本检查 6.3/6.4。

---

### 阶段七：规范与文档（M8）

1. **文档归位**：`docs/audit/{health,legacy,business}-2026-11-14.md`；根目录只留 `README.md` 与一个 `docs/INDEX.md`。
2. **README 再校准**：组件/页面清单、测试数字、`_e2e_all.mjs` 前置条件、备份范围、「AI 小结只追加里程碑」等新行为。
3. **提交与分支规范**：`type(scope): summary`（已有风格保持一致），每个提交一件事；`main` 保持可发布。
4. **提交前门禁**：不加 husky 依赖，用 `npm run check` + 一段 `scripts/pre-push`（可选）说明即可。
5. **契约与设计约束**：在 `docs/` 写一页「不变量」（保存冲突策略、媒体生命周期、权限矩阵、回收站 7 天），供后续改动对照。

---

## 4. 删除与合并总清单（汇总）

### 4.1 删除（阶段二）

| 类型 | 项 | 行数 |
| --- | --- | --- |
| 前端死码 | `compressImage`、`lastSyncedAt` + `'sync'` 分支 | ~25 |
| 后端死码 | `_birthday`、`session_expiry`、`as_dict`、`slow_ms`、`bytes_for`、2 个未用导入 | ~95 |
| 死 CSS | 已清理（阶段零已完成，47→3 误报） | — |
| 仓库卫生 | `.dsh-vision-router` 2 张 PNG 出索引 | — |

### 4.2 合并（阶段三/四）

| 合并项 | 合并后 | 保留形式 |
| --- | --- | --- |
| 三套连接封装 | `db.session()` | 旧函数名保留为包装 |
| 两遍 SigV4 | 一组 `_canonical_request`/`_authorization` | 删 `content_type` 形参 |
| 两段限流 | `_RateWindow` | 同一份实现 |
| `Home.dateKey` | `toISODate` | 删除其一 |
| 生日归档 TS/Python | **不合并**，改契约测试 | 两处实现 + 一份共享用例表 |

---

## 5. 文件依赖关系（改动会互相牵动的地方）

```
src/data/store.tsx ──┬─> src/data/api.ts ──> backend/server.py ──> backend/accounts.py
                     │                                          └─> backend/family.py
                     ├─> src/lib/route.ts (守卫、草稿)
                     └─> src/pages/{Home,Feed,Album,Trash,Profile,BabyProfile}.tsx

src/lib/media.ts ────┬─> src/components/{AlbumAddSheet,Onboarding}.tsx
                     ├─> src/pages/{Album,Trash,BabyProfile}.tsx
                     └─> src/lib/photoDelete.ts

src/lib/birth.ts ──> src/data/store.tsx（reducer 包装）
backend/media.py ──> backend/storage.py、backend/family.py、backend/accounts.py
backend/ai_insights.py ──> backend/llm.py、backend/accounts.py
```

**顺序约束**（必须遵守，否则会返工）：

1. `store.tsx`（M1）先于 M3/M4 —— AI 回填与权限刷新都依赖保存链的 409/403 处理。
2. `media.ts` + `photoDelete.ts`（M2）先于 M7 的「连接封装合并」—— 否则 media 模块要改两遍。
3. `birth.ts` 改动（4.4）在 `store.tsx` 稳定后做。
4. `App.tsx` 路由表化（5.1）放最后，避免影响前面所有页面的 e2e。

---

## 6. 兼容性风险与迁移

| 变更 | 兼容策略 |
| --- | --- |
| `rev` 列新增 | `MIGRATIONS` 幂等 `ADD COLUMN`（现有模式是 try/except 已存在）；回滚只回代码，列保留 |
| PUT /api/state 409 | 不带 `rev` 的请求走旧逻辑（无条件写），保证旧前端不炸 |
| `/api/media/{id}/restore` 改收 `ids` | 同时接受 `{id}` 与 `{ids}`，先读 `ids` |
| `/api/ai/summary` 返回结构 | 一个版本内同时返回旧 `state` 字段（前端不用），下个版本删 |
| 已删除媒体 blob 权限收紧 | 前端所有展示位已走「照片仍在相册」的数据源，不会因 404 出现新裂图；e2e 需覆盖回收站页 |
| 上传超时 | 仅在超时后报错，正常路径不变；大视频阈值要放宽到 5 分钟以上，避免误杀 |
| 服务端多实例 | 登录节流、AI 限流仍是进程内存 —— 方案**不新增**对多实例的假设，部署单实例前有效 |

**明确不动的兼容面**：`state_json` 结构（除新增字段）、`media` 表字段、路由 hash 命名、`localStorage` key 名。

---

## 7. 测试方案

### 7.1 每次改动（门禁，必须全绿）

```
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src _test
npm run test           # vitest（不得低于 50）
npm run test:python    # unittest（不得低于 12）
npm run build          # 体积变化 <2%
```

### 7.2 每阶段追加

| 阶段 | 新增用例 | 端到端 |
| --- | --- | --- |
| 一 | 保存重试、恢复多 id、rev 冲突、AI 只追加 | 回收站恢复后图片可加载；离线→在线自动补发 |
| 二 | 无（删除型改动靠现有用例兜底） | 全量 20 套 |
| 三 | 签名快照、契约用例表 | 全量 20 套 + 8016 冒烟 |
| 四 | 草稿拦截、权限降级、hero 保留 | 切 Tab 确认、降级后只读 |
| 五 | 路由表渲染快照（可选） | `_e2e_back`/`_e2e_exit`/`_e2e_layout` |
| 六 | 上传超时/取消、已删媒体 404 | 回收站页、媒体直链 |
| 七 | 无 | 全量 20 套 |

### 7.3 覆盖率目标（务实）

- 不追百分比，追**风险函数**：`store.tsx` 保存链、`Trash` 恢复、`media.ts` 上传、`photoDelete.ts`、`birth.ts` 各至少 1 条失败路径用例。
- 目标：vitest 50 → **≥ 62**，后端 12 → **≥ 18**。

---

## 8. 回滚方式

| 层级 | 手段 |
| --- | --- |
| 代码 | 每阶段独立分支；**每个可独立理解的变化一个提交**，单点 `git revert <sha>` |
| 数据 | 改动前 `python backend/backup.py dump` 生成快照（已有能力，含 8 张表）；`state_backups` 表另有重置/加入家庭前的自动存档 |
| DDL | 只加列/表，不删列；回滚代码即可，旧代码忽略新列 |
| 前端 | 生产产物是构建物，回滚 = 重新部署上一版镜像 tag |
| 后端行为开关 | 对「改变语义」的改动（409、AI 返回结构）保留一个环境变量开关：`NESTORY_STATE_CONFLICT=rev|legacy`、`NESTORY_AI_SUMMARY_STATE=1|0`，默认新行为，出问题可快速切回 |
| 灰度 | 单实例部署下无灰度；本地先用 8016 + 生产构建跑 e2e，再同步到用户服务 |

**不可回滚点（需要额外谨慎）**：3.2 SigV4 重构（签名错 = 上传全挂，必须先本地驱动跑通再上 S3）、1.1 若改动 `UNSAVED_KEY` 存储格式（新老客户端混用同一浏览器时，老格式要能读）。

---

## 9. 排期建议

| 周 | 内容 |
| --- | --- |
| 第 1 周 | 阶段一（4 项）+ 门禁 + e2e 回归 |
| 第 2 周 | 阶段二（死码）+ 阶段四（业务逻辑） |
| 第 3 周 | 阶段三（合并重复）+ 阶段五（架构两件） |
| 第 4 周 | 阶段六（性能安全）+ 阶段七（文档规范）+ 全量验收 |

每周末保持「可发布状态」；任何阶段超期，优先砍阶段五/六中的可选项（5.2、6.5），不砍阶段一/二。

---

## 10. 验收标准（Definition of Done）

1. `npm run check` 全绿，vitest ≥ 62、后端 ≥ 18，e2e 20/20。
2. 业务上：离线改动可恢复；回收站恢复后 8 天仍能看图；两台设备同时编辑不丢记录；AI 小结不影响其他记录。
3. 代码上：LEGACY A 类 9 项清零；3 处连接封装收敛为 1；SigV4 只有一份；死码扫描（TS 零引用导出、后端零引用定义）为 0。
4. 文档上：`docs/audit/` 三份报告归档；README 与实现一致；「不变量」文档存在。
5. 体积与性能：JS gzip 增幅 ≤5%，首屏接口数量不增加。
