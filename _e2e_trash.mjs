import { seedSession } from './_login_session.mjs'
// Album delete -> recent-deleted (7 days) -> restore.
// usage: node _e2e_trash.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9700 + Math.floor(Math.random() * 120)
const profile = mkdtempSync(join(tmpdir(), 'nestory-trash-'))
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
await send('DOM.enable')
await seedSession(send, BASE)
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function waitFor(expression, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return true
    await sleep(100)
  }
  throw new Error('timeout: ' + expression)
}
async function goto(url) {
  await send('Page.navigate', { url })
  await waitFor('!!document.querySelector(".app")')
  await sleep(1500)
}
async function reload() {
  await send('Page.reload', { ignoreCache: true })
  await waitFor('!!document.querySelector(".app")')
  await sleep(1500)
}
const readState = () => evaluate(`(async () => (await (await fetch('/api/state')).json()).state)()`)
const putState = (state) =>
  evaluate(
    `fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: ${JSON.stringify(state)} }) }).then(r => r.status)`,
  )

await goto(BASE + '/?e2e=trash#/album')

const clearServerTrash = async () => {
  const items = await evaluate(`(async () => (await (await fetch('/api/media/trash')).json()).items)()`)
  for (const item of items ?? []) {
    await evaluate(
      `fetch('/api/media/${item.id}/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status)`,
    )
  }
  return (items ?? []).length
}

// 上一次失败可能留下回收站条目，先恢复干净再测。
await clearServerTrash()
await reload()

const before = await readState()
const beforeCount = (before.photos || []).length
const firstCaption = (before.photos || [])[0]?.caption ?? ''

try {
  check('筛选行右侧有选择按钮', (await evaluate(`!!document.querySelector('.album-select-btn')`)) === true)
  await evaluate(`document.querySelector('.album-select-btn').click()`)
  await waitFor(`!!document.querySelector('.album-card--selectable')`)
  check(
    '进入多选后每张照片都有勾选位',
    (await evaluate(`document.querySelectorAll('.album-card--selectable .album-card__check').length`)) > 0,
  )

  await evaluate(`document.querySelector('.album-card--selectable').click()`)
  const bar = await evaluate(`document.querySelector('.album-select-bar')?.innerText.replace(/\\s+/g, ' ').trim()`)
  check('底部显示已选数量', bar.includes('已选 1 项'), bar)

  await evaluate(`document.querySelector('.album-select-bar__delete').click()`)
  await waitFor('!!document.querySelector(".sheet")')
  await sleep(300)
  const sheetText = await evaluate(`document.querySelector('.sheet')?.innerText.replace(/\\s+/g, ' ').trim()`)
  check('确认面板说明 7 天可恢复', sheetText.includes('保留 7 天') && sheetText.includes('无法找回'), sheetText.slice(0, 60))

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('移入回收站'))
    btn?.click()
    return !!btn
  })()`)
  await waitFor(`document.body.innerText.includes('已移入最近删除')`, 6000)
  check('移入后给出提示', true)

  let afterDelete = null
  for (let i = 0; i < 24; i++) {
    const s = await readState()
    if ((s.photos || []).length === beforeCount - 1) {
      afterDelete = s
      break
    }
    await sleep(250)
  }
  check(
    '照片从相册移出',
    (afterDelete?.photos || []).length === beforeCount - 1,
    `${beforeCount} -> ${(afterDelete?.photos || []).length}`,
  )
  check(
    '回收站里保留原照片信息',
    (afterDelete?.trash || []).some((t) => t.caption === firstCaption && typeof t.deletedAt === 'number'),
    JSON.stringify((afterDelete?.trash || [])[0] ?? null),
  )

  await goto(BASE + '/?e2e=trash#/profile')
  const trashEntry = await evaluate(
    `(() => { const el = [...document.querySelectorAll('.setting')].find((n) => n.textContent.includes('最近删除')); el?.click(); return !!el })()`,
  )
  check('我的页面有「最近删除」入口', trashEntry === true)
  await waitFor(`location.hash.startsWith('#/trash')`)
  check('从我的进入最近删除', (await evaluate(`location.hash`)).includes('from=profile'))
  await waitFor('!!document.querySelector(".trash-card")')
  const backLink = await evaluate(`document.querySelector('.trash-back')?.innerText.trim()`)
  check('底部右侧有返回「我的」的文字入口', backLink === '我的', backLink)
  const backRect = await evaluate(
    `(() => { const el = document.querySelector('.trash-back'); const r = el.getBoundingClientRect(); return { right: window.innerWidth - r.right, bottom: window.innerHeight - r.top } })()`,
  )
  check('返回入口靠右对齐', backRect.right < 40, JSON.stringify(backRect))
  const card = await evaluate(`document.querySelector('.trash-card')?.innerText.replace(/\\s+/g, ' ').trim()`)
  check('最近删除页列出刚删的照片', card.includes(firstCaption) && card.includes('还剩 7 天'), card)

  await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
    writeFileSync('shots/e2e-trash.png', Buffer.from(r.data, 'base64')),
  )

  await evaluate(`document.querySelector('.trash-card__restore').click()`)
  await waitFor(`document.body.innerText.includes('已恢复到相册')`, 6000)
  await waitFor(`!document.querySelector('.trash-card')`)
  check('恢复后回收站清空', (await evaluate(`document.querySelectorAll('.trash-card').length`)) === 0)

  let afterRestore = null
  for (let i = 0; i < 24; i++) {
    const s = await readState()
    if ((s.photos || []).length === beforeCount) {
      afterRestore = s
      break
    }
    await sleep(250)
  }
  check('照片回到相册', (afterRestore?.photos || []).some((p) => p.caption === firstCaption), `${(afterRestore?.photos || []).length}`)

  await evaluate(`document.querySelector('.trash-back').click()`)
  await waitFor(`location.hash.startsWith('#/profile')`)
  check('点底部「我的」回到我的页面', (await evaluate(`location.hash`)).startsWith('#/profile'))

  await goto(BASE + '/?e2e=trash2#/album')
  check('相册恢复原数量', (await evaluate(`document.querySelectorAll('.album-card').length`)) === Math.min(beforeCount, 4))
} finally {
  await putState(before)
  await clearServerTrash()
  await sleep(1200)
  await reload()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
