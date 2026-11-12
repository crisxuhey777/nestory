// AI 小结交互截图：点击按钮 → 生成中引导层 → 结果卡片
// usage: node _shot_ai.mjs <url>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const url = process.argv[2] || 'http://127.0.0.1:5178/'
const port = 9800 + Math.floor(Math.random() * 100)
const profile = mkdtempSync(join(tmpdir(), 'nestory-ai-'))

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

async function waitPort() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('chrome did not start')
}

await waitPort()
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

const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  return r.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 430,
  height: 900,
  deviceScaleFactor: 2,
  mobile: true,
})
await send('Page.navigate', { url })
await sleep(1800)
await evaluate('document.fonts.ready', true).catch(() => {})

// 等首页真正渲染（后端数据到位）
for (let i = 0; i < 40; i++) {
  if (await evaluate("!!document.querySelector('.ai-card__cta')")) break
  await sleep(300)
}

await evaluate("document.querySelector('.ai-card').scrollIntoView({ block: 'center' })")
await sleep(500)
const idle = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync('shots/ai-idle.png', Buffer.from(idle.data, 'base64'))

await evaluate("document.querySelector('.ai-card__cta').click()")
await sleep(1200)
const thinking = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync('shots/ai-thinking.png', Buffer.from(thinking.data, 'base64'))

let done = false
for (let i = 0; i < 200; i++) {
  done = !!(await evaluate("!!document.querySelector('.ai-card--done')"))
  if (done) break
  await sleep(500)
}
console.log('done:', done)
console.log('title:', await evaluate("document.querySelector('.ai-card__title')?.textContent"))
console.log('note:', await evaluate("document.querySelector('.ai-card__note')?.textContent"))
console.log('story:', await evaluate("document.querySelector('.story__text')?.textContent"))

await evaluate("document.querySelector('.ai-card').scrollIntoView({ block: 'center' })")
await sleep(400)
const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync('shots/ai-result.png', Buffer.from(result.data, 'base64'))

ws.close()
chrome.kill()
