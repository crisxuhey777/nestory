// 成长页 / 相册页 AI 面板截图：idle → thinking → result
// usage: node _shot_insights.mjs <baseUrl>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const base = process.argv[2] || 'http://127.0.0.1:5178/'
const port = 9800 + Math.floor(Math.random() * 100)
const profile = mkdtempSync(join(tmpdir(), 'nestory-panel-'))

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
const consoleErrors = []
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
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

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'))
}

const waitFor = async (selector, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true
    await sleep(300)
  }
  return false
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 430,
  height: 900,
  deviceScaleFactor: 2,
  mobile: true,
})
await send('Page.navigate', { url: base })
await sleep(1800)
await evaluate('document.fonts.ready', true).catch(() => {})

// ---- 成长页
await evaluate("location.hash = '#growth'")
await waitFor('.ai-panel__cta', 80)
await evaluate("document.querySelector('.ai-panel').scrollIntoView({ block: 'center' })")
await sleep(600)
await shot('growth-ai-idle')

await evaluate("document.querySelector('.ai-panel__cta').click()")
await sleep(900)
await shot('growth-ai-thinking')
console.log('growth busy:', await evaluate("!!document.querySelector('.ai-panel--busy')"))

let ok = await waitFor('.ai-panel__result', 300)
console.log('growth done:', ok)
if (ok) {
  console.log('headline:', await evaluate("document.querySelector('.ai-panel__title')?.textContent"))
  console.log('points:', await evaluate("document.querySelectorAll('.ai-point').length"))
  console.log('tips:', await evaluate("document.querySelectorAll('.ai-tip').length"))
  await evaluate("document.querySelector('.ai-panel').scrollIntoView({ block: 'center' })")
  await sleep(400)
  await shot('growth-ai-result')
}

// ---- 相册页
await evaluate("location.hash = '#album'")
await waitFor('.ai-panel__cta', 80)
await evaluate("document.querySelector('.ai-panel').scrollIntoView({ block: 'center' })")
await sleep(600)
await shot('album-ai-idle')

await evaluate("document.querySelector('.ai-panel__cta').click()")
await sleep(900)
await shot('album-ai-thinking')
ok = await waitFor('.ai-panel__result', 300)
console.log('album done:', ok)
if (ok) {
  console.log('story title:', await evaluate("document.querySelector('.ai-story__title')?.textContent"))
  console.log('story body:', await evaluate("document.querySelector('.ai-story__body')?.textContent"))
  await evaluate("document.querySelector('.ai-panel').scrollIntoView({ block: 'center' })")
  await sleep(400)
  await shot('album-ai-result')
}

console.log('console errors:', consoleErrors.slice(0, 5))
ws.close()
chrome.kill()
