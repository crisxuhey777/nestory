# Nestory 前端复查记录

日期：2026-11-12

## 复查范围

- 数据层：`src/data/store.tsx`、`types.ts`、`config.js`、`backend/app_state.py`
- 逻辑：`src/lib/date.ts`、`stats.ts`、`media.ts`、`route.ts`、`prefs.ts`
- 页面：Home、Feed、Growth、Album、Profile、Settings、Reminders、About
- 组件：Sheet、Common、QuickSheets、图标与 Logo
- 工程：构建、e2e、单元测试、本地存储与 IndexedDB

## 已修复

| 位置 | 问题 | 修复 |
| --- | --- | --- |
| `src/main.tsx` | 测试检查的 `window.__nestoryErrors` 从未定义，崩溃检查永远通过 | 安装 `error` / `unhandledrejection` 收集器（上限 20 条） |
| `src/data/store.tsx` | 120ms 防抖持久化，关页可能丢失最后一次记录 | 每次 state 变化立即写入 |
| `src/data/store.tsx` | localStorage 写入失败被静默吞掉 | 捕获配额异常并提示一次 |
| `src/pages/Home.tsx` | 已选照片失效时回退到不存在的默认 id | 回退到相册现有照片 |
| `src/pages/Home.tsx` | 手动切换后自动轮播可能立刻打断 | 手动操作暂停 10 秒 |
| `src/pages/Home.tsx` | 四宫格空位之外的 ghost 格仍可点击，造成数组空洞 | `disabled` |
| `src/pages/Feed.tsx` | 空状态把 `\n` 当字面量显示 | 改为单行文案 |
| `src/pages/Feed.tsx` | 非法时间输入得到 00:00 | 回退到原时间/当前时间 |
| `src/pages/Feed.tsx` | 瓶喂时间缺少「现在」快捷 | 新增快捷按钮 |
| `src/pages/Feed.tsx` | 编辑时表单尚未渲染就读取 ref，滚动失效 | 改到 `editing` 变化的 effect |
| `src/pages/Feed.tsx` | 二级记录无法用 Esc 关闭 | 增加 Esc 监听并恢复滚动 |
| `src/lib/media.ts` | Canvas 2D 不可用时返回已 revoke 的 blob URL | 直接抛错 |
| `src/lib/media.ts` | 无法解码的视频可能永久等待 metadata | 8 秒超时 |
| `src/pages/Album.tsx` | 在月份筛选下添加照片后看不到新照片 | 添加成功后回到「全部」 |
| `src/pages/Album.tsx` | 全屏查看未处理 Esc | 增加 Esc 与滚动锁定 |
| `src/pages/Settings.tsx` | 通知权限请求可能抛出未捕获异常 | try/catch + 提示 |
| `src/pages/Profile.tsx` | 允许未来出生日期，出现负月龄 | 限制到今天并校验 |

## 已清理

删除其他 agent / 过期文件：

- `.workbuddy/`（设计素材与上一轮 memory）
- `Nestory-交互原型.html`（V1 灰色原型）
- `Nestory-线框与交互原型-总览.png`
- `dist/`、`tsconfig.tsbuildinfo`、`_prd.txt`
- 一次性脚本 `_fetch_fonts.py`、`_photos.py`、`_check.py`
- `shots/` 内 77 张中间截图（73.9 MB → 约 20 MB）

保留：

- `src/`、`public/`、`_test/`、`PRD.docx`、`Nestory-UI设计稿-总览.png`
- `_e2e*.mjs`、`_shot.mjs`、`_ui_shot.mjs`、`_probe.mjs`
- `_brand/` + `_brand_make.py` + `_brand_render.py`（品牌再生成）
- `_pack.py`（打包）
- `README.md`、`BRAND.md`、`AUDIT.md`

## 验证结果

| 检查 | 结果 |
| --- | --- |
| TypeScript | `tsc --noEmit` 通过 |
| 生产构建 | 通过，JS 348.52 kB / gzip 105.36 kB |
| 单元测试 | 7/7 |
| 喂养 e2e | 42/42 |
| 首页 e2e | 28/28 |
| 相册 e2e | 20/20 |
| 我的家庭 e2e | 19/19 |
| 设置 e2e | 26/26 |
| 布局 e2e | 22/22 |

## 已知限制（非 bug）

- Live 照片在 Web 端只能以「短片 + 海报」形式保存，无法读取 iOS 系统级 Live 配对文件；HEVC 编码依赖浏览器解码能力。
- 视频存放在浏览器 IndexedDB，仅限本机；导出的 JSON 不含视频二进制。
- 提醒为应用内提示，尚未接入 Capacitor / Service Worker 的系统通知调度。
- 数据保存在 localStorage，尚未接入 Supabase 云同步。
