# NESTORY 业务逻辑与潜在 Bug 审计报告

- 日期：2026-11-14
- 范围：`src/`（60 个 TS/TSX）、`backend/`（19 个 Python）、`_test/`、`_e2e_*.mjs`
- 方式：**只读**。逐条读码取证 + 现有测试/e2e 基线 + 定向 grep 与几何/接口核对；**未修改任何文件**，未重启用户正在运行的服务。
- 基线（审计当时）：tsc 0 · eslint 0 · vitest 10 文件 50 用例 · 后端 unittest 12 用例 · e2e 20 套全绿（dev server 5178）
- 修复状态（2026-11-14 晚，见 `REFACTOR-PLAN-2026-11-14.md` 阶段一）：**BIZ-02 已修**（`b444474` 保存失败退避重试 + 恢复网络立即补发）、**BIZ-01 已修**（`3416e9a` 恢复一张照片的全部媒体记录）、**BIZ-03 已修**（`edc6877` `rev` + `If-Match` 乐观锁，跨设备冲突提示并载入最新）、**BIZ-05 已修**（`/api/ai/summary` 只回 `milestone`，前端只追加里程碑）。其余条目未动。

## 0. 结论摘要

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 已确认 Bug | 4 | 有完整代码链路，按步骤必现（其中 2 个表现为延迟故障） |
| 可复现异常 | 3 | 需要特定时序/网络条件，代码路径可证 |
| 潜在逻辑缺陷 | 6 | 架构或状态机层面的丢数据/越权窗口 |
| 测试覆盖不足 | 5 | 上述问题全部落在现有测试的盲区 |

最值得先处理的三件事：

1. **BIZ-02** 离线/失败保存没有重试，也没有 `online` 监听——用户以为存了，其实丢了。
2. **BIZ-01** 回收站恢复只恢复主文件，缩略图/视频条目 7 天后被清理，恢复的照片之后裂图。
3. **BIZ-03** 多设备/多标签整份状态覆盖，后保存者赢，另一台设备的记录静默消失。

---

## A. 已确认 Bug

### BIZ-01 · 回收站恢复只恢复主文件，缩略图 7 天后失效

- **涉及功能**：相册 → 最近删除 → 恢复
- **复现步骤**
  1. 相册里删除一张照片（照片有缩略图，`uploadPhoto` 会传原图 + 480 缩略图两条 media）。
  2. 立刻进入「最近删除」点恢复。
  3. 相册里照片回来了，缩略图正常。
  4. **等待照片被删除满 7 天**（或把 `deleted_at` 改早），后台 purge 跑过一次。
  5. 刷新相册：这张照片卡片裂图。
- **预期**：恢复后原图与缩略图都恢复，照片长期可看。
- **实际**：只恢复了 `src` 指向的那一条 media，`thumb`（以及 Live Photo 的 `video`）仍是已删除状态；`media.purge_expired()` 按 `deleted_at` 清理时把缩略图行与对象一起删掉，卡片 `<img src={photo.thumb}>` 此后 404，且没有 `onError` 回退。
- **文件与代码位置**
  - 删除侧收集了全部 id：`src/lib/photoDelete.ts`（`mediaIdsOfPhoto` → `src/thumb/video/motion.video`）
  - 恢复侧只取第一个：`src/pages/Trash.tsx:67` `mediaIdsOf(entry.src, entry.thumb)[0]`、`src/pages/Trash.tsx:96` `mediaApi.restore(item.id)`
  - 后端也只恢复单条：`backend/media.py:449` `UPDATE media SET deleted_at = NULL WHERE id = %s`
  - 展示侧无兜底：`src/components/AlbumCards.tsx:67`、`:109` `<img src={photo.thumb || photo.src}>`
  - 清理侧：`backend/media.py:454` `purge_expired()`
- **根本原因**：删除与恢复的粒度不一致——删除按「一张照片 = 多条媒体」，恢复按「一条媒体」。7 天内看不出来，因为 `_media_blob` 对已删除行仍返回字节（`backend/server.py` `row_for(..., include_deleted=True)`）。
- **修复建议**：恢复时把该 `Photo` 的全部 id 一起提交（`Trash` 条目里已存 `thumb`/`video`，用 `mediaIdsOf` 收集全部而不是 `[0]`），后端 `restore` 接受数组或按「同 object 前缀」批量恢复；`<img>` 加 `onError` 回退到 `src` 或占位图。
- **推荐测试用例**：恢复后断言 `thumb` 的 media 行 `deleted_at IS NULL`；把 `deleted_at` 改到 8 天前跑 `purge_expired()`，再刷新相册断言图片仍 200。
- **严重程度**：P1（延迟性数据不可用，且回收站里会堆一堆无法单独恢复的孤儿缩略图）

