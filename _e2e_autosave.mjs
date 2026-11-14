// Autosave check: change the reminder interval in the UI, then read it back from MySQL.
// usage: node _e2e_autosave.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5178'
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
  if (!(await waitFor('!!document.querySelector(".auth")', 20000))) {
    throw new Error('登录页未出现')
  }
  const set = (sel, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) throw new Error('找不到输入框: ' + ${JSON.stringify(sel)})
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

  // 断网时改动不丢：保存失败要留下痕迹，恢复网络后自动补发。
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await sleep(300)
  await evaluate(`[...document.querySelectorAll('.interval-picker button')].find(b => b.textContent.startsWith('4'))?.click()`)
  await sleep(2600)
  const pendingMark = await evaluate(`localStorage.getItem('nestory.unsaved') || ''`)
  check('断网保存失败被记住', pendingMark.length > 0, pendingMark)
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  let recovered = false
  for (let i = 0; i < 50; i++) {
    const v = await evaluate(`fetch('/api/state').then(r => r.json()).then(d => d.state.reminder.intervalMinutes)`, true)
    if (v === 240) {
      recovered = true
      break
    }
    await sleep(500)
  }
  check('恢复网络后自动补发', recovered)
  const clearedMark = await evaluate(`localStorage.getItem('nestory.unsaved') || ''`)
  check('补发成功后清掉失败标记', clearedMark === '', clearedMark)

  // 还原成 3 小时，别把演示数据改坏
  await evaluate(`[...document.querySelectorAll('.interval-picker button')].find(b => b.textContent.startsWith('3'))?.click()`)
  await sleep(1500)
} finally {
  const failed = results.filter(([, ok]) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} autosave checks passed`)
  ws.close()
  chrome.kill()
}
