// Screenshot a UI overlay: open a route, click an element by text, capture the viewport.
// usage: node _ui_shot.mjs <url> <out.png> "<click text>" [waitMs] [width] [height]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const [url, out, click, wait = '650', w = '430', h = '900'] = process.argv.slice(2)
const port = 9200 + Math.floor(Math.random() * 400)
const profile = mkdtempSync(join(tmpdir(), 'nestory-ui-'))

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
await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url })
await sleep(800)
await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true }).catch(() => {})

if (click && click !== '-') {
  for (const step of click.split(';;')) {
    const bySelector = step.startsWith('sel:')
    const ok = await send('Runtime.evaluate', {
      expression: bySelector
        ? `(() => {
            const el = document.querySelector(${JSON.stringify(step.slice(4))})
            if (!el) return false
            el.click()
            return true
          })()`
        : `(() => {
        const t = ${JSON.stringify(step)}
        const el = [...document.querySelectorAll('button, .quick__item, .album-card, .anniversary, .story__item')]
          .find((b) => b.textContent.replace(/\\s+/g, ' ').trim().includes(t))
        if (!el) return false
        el.click()
        return true
      })()`,
      returnByValue: true,
    })
    if (!ok.result.value) console.error('click target not found:', step)
    await sleep(350)
  }
  await sleep(Number(wait))
}

const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(out)

ws.close()
chrome.kill()