### BIZ-02 · 保存失败不重试，离线改动会永久丢失

- **涉及功能**：全局自动保存（任何记录）
- **复现步骤**
  1. 手机开飞行模式。
  2. 记录一次喂奶 / 一次睡眠。
  3. 界面提示正常，回首页也能看到这条记录。
  4. 关掉飞行模式（不刷新、不再做任何编辑）。
  5. 关闭页面 / 杀掉应用，重新进入。
  6. 刚才那条记录不见了；只有一条「上次离开时的改动可能没保存」的提示。
- **预期**：网络恢复后自动补发；或至少在恢复网络时立刻重试。
- **实际**：`queueSave` 失败只 `recordSaveError` + 8 秒节流 toast，`dirty` 保持 true，但既没有定时重试也没有 `online` 监听（全仓 grep `online` 为 0）；`visibilitychange`/`pagehide` 的 flush 仍是失败一次就结束。
- **文件与代码位置**
  - `src/data/store.tsx:362-385` `queueSave` 失败分支
  - `src/data/store.tsx:344-355` 启动时读 `UNSAVED_KEY` 提示
  - `src/data/store.tsx` 内 flush 挂载点（`pagehide` / `visibilitychange` / 卸载 cleanup）
  - 反向证据：`window.addEventListener('online'` 全仓 0 命中
- **根本原因**：保存链只有「成功」与「记录失败」两条路，没有「稍后重试」状态；失败被降级为一次性提示。
- **修复建议**：加 `online` 监听 + 退避重试（例如 5s/15s/60s），`dirty` 为 true 时定时重发；`UNSAVED_KEY` 里保存待发快照而不只是一个标记，重启后先补发再 hydrate。
- **推荐测试用例**：fail 前两次 `PUT /api/state` 再成功，断言最终落库；模拟 offline→online 断言自动补发；卸载页面时未保存内容不丢。
- **严重程度**：P1（静默丢数据，且用户完全没有补救手段）

### BIZ-03 · 多设备 / 多标签整份状态覆盖

- **涉及功能**：家庭共享记录
- **复现步骤**
  1. 妈妈手机打开首页，爸爸平板同时打开。
  2. 妈妈记录一次喂奶；爸爸此时删掉一张照片（或改宝宝资料）。
  3. 两台设备各自 800ms 内先后 PUT 整份 state。
  4. 刷新任一设备：后保存者覆盖，先保存者那一条改动消失。
- **预期**：两条改动都保留（不同记录的字段级合并）。
- **实际**：`save_state` 用整份 JSON 覆盖 `household_state`，没有版本号/ETag/字段级 diff，前端也没有跨标签同步（无 `storage` 事件、无 `BroadcastChannel`）。
- **文件与代码位置**
  - `backend/accounts.py` `save_state()`（整份 `UPDATE household_state SET state_json = ...`）
  - `src/data/store.tsx` 保存链（每次提交整个 `state`）
  - 对比：加入家庭时已有 `family.merge_states()` 做列表级并集，但正常保存路径没用它
- **根本原因**：并发模型是「最后写入者赢」，而产品语义是「家庭成员共同编辑」。
- **修复建议**：短期加 `updated_at`/`rev` 乐观锁，冲突时返回 409 并由前端重新拉取+合并；中期改成按记录 id 的增删改接口，或服务端用 `merge_states` 合并提交的整份 state。
- **推荐测试用例**：两个会话各写一条记录后同时 PUT，断言两条都在；连续两次带旧 rev 的 PUT，第二次 409。
- **严重程度**：P1（家庭场景的核心数据丢失路径）

### BIZ-04 · 编辑表单切页/返回即丢，无草稿保护

- **涉及功能**：喂养中心编辑、宝宝档案、成长记录
- **复现步骤**
  1. 打开「喂养中心」，点某条记录「编辑」，改奶量但先不保存。
  2. 直接点底部 Tab「首页」或浏览器返回。
  3. 再回来：修改内容消失，且没有任何提示。
