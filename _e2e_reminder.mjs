import { seedSession } from './_login_session.mjs'
// Reminder / PWA regression: manifest, service worker, due notification, test notification.
// usage: node _e2e_reminder.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const ORIGIN = new URL(BASE).origin
const port = 9700 + Math.floor(Math.random() * 120)
const profile = mkdtempSync(join(tmpdir(), 'nestory-reminder-'))
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
const cookie = await seedSession(send, BASE)
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })
try {
  await send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['notifications'] })
} catch (error) {
  console.log(`! 无法直接授权通知：${error.message}`)
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function goto(url) {
  await send('Page.navigate', { url })
  await sleep(700)
  for (let i = 0; i < 40; i += 1) {
    try {
      if (await evaluate(`!!document.querySelector('.app')`)) break
    } catch {
      /* still booting */
    }
    await sleep(150)
  }
  try {
    await evaluate('document.fonts.ready')
  } catch {
    /* ignore */
  }
  await sleep(250)
}
async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression)
      if (value) return value
    } catch {
      /* retry */
    }
    await sleep(200)
  }
  return null
}
const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`)
const clickText = (label, selector = 'button') =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(label)}))
    if (!el) return false
    el.click()
    return true
  })()`)

// ---------- manifest + service worker ----------
await goto(BASE + '/?sw=1#/reminders')

check('页面声明了 manifest', (await evaluate(`document.querySelector('link[rel=manifest]')?.getAttribute('href')`)) === '/manifest.webmanifest')
check('主题色与安静底色调一致', (await evaluate(`document.querySelector('meta[name=theme-color]')?.content`)) === '#304B3B')
check('通知权限已授予', (await evaluate(`typeof Notification !== 'undefined' && Notification.permission`)) === 'granted', await evaluate(`typeof Notification === 'undefined' ? 'unsupported' : Notification.permission`))

const swScope = await waitFor(`navigator.serviceWorker.getRegistration().then((r) => r && r.scope)`, 6000)
check('Service Worker 已注册并接管根作用域', typeof swScope === 'string' && swScope.endsWith('/'), String(swScope))
const swActive = await waitFor(`navigator.serviceWorker.ready.then((r) => !!r.active)`, 6000)
check('Service Worker 已激活', swActive === true)

check('提醒中心标题', (await text('.screen-head__title')) === '提醒中心', await text('.screen-head__title'))
check('系统通知一栏显示已开启', (await text('.page__body')).includes('系统通知'), '')
check('有「发送测试通知」按钮', await clickText('发送测试通知'), '')
await sleep(500)
const testPing = await evaluate(`window.__nestoryLastNotification || null`)
check('测试通知已发出', !!testPing && testPing.body.includes('测试提醒'), JSON.stringify(testPing))
check('测试通知有提示', (await text('.toast')).includes('测试通知已发送'), await text('.toast'))

// ---------- due reminder (backdated feed) ----------
const stateRes = await fetch(`${ORIGIN}/api/state`, { headers: { Cookie: `nestory_session=${cookie}` } })
if (!stateRes.ok) throw new Error(`GET /api/state failed: HTTP ${stateRes.status}`)
const state = (await stateRes.json()).state
const startedAt = Date.now() - 5 * 3600_000
state.feeds = [
  {
    id: 'e2e_reminder_feed',
    startedAt,
    endedAt: startedAt + 12 * 60_000,
    leftSec: 600,
    rightSec: 540,
    bottleMl: 0,
    formulaMl: 0,
    author: '妈妈',
    updatedAt: startedAt,
  },
]
state.reminder = { enabled: true, intervalMinutes: 180, quietNight: false, vibration: false }
const saveRes = await fetch(`${ORIGIN}/api/state`, {
  method: 'PUT',
  headers: { Cookie: `nestory_session=${cookie}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ state }),
})
if (!saveRes.ok) throw new Error(`PUT /api/state failed: HTTP ${saveRes.status}`)

await evaluate('localStorage.removeItem("nestory.reminder.fired.v1"); window.__nestoryLastNotification = null')
// 同一 URL 的 Page.navigate 不会重新加载文档，这里必须强制 reload 才能读到新 state。
await send('Page.reload', { ignoreCache: true })
await sleep(600)
for (let i = 0; i < 40; i += 1) {
  try {
    if (await evaluate(`!!document.querySelector('.app')`)) break
  } catch {
    /* still booting */
  }
  await sleep(150)
}
await sleep(250)

const duePing = await waitFor(`window.__nestoryLastNotification && /距上次喂奶已经/.test(window.__nestoryLastNotification.body) ? window.__nestoryLastNotification : null`, 8000)
check('过期提醒自动发出系统通知', !!duePing, JSON.stringify(duePing))
check('通知正文带上次喂奶时长', !!duePing && /距上次喂奶已经/.test(duePing.body), duePing?.body ?? '')
check('提醒页标出「该喂奶了」', (await text('.panel--flat')).includes('该喂奶了'), await text('.panel--flat'))

// 同一段间隔只提醒一次
const fired = await evaluate('localStorage.getItem("nestory.reminder.fired.v1")')
check('提醒去重键已写入', typeof fired === 'string' && fired.includes('e2e_reminder_feed'), String(fired))
await evaluate('window.__nestoryLastNotification = null')
await evaluate('window.__nestoryReminderTick && window.__nestoryReminderTick()')
await sleep(900)
check('同一间隔不会重复打扰', (await evaluate('window.__nestoryLastNotification')) === null)

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-reminder.png', Buffer.from(shot.data, 'base64')),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
