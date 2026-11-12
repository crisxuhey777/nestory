// Autosave check: change the reminder interval in the UI, then read it back from MySQL.
// usage: node _e2e_autosave.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://127.0.0.1:5178'
const port = 9950 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-save-'))
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
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break
  } catch {
    /* wait */
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
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}
const waitFor = async (expression, ms = 20000) => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await evaluate(expression)) return true
    await sleep(200)
  }
  return false
}
const results = []
const check = (name, ok, extra = '') => {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `${BASE}/#/home` })
  await sleep(1200)
  await waitFor('!!document.querySelector(".auth")')
  const set = (sel, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    d.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`
  await evaluate(set('.auth input[type=email]', 'demo@nestory.local'))
  await evaluate(set('.auth input[type=password]', 'nestory123'))
  await evaluate(`document.querySelector('.auth form').requestSubmit()`)
  check('登录', await waitFor('!!document.querySelector(".hero__name")', 20000))

  await evaluate(`location.hash = '#/reminders'`)
  await sleep(900)
  check('提醒页出现', await waitFor('!!document.querySelector(".interval-picker")', 10000))

  const before = await evaluate(`fetch('/api/state').then(r => r.json()).then(d => d.state.reminder.intervalMinutes)`, true)
  const targetValue = before === 180 ? 210 : 180
  const label = String(targetValue / 60)
  check('间隔可选', await evaluate(`[...document.querySelectorAll('.interval-picker button')].some(b => b.textContent.startsWith('${label}'))`))
  await evaluate(`[...document.querySelectorAll('.interval-picker button')].find(b => b.textContent.startsWith('${label}'))?.click()`)
  await sleep(2000)
  const savedValue = await evaluate(`fetch('/api/state').then(r => r.json()).then(d => d.state.reminder.intervalMinutes)`, true)
  check('自动保存到 MySQL', savedValue === targetValue, `${before} → ${savedValue}`)

  await send('Page.reload')
  await sleep(1500)
  const onText = await evaluate(`document.querySelector('.interval-picker button.on')?.textContent || ''`)
  check('刷新后仍是新值', onText.startsWith(label), onText)

  // 还原成 3 小时，别把演示数据改坏
  await evaluate(`[...document.querySelectorAll('.interval-picker button')].find(b => b.textContent.startsWith('3'))?.click()`)
  await sleep(1500)
} finally {
  const failed = results.filter(([, ok]) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} autosave checks passed`)
  ws.close()
  chrome.kill()
}