- **预期**：有未保存修改时拦截/提示，或保留草稿。
- **实际**：页面是 `useRoute` 的 `key: navSeq` 强制重挂载（`src/lib/route.ts`），组件卸载即丢本地 state；`ExitGuard` 只拦浏览器返回，不拦 Tab 切换与页面内跳转。
- **文件与代码位置**：`src/lib/route.ts`（`key: navSeq` / `useRoute`）、`src/App.tsx`（按 route 条件渲染）、`src/pages/Feed.tsx` 编辑态、`src/pages/BabyProfile.tsx` 的 `dirty` 标记（只用于基线同步，未用于拦截）
- **根本原因**：没有「脏表单」与导航层之间的契约。
- **修复建议**：把 `dirty` 提升到导航守卫：`switchTab`/`navigate` 前询问；或编辑态写入 sessionStorage 草稿，重挂载时恢复。
- **推荐测试用例**：编辑后点 Tab，断言出现确认弹窗；选择「留下」后内容仍在。
- **严重程度**：P2（高频误操作，但不涉及已保存数据）

---

## B. 可复现异常

### BIZ-05 · AI 小结回填整份 state，覆盖生成期间的编辑

- **涉及功能**：首页「AI 小结」
- **复现步骤**
  1. 首页点「让宝宝的一天被记住」，请求耗时数秒到数十秒。
  2. 请求进行中切到「喂养中心」记一条喂奶并保存。
  3. 回到首页等待 AI 返回。
  4. 新记的这条喂奶消失（本地与服务器都没有）。
- **预期**：AI 只追加一条成长时间轴记录，不动其他数据。
- **实际**：`aiPost(API.aiSummary, { state })` 返回后端基于**旧快照**拼好的整份 state，前端直接 `dispatch({type:'hydrate'})` 覆盖本地；随后 800ms 防抖把这份旧快照 PUT 回服务器，等于把并发编辑抹掉。该 hydrate 还没设 `skipNextSave`（对比 `reload()` 会设）。
- **文件与代码位置**：`src/pages/Home.tsx:246-267`（`aiPost` → `dispatch hydrate`，第 256 行）、`src/data/store.tsx:169-170`（`hydrate` 直接替换 state）、`src/data/store.tsx:470-482`（`reload()` 的 `skipNextSave` 对照）
- **根本原因**：把「AI 生成」实现成「服务端改写整份状态并与客户端同步」，而不是「返回一条 milestone 由客户端 dispatch」。
- **修复建议**：后端只返回 `{ title, note, milestone }`，前端 `dispatch({type:'addMilestone'})`；若必须回填，至少设 `skipNextSave` 并在 hydrate 前比对 `rev`。
- **推荐测试用例**：AI 请求挂起时插入一条记录，返回后断言该记录仍在、且只多一条 milestone。
- **严重程度**：P1（并发丢数据，且触发条件就是「边等边用」）

### BIZ-06 · 上传没有超时/取消，弱网下永久「上传中」

- **涉及功能**：相册添加照片/视频、头像上传
- **复现步骤**
  1. 手机切到极弱网（或上传一个较大的视频）。
  2. 相册 →「添加」→ 选视频。
  3. 上传开始后断网/限速到很低。
  4. 面板一直停在「上传中」，所有选项 disabled，只能刷新页面。
- **预期**：超时后报错并可重试；或允许取消。
- **实际**：`uploadMedia` 的 `fetch` 没有 `signal`、没有超时（对比 `api.request` 有 20s），`AlbumAddSheet` 的 `busy` 期间没有出口。
- **文件与代码位置**：`src/lib/media.ts` `uploadMedia`（PUT 到预签名地址的 fetch）、`src/components/AlbumAddSheet.tsx:42-80`（`busy` 包裹整个上传）、`src/lib/media.ts` `uploadClip`/`uploadAvatar`
- **根本原因**：上传链路是直接从浏览器 PUT 到对象存储，绕过了统一的 `api.request` 超时/取消机制。
- **修复建议**：上传请求加 `AbortController` + 超时（视频按大小放宽），面板提供「取消」；超时后允许重试同一草稿。
- **推荐测试用例**：mock 一个 30s 不响应的 PUT，断言 20s 后出现错误 toast 且按钮恢复可点。
- **严重程度**：P2

### BIZ-07 · 上传成功但取消保存，媒体成为不可见孤儿

- **涉及功能**：相册「添加到相册」
- **复现步骤**
  1. 相册 →「添加」→ 选一张照片，上传完成。
  2. 弹出的草稿面板里直接关闭（或点「取消」），不点保存。
  3. 打开相册、回收站：都看不到这张照片。
  4. 后台配额里却多了一份文件。
