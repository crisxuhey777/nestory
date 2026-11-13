import { seedSession } from './_login_session.mjs'
// Bottom-sheet drag-to-dismiss regression.
// usage: node _e2e_sheet.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 10090 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-sheet-'))

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
    } catch {}
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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
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

async function goto(hash) {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}${hash}` })
  await sleep(1900)
}

async function openSleep() {
  await evaluate(`document.querySelectorAll('.quick__item')[1].click()`)
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`!!document.querySelector('.sheet')`)) {
      await sleep(450)
      return
    }
    await sleep(100)
  }
  throw new Error('sheet did not open')
}

async function headPoint() {
  return evaluate(`(() => {
    const r = document.querySelector('.sheet__head').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 16 }
  })()`)
}

async function touch(type, x, y) {
  await send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  })
}

async function drag(from, dy, steps = 7) {
  await touch('touchStart', from.x, from.y)
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', from.x, from.y + (dy * i) / steps)
    await sleep(24)
  }
  await touch('touchEnd', from.x, from.y + dy)
}

async function sheetBottom() {
  return evaluate(`(() => {
    const el = document.querySelector('.sheet')
    return el ? Math.round(el.getBoundingClientRect().bottom) : null
  })()`)
}

try {
  await goto('/#/home')
  await openSleep()
  check('睡眠抽屉已打开', (await sheetBottom()) === 900, String(await sheetBottom()))

  const head = await headPoint()
  await touch('touchStart', head.x, head.y)
  await sleep(40)
  await touch('touchMove', head.x, head.y + 90)
  await sleep(60)
  const mid = await sheetBottom()
  check('下拉时抽屉跟随手指', (mid ?? 0) > 940, String(mid))
  const dragShot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/sheet-drag.png', Buffer.from(dragShot.data, 'base64'))
  await touch('touchMove', head.x, head.y + 170)
  await sleep(30)
  await touch('touchEnd', head.x, head.y + 170)
  await sleep(380)
  check('下拉超过阈值关闭抽屉', (await evaluate(`!!document.querySelector('.sheet')`)) === false, '')

  await openSleep()
  const head2 = await headPoint()
  await drag(head2, 46)
  await sleep(380)
  check('小幅下拉不关闭', (await evaluate(`!!document.querySelector('.sheet')`)) === true, '')
  check('小幅下拉回弹到底', (await sheetBottom()) === 900, String(await sheetBottom()))

  const body = await evaluate(`(() => {
    const r = document.querySelector('.sheet__body').getBoundingClientRect()
    return { x: r.left + 30, y: r.top + 18 }
  })()`)
  await drag(body, 150)
  await sleep(380)
  check('从表单区域下拉不会误关', (await evaluate(`!!document.querySelector('.sheet')`)) === true, '')

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  check('Esc 仍可关闭', (await evaluate(`!!document.querySelector('.sheet')`)) === false, '')

  const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
  check('页面无脚本错误', errors === 0, String(errors))
} finally {
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  ws.close()
  chrome.kill()
  process.exitCode = failed ? 1 : 0
}
