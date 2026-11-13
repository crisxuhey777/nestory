import { seedSession } from './_login_session.mjs'
// Album AI story: describe photos once, cache visual captions, then write story.
// usage: node _e2e_ai_story.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 10180 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-ai-story-'))

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
    const r = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (r.ok) break
  } catch {}
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
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
async function waitFor(expression, ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await evaluate(expression)) return true
    await sleep(300)
  }
  return false
}

await send('Page.navigate', { url: `${BASE}/#/album` })
await sleep(1200)
await evaluate(`document.querySelector('.ai-panel__cta').click()`)
const reading = await waitFor(`!!document.querySelector('.ai-panel__loading')`, 4000)
check('开始读照片', reading)
const done = await waitFor(`!!document.querySelector('.ai-story__body')`, 90000)
check('故事生成', done)
const body = await evaluate(`document.querySelector('.ai-story__body')?.textContent.trim() || ''`)
check('故事非空', body.length >= 20, `${body.length} chars`)
const foot = await evaluate(`document.querySelector('.ai-panel__foot')?.textContent.trim() || ''`)
check('页脚显示照片数', /读了\s*\d+\s*张照片/.test(foot), foot)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('shots/final-album-story.png', Buffer.from(shot.data, 'base64'))

await send('Page.reload')
await sleep(1500)
await evaluate(`document.querySelector('.ai-panel__cta').click()`)
const done2 = await waitFor(`!!document.querySelector('.ai-story__body')`, 90000)
check('缓存后再次生成', done2)
const foot2 = await evaluate(`document.querySelector('.ai-panel__foot')?.textContent.trim() || ''`)
check('缓存后仍带照片数', /读了\s*\d+\s*张照片/.test(foot2), foot2)

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