- **预期**：取消时删掉刚上传的媒体，或至少提示「已上传，未加入相册」。
- **实际**：上传即写媒体库并 `confirm` 为 ready；取消只清本地 `draft`，media 行与对象永久留存，无任何入口可见。
- **文件与代码位置**：`src/components/AlbumAddSheet.tsx:45-74`（上传后 `onDraft` + `onClose`）、`src/pages/Album.tsx:232-277`（`saveDraft` 才 dispatch）、`src/pages/Album.tsx:447-460`（关闭面板只 `setDraft(null)`）
- **根本原因**：媒体生命周期（上传/入库）与业务生命周期（加入相册）被拆成两步，但缺少「回滚」。
- **修复建议**：取消时调 `mediaApi.remove(draftId)`（草稿里带上 media id）；或延迟确认（保留 pending，保存时才 confirm）。
- **推荐测试用例**：上传后取消，断言没有 `state='ready'` 且无引用的 media 行。
- **严重程度**：P2（配额泄漏，且用户无法清理）

---

## C. 潜在逻辑缺陷

### BIZ-08 · 权限降级后客户端不刷新，仍允许编辑

- **涉及功能**：家庭成员权限（admin/edit/read）
- **场景**：管理员把某成员从 edit 降为 read。该成员已打开的应用里 `permission` 来自启动时拉取的 `state.family`，不会刷新；他继续填表 → 本地显示成功 → 800ms 后服务端 403 `read_only` → toast「保存失败：这个账号是只读成员…」，重载后编辑丢失。回收站页基于本地 `isAdmin`，降级后仍能进入，随后列表请求 403。
- **文件与代码位置**：`src/data/store.tsx:315-319`（`permission` 派生自 `state.family`）、`backend/accounts.py:503-505`（`save_state` 的 403）、`src/pages/Trash.tsx:129`（本地 `isAdmin` 门禁）、`src/lib/family` 相关刷新入口缺失
- **根本原因**：权限是快照数据，缺少会话级校验与主动刷新；服务端只做写入时拒绝，未把「当前权限」回传给客户端。
- **修复建议**：保存 403 `read_only` 时把 `permission` 降级并提示；`/api/state` 响应带 `permission` 字段；进入 admin-only 页面时以服务端结果为准。
- **推荐测试用例**：降级后成员下一次保存断言 UI 变为只读态且不再发请求。
- **严重程度**：P2

### BIZ-09 · 重置数据与防抖保存存在竞态

- **涉及功能**：设置 → 清空所有记录
- **场景**：点「清空」前 800ms 内刚有编辑，其 PUT 与 `resetState` 的 PUT 顺序不确定；若旧快照后到，服务器被重新写回旧数据。`reset` 的 hydrate 也没设 `skipNextSave`，会再多写一次。
- **文件与代码位置**：`src/data/store.tsx:452-458`（`reset` 分支）、`src/data/store.tsx` 保存链
- **根本原因**：重置没有先取消排队中的保存。
- **修复建议**：reset 前 `saveChain = Promise.resolve()`、`clearTimeout`、置 `skipNextSave`。
- **推荐测试用例**：编辑后立即点清空，断言最终服务器为空。
- **严重程度**：P2

### BIZ-10 · 加入家庭后整份 reload，丢掉加入前的未保存改动

- **涉及功能**：邀请加入家庭
- **场景**：加入前 800ms 内刚记了一条，`joinFamily` 用的是服务端旧副本做 merge，随后 `reload()` 覆盖本地 → 这一条既没进 merge 也没被保存。
- **文件与代码位置**：`src/pages/Join.tsx:61-62`（`joinFamily` → `reload()`）、`src/data/store.tsx:470-482`
- **修复建议**：join 前先 `flushPending()` 落盘，再 merge。
- **严重程度**：P2

### BIZ-11 · 首页时间文案不会自己走

- **涉及功能**：首页「距上次喂养 / 今日睡眠 / 月龄天数」
- **场景**：只配了 1 张首页照片（或暂停了自动轮播）时，页面长期打开不动，「20 分钟前」会一直停在 20 分钟，睡眠时长也不增长。
- **文件与代码位置**：`src/pages/Home.tsx:269` `const now = Date.now()`（渲染期取一次）、`src/pages/Home.tsx:186-196`（自动轮播是唯一的定时重渲染，且要求 `heroSlides.length >= 2`）
- **修复建议**：加 30s/60s 的最小刷新计时器（`visibilitychange` 回到前台时也刷新）。
- **严重程度**：P2

### BIZ-12 · 封面选择永久丢失

