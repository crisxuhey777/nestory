import { seedSession } from './_login_session.mjs'
// Album lightbox checks: swipe, arrows, keyboard, wrap-around.
// usage: node _e2e_lightbox.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 10130 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-lightbox-'))

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

async function click(selector, index = 0) {
  const ok = await evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!ok) throw new Error(`not found: ${selector}[${index}]`)
  await sleep(450)
}

async function counter() {
  return evaluate(`document.querySelector('.lightbox__count')?.textContent.trim() ?? ''`)
}

async function swipe(fromX, toX) {
  const rect = await evaluate(`(() => {
    const r = document.querySelector('.lightbox').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })()`)
  const y = Math.round(rect.y + Math.min(rect.h * 0.22, 130))
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] })
  const steps = 5
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(fromX + ((toX - fromX) * i) / steps), y }],
    })
    await sleep(30)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(500)
}

await send('Page.navigate', { url: `${BASE}/#/album` })
await sleep(2000)

await click('.album-card', 0)
check('lightbox opens with counter', (await counter()) === '2 / 6', await counter())
check('arrows exist', (await evaluate(`document.querySelectorAll('.lightbox__nav').length`)) === 2)

await swipe(340, 80)
check('swipe left goes to next photo', (await counter()) === '3 / 6', await counter())
check('next item is the video', (await evaluate(`!!document.querySelector('.lightbox video[controls]')`)) === true)
check('lightbox stays open after swipe', (await evaluate(`!!document.querySelector('.lightbox')`)) === true)

await click('.lightbox__nav--prev')
check('prev arrow returns to photo', (await counter()) === '2 / 6', await counter())

await swipe(80, 340)
check('swipe right goes back', (await counter()) === '1 / 6', await counter())

await click('.lightbox__nav--next')
check('next arrow works', (await counter()) === '2 / 6', await counter())

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
await sleep(400)
check('keyboard right works', (await counter()) === '3 / 6', await counter())

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(400)
check('escape closes', (await evaluate(`!!document.querySelector('.lightbox')`)) === false)

// wrap-around from the cover
await click('.album-cover')
check('cover opens at 1 / 6', (await counter()) === '1 / 6', await counter())
await swipe(80, 340)
check('swipe right from first wraps to last', (await counter()) === '6 / 6', await counter())

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`)
check('no runtime errors', errors === 0, String(errors))

await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-lightbox.png', Buffer.from(shot.data, 'base64')),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
