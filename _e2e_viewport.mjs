import { seedSession } from './_login_session.mjs'
// 验证不同手机高度下，四个快捷圆钮都在 TabBar 之上完整可见。
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5178'
const port = 9600 + Math.floor(Math.random() * 150)
const profile = mkdtempSync(join(tmpdir(), 'nestory-viewport-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
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
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await seedSession(send, BASE)

const SIZES = [
  [320, 568, 'iPhone SE 一代'],
  [360, 640, 'Android 小屏'],
  [375, 667, 'iPhone 8'],
  [390, 844, 'iPhone 13'],
  [430, 932, 'iPhone Pro Max'],
]

for (const [width, height, name] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  })
  await send('Page.navigate', { url: `${BASE}/?vp=${width}x${height}-${Date.now()}#/home` })
  await sleep(1500)
  const probe = await evaluate(`(() => {
    const strip = document.querySelector('.quick-strip')
    const bar = document.querySelector('.tabbar')
    const cta = document.querySelector('.quick-strip__cta')
    const items = [...document.querySelectorAll('.quick__item')]
    if (!strip || !bar || !cta) return { missing: true }
    const s = strip.getBoundingClientRect()
    const t = bar.getBoundingClientRect()
    const c = cta.getBoundingClientRect()
    return {
      count: items.length,
      top: Math.round(s.top),
      bottom: Math.round(s.bottom),
      ctaBottom: Math.round(c.bottom),
      tabTop: Math.round(t.top),
      clear: s.bottom <= t.top,
      ctaClear: c.bottom <= t.top,
      insideWidth: s.left >= 0 && s.right <= window.innerWidth,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }
  })()`)
  const label = `${name} ${width}×${height}`
  check(`${label} 四个圆钮完整在 TabBar 之上`, probe.count === 4 && probe.clear, JSON.stringify(probe))
  check(`${label} 记录喂养按钮完整在 TabBar 之上`, probe.ctaClear === true, JSON.stringify({ ctaBottom: probe.ctaBottom, tabTop: probe.tabTop }))
  check(`${label} 无横向溢出`, !probe.overflowX && probe.insideWidth, String(probe.overflowX))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
