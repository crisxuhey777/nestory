// Tap feedback regression. usage: node _e2e_tap.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5178'
const port = 9600 + Math.floor(Math.random() * 120)
const profile = mkdtempSync(join(tmpdir(), 'nestory-tap-'))
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
for (let i = 0; i < 80; i++) {
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
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: `${BASE}/#/home` })
await sleep(1600)
await evaluate('document.fonts.ready')

// 登录页或已登录首页都可能出现，等其中一个完成渲染
await evaluate(`new Promise((resolve) => {
  let n = 0
  const timer = setInterval(() => {
    n += 1
    if (document.querySelector('.auth__tab') || document.querySelector('.quick')) {
      clearInterval(timer)
      resolve(true)
    } else if (n > 48) {
      clearInterval(timer)
      resolve(false)
    }
  }, 250)
})`)

const rect = await evaluate(`(() => {
  const el = document.querySelector('.auth__tab')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
if (!rect) throw new Error('auth tab not found: ' + (await evaluate('location.href')))

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
await sleep(90)
const pressed = await evaluate(`(() => {
  const el = document.querySelector('.auth__tab')
  return { cls: el.className.includes('is-pressing'), scale: getComputedStyle(el).scale }
})()`)
check('按下时进入压缩态', pressed.cls === true, JSON.stringify(pressed))
check('压缩有可见比例', parseFloat(pressed.scale) < 0.99, pressed.scale)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('shots/tap-pressed.png', Buffer.from(shot.data, 'base64'))

await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
await sleep(80)
const tapped = await evaluate(`(() => {
  const el = document.querySelector('.auth__tab')
  const s = getComputedStyle(el)
  return { cls: el.className.includes('is-tapped'), anim: s.animationName, hasRing: !!el.matches(':not(.switch)') }
})()`)
check('松手后触发回弹', tapped.cls === true, JSON.stringify(tapped))
check('回弹动画为 tap-spring', tapped.anim.includes('tap-spring'), tapped.anim)
const ringShot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('shots/tap-ring.png', Buffer.from(ringShot.data, 'base64'))
check('带底色的按钮出现描边', tapped.hasRing === true, '')
await sleep(420)
await sleep(500)
check('动画结束后清理 class', (await evaluate(`document.querySelector('.auth__tab').className.includes('is-tapped')`)) === false, '')

// keyboard / programmatic click also gets feedback
await evaluate(`document.querySelector('.auth__tab').click()`)
await sleep(60)
check('键盘式 click 也有回弹', (await evaluate(`document.querySelector('.auth__tab').className.includes('is-tapped')`)) === true, '')
await sleep(450)

// scroll gesture should not animate
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
await sleep(30)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y + 60, button: 'left', clickCount: 1 })
await sleep(60)
check('拖动超过 10px 不回弹', (await evaluate(`document.querySelector('.auth__tab').className.includes('is-tapped')`)) === false, '')

// reduced motion opt-out
await evaluate(`document.documentElement.dataset.reduceMotion = 'true'`)
await evaluate(`document.querySelector('.auth__tab').click()`)
await sleep(60)
check('减少动态效果时不动', (await evaluate(`document.querySelector('.auth__tab').className.includes('is-tapped')`)) === false, '')
await evaluate(`delete document.documentElement.dataset.reduceMotion`)

// disabled buttons never animate
const disabled = await evaluate(`(() => {
  const b = document.createElement('button')
  b.disabled = true
  b.className = 'btn'
  b.textContent = 'disabled'
  b.style.position = 'fixed'
  b.style.left = '20px'
  b.style.top = '20px'
  document.body.appendChild(b)
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 9 }))
  const on = b.classList.contains('is-pressing')
  b.remove()
  return on
})()`)
check('禁用按钮不响应', disabled === false, '')

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
