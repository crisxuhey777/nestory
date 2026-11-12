// Full-page screenshots via Chrome DevTools Protocol.
// usage: node _shot.mjs <url> <out.png> [width] [height] [dpr] [fontSize]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const [url, out, w = '430', h = '900', dpr = '2', fontSize] = process.argv.slice(2)
const port = 9400 + Math.floor(Math.random() * 400)
const profile = mkdtempSync(join(tmpdir(), 'nestory-shot-'))

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
  for (let i = 0; i < 60; i++) {
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

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: Number(dpr),
  mobile: true,
})
await send('Page.navigate', { url })
await sleep(900)
await send('Runtime.evaluate', { expression: 'localStorage.clear()' })
if (fontSize) {
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('nestory.prefs.v1', ${JSON.stringify(
      JSON.stringify({ fontSize, reduceMotion: false, analytics: false }),
    )})`,
  })
}
await send('Page.reload')
await sleep(1600)
try {
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
} catch {
  /* ignore */
}
await sleep(500)

// 先把视口拉到整页高度，fixed 底栏才会落在页面底部而不是首屏底部
const first = await send('Page.getLayoutMetrics')
const fullH = Math.min(Math.ceil((first.cssContentSize ?? first.contentSize).height), 6000)
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w),
  height: fullH,
  deviceScaleFactor: Number(dpr),
  mobile: true,
})
await sleep(450)

const metrics = await send('Page.getLayoutMetrics')
const size = metrics.cssContentSize ?? metrics.contentSize
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  fromSurface: true,
  clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
})
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`${out} ${Math.ceil(size.width)}x${Math.ceil(size.height)}`)

ws.close()
chrome.kill()
