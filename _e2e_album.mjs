import { seedSession } from './_login_session.mjs'
// Album media regression: camera options, Live photos, video upload + persistence.
// usage: node _e2e_album.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9800 + Math.floor(Math.random() * 150)
const profile = mkdtempSync(join(tmpdir(), 'nestory-album-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break
  } catch {
    /* not up */
  }
  await sleep(250)
}
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Page.enable')
await send('Runtime.enable')
await seedSession(send, BASE)
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function goto(url) {
  await send('Page.navigate', { url })
  await sleep(700)
  try {
    await evaluate('document.fonts.ready')
  } catch {
    /* ignore */
  }
  await sleep(250)
}
const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`)
const clickSel = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)

async function fileNodes() {
  const doc = await send('DOM.getDocument', { depth: -1 })
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
  return nodeIds
}
async function upload(index, file) {
  const nodes = await fileNodes()
  if (!nodes[index]) throw new Error(`no file input ${index}`)
  await send('DOM.setFileInputFiles', { nodeId: nodes[index], files: [resolve(file)] })
}
async function waitFor(expression, timeout = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return true
    await sleep(120)
  }
  return false
}

await goto(BASE + '/#/home')
await evaluate('localStorage.clear()')
await goto(BASE + '/#/album')

// ---------- seeded live photo ----------
check('相册显示瞬间总数', (await text('.tab-head__meta')).startsWith('6 个瞬间'), await text('.tab-head__meta'))
check('封面带 LIVE 标记', (await evaluate(`document.querySelectorAll('.album-badge--live').length`)) >= 1, '')
check('Live 封面标明会动', (await text('.album-cover__cap')).includes('会动'), await text('.album-cover__cap'))

await clickSel('.album-cover')
await sleep(500)
check(
  'Live 打开后播放短片',
  (await evaluate(`(() => {
    const v = document.querySelector('.lightbox video');
    return !!v && (v.getAttribute('src') || '').includes('nest-live.mp4') && v.loop === true && v.muted === true
  })()`)) === true,
  await evaluate(`document.querySelector('.lightbox video')?.getAttribute('src') ?? 'none'`),
)
await clickSel('.lightbox__close')
await sleep(250)

// ---------- add sheet + capture options ----------
await clickSel('.tab-head .icon-btn')
await sleep(450)
check('添加入口打开抽屉', (await evaluate(`!!document.querySelector('.sheet')`)) === true, '')
check('提供照片/视频/Live 六种入口', (await evaluate(`document.querySelectorAll('.media-opt').length`)) === 6, '')
check('三个拍摄入口带 capture 属性', (await evaluate(`document.querySelectorAll('input[type=file][capture]').length`)) === 3, '')
check('提示 Live 的工作原理', (await text('.media-note')).includes('Live'), '')

// ---------- video upload ----------
await upload(2, 'public/assets/videos/nest-live.mp4')
await waitFor(`document.querySelectorAll('.album-card').length >= 4 && !document.querySelector('.sheet')`, 6000)
check('视频上传后加入相册', (await text('.tab-head__meta')).startsWith('7 个瞬间'), await text('.tab-head__meta'))
check('视频封面有长度徽标', /0:0\d/.test(await text('.album-badge')), await text('.album-badge'))
check('视频生成海报而不是黑屏', (await evaluate(`document.querySelector('.album-cover img').src.includes('/api/media/blob/')`)) === true, '')

await clickSel('.album-cover')
await sleep(500)
check('视频用播放器打开', (await evaluate(`!!document.querySelector('.lightbox video[controls]')`)) === true, '')
check(
  '视频来自媒体库地址',
  (await evaluate(`(document.querySelector('.lightbox video')?.getAttribute('src') || '').includes('/api/media/blob/')`)) === true,
  await evaluate(`document.querySelector('.lightbox video')?.getAttribute('src') ?? 'none'`),
)
await clickSel('.lightbox__close')
await sleep(250)

// ---------- live upload ----------
await clickSel('.tab-head .icon-btn')
await sleep(350)
await upload(4, 'public/assets/videos/nest-live.mp4')
await waitFor(`document.querySelectorAll('.album-badge--live').length >= 2`, 6000)
check('Live 导入后出现会动照片', (await text('.album-cover__cap')).includes('会动的瞬间'), await text('.album-cover__cap'))
check('Live 覆盖封面并带 LIVE', (await evaluate(`document.querySelectorAll('.album-badge--live').length`)) >= 2, '')

// ---------- persistence ----------
await goto(BASE + '/#/album')
check('刷新后总数保留', (await text('.tab-head__meta')).startsWith('8 个瞬间'), await text('.tab-head__meta'))
await clickSel('.album-cover')
await sleep(500)
check(
  '刷新后 Live 仍可播放',
  (await evaluate(`(document.querySelector('.lightbox video')?.getAttribute('src') || '').includes('/api/media/blob/')`)) === true,
  await evaluate(`document.querySelector('.lightbox video')?.getAttribute('src') ?? 'none'`),
)
await clickSel('.lightbox__close')
await sleep(250)

// ---------- still photo ----------
await clickSel('.tab-head .icon-btn')
await sleep(350)
await upload(0, 'public/assets/photos/p3@520.jpg')
await waitFor(`(document.querySelector('.tab-head__meta')?.textContent || '').startsWith('9 个瞬间')`, 8000)
check('照片仍可上传', (await text('.tab-head__meta')).startsWith('9 个瞬间'), await text('.tab-head__meta'))
check('照片上传后成为封面', (await text('.album-cover__cap')).includes('今天的模样'), await text('.album-cover__cap'))

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-album.png', Buffer.from(shot.data, 'base64')),
)
await evaluate('localStorage.clear()')
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
