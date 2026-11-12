// 首页每日一句截图：普通一天 + 特殊日子（sessionStorage 注入）
// usage: node _shot_quote.mjs <baseUrl>
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const base = process.argv[2] || 'http://127.0.0.1:5178/'
const port = 9900 + Math.floor(Math.random() * 100)
const profile = mkdtempSync(join(tmpdir(), 'nestory-quote-'))

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

const waitTextChange = async (tries = 80) => {
  const fallback = '不着急，我们有一整个童年，慢慢来。'
  for (let i = 0; i < tries; i++) {
    const text = await evaluate("document.querySelector('.hero__quote-text')?.textContent || ''")
    if (text && text !== fallback) return text
    await sleep(300)
  }
  return await evaluate("document.querySelector('.hero__quote-text')?.textContent || ''")
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 430,
  height: 932,
  deviceScaleFactor: 2,
  mobile: true,
})

await send('Page.navigate', { url: base })
await sleep(1800)
await evaluate('document.fonts.ready', true).catch(() => {})

const text = await waitTextChange()
console.log('quote:', text)
console.log('occasion (normal):', await evaluate("document.querySelector('.hero__occasion')?.textContent || null"))
await shot('home-quote')

// 用一个「满 100 天」的演示宝宝请求真实接口，再把返回写进缓存，检验特殊日子排版
const demo = await evaluate(
  `(async () => {
    const state = (await (await fetch('/api/state')).json()).state
    const born = new Date(Date.now() - 100 * 86400000)
    const iso = born.toISOString().slice(0, 10)
    const baby = { ...state.baby, id: 'b_demo_100', name: '小满', birthday: iso }
    const res = await fetch('/api/daily-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { ...state, baby } }),
    })
    return { babyId: state.baby.name + ':' + state.baby.birthday, payload: await res.json() }
  })()`,
  true,
)
const babyId = demo.babyId
const payload = demo.payload
console.log('babyId:', babyId, 'demo payload:', payload.quote)
const cached = JSON.stringify({
  date: payload.date,
  text: payload.quote.text,
  label: payload.quote.label,
})
await evaluate(`sessionStorage.setItem(${JSON.stringify(`nestory.dailyQuote.v1:${babyId}`)}, ${JSON.stringify(cached)})`)
console.log('babyId:', babyId, 'demo.date:', payload.date)
console.log('cache before reload:', await evaluate("sessionStorage.getItem('nestory.dailyQuote.v1:" + babyId + "')"))
await send('Page.reload', { ignoreCache: false })
await sleep(2600)
console.log('cache after reload:', await evaluate("sessionStorage.getItem('nestory.dailyQuote.v1:" + babyId + "')"))
console.log('quote text:', await evaluate("document.querySelector('.hero__quote-text')?.textContent"))
console.log('occasion (injected):', await evaluate("document.querySelector('.hero__occasion')?.textContent || null"))
await shot('home-quote-occasion')

console.log('console errors:', consoleErrors.slice(0, 5))
ws.close()
chrome.kill()