- **涉及功能**：首页照片（hero）
- **场景**：把生日改早 → 照片被归档 → `normalizeBirthState` 用「当前可见照片」过滤 `heroPhotoIds`，被归档照片的封面 id 被永久移除；生日改回、照片回来，封面回不来。
- **文件与代码位置**：`src/lib/birth.ts:89-90`（`next.heroPhotoIds = state.heroPhotoIds.filter(...)`）
- **修复建议**：过滤时保留 id（渲染时再用可见集合取交集）。
- **严重程度**：P3

### BIZ-13 · 成员权限/移除操作没有防连点

- **涉及功能**：「我的」→ 家庭成员
- **场景**：连续点两次「设为只读」/「移出家庭」，发两次请求，第二次可能 404 或把刚改的权限再改一次。
- **文件与代码位置**：`src/pages/Profile.tsx:46-93`（`changePermission` / `removeMember` 无 busy 守卫）
- **对比**：其余写操作都有守卫（`Album` 的 `deleting`、`Trash` 的 `busyId`、`Invite`/`Join`/`AuthScreen`/`AlbumAddSheet`/`BabyProfile`/`Onboarding` 的 `busy`）
- **严重程度**：P3

---

## D. 测试覆盖不足

| 编号 | 场景 | 现状 | 建议 |
| --- | --- | --- | --- |
| T-01 | 保存失败与恢复 | 无任何用例；e2e 全部在正常网络下跑 | 用 `page.route` 拦截 `PUT /api/state` 失败 N 次，断言最终落库 |
| T-02 | 回收站恢复后图片真的能加载 | `_e2e_trash` 只断言 DOM 与文案，没有校验 `img` 的 `naturalWidth` | 恢复后 `waitForResponse(/blob/)` + 断言图片已解码 |
| T-03 | 并发写入 | 没有任何多会话用例 | 两个 context 各写一条，断言两条都在 |
| T-04 | 权限变更 | e2e 只覆盖静态的三种角色 | 会话中途改权限，断言 UI 与请求都收敛为只读 |
| T-05 | 编辑器草稿 | 无 | 编辑后切 Tab，断言提示或草稿保留 |

另：`src/data/store.tsx` 的保存链、`src/pages/Trash.tsx` 的恢复分支、`src/lib/media.ts` 的 `uploadMedia` 都没有单元测试——恰好是本报告 A/B 类问题的集中地。

---

## E. 已排查、未发现问题的场景（避免误报）

- **重复提交**：`FeedSheet`/`QuickSheets`/`Invite`/`Join`/`AuthScreen`/`AlbumAddSheet`/`BabyProfile`/`Onboarding`/`Album` 批量删除/`Trash` 恢复都有 busy 守卫或幂等处理；只有 `Profile` 的两处缺（BIZ-13）。
- **生日边界**：`isBeforeBirth` 在 `Feed.tsx:159`、`FeedSheet.tsx:107`、`QuickSheets.tsx:18/88/241`、`Album.tsx:252` 全部覆盖，未发现可绕过入口。
- **空数据/首启**：`build_empty_state` 与 `normalizeBirthState` 对空数组、缺字段（`?? []`）都有兜底；`onboarded` 严格比较 `=== false`，未初始化时不会误进引导。
- **退出登录**：`leave()` 先 `flushPending(false)` 再 `signOut`；`pagehide`/`visibilitychange` 也有 flush。
- **回收站过期**：删除超过 7 天的条目在 UI 层过滤，服务端 `restore` 返回 410 且前端已处理。
- **状态恢复**：`reload()` 用 `skipNextSave` 避免回写；`UNSAVED_KEY` 在启动时提示。

## F. 本轮无法验证的部分（需真机/生产环境）

- 冷启动/热启动、进程被杀、系统低内存与存储不足下的行为。
- 系统通知权限在「已拒绝」「仅一次」等状态下的差异（代码路径已读，实际系统行为需真机）。
- 应用完全关闭后的提醒（当前实现依赖页面存活，见 BIZ-14，属产品边界）。

## G. 建议的修复顺序（只列顺序，不含实现）

1. BIZ-02（保存重试）与 BIZ-03（并发覆盖）——两者都是静默丢数据。
2. BIZ-01（回收站恢复）——7 天后才暴露，越晚修越脏。
3. BIZ-05（AI 回填）与 BIZ-09/BIZ-10（重置、加入家庭）——同一类「整份 hydrate 覆盖」。
4. BIZ-06/BIZ-07（上传超时、孤儿媒体）。
5. BIZ-08（权限刷新）、BIZ-11（时间不走）、BIZ-04（草稿保护）。
6. BIZ-12/BIZ-13 与 T-01…T-05 的测试补位。
