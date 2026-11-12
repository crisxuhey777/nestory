// Auth flow screenshots: login page, register page, signed-in home and profile.
// usage: node _shot_auth.mjs
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://127.0.0.1:5178'
const port = 9800 + Math.floor(Math.random() * 150)
const profile = mkdtempSync(join(tmpdir(), 'nestory-auth-'))

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
const logs = []
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description ?? ''))
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
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

async function shot(out) {
  await evaluate('window.scrollTo(0, document.body.scrollHeight)')
  await sleep(600)
  await evaluate('window.scrollTo(0, 0)')
  await sleep(300)
  const metrics = await send('Page.getLayoutMetrics')
  const size = metrics.cssContentSize ?? metrics.contentSize
  const height = Math.min(Math.ceil(size.height), 6000)
  const img = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
    clip: { x: 0, y: 0, width: Math.ceil(size.width), height, scale: 1 },
  })
  writeFileSync(out, Buffer.from(img.data, 'base64'))
  console.log(`${out} ${Math.ceil(size.width)}x${height}`)
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

  await send('Page.navigate', { url: `${BASE}/#/home` })
  await sleep(1200)
  if (!(await waitFor('!!document.querySelector(".auth")'))) throw new Error('auth screen did not render')
  await sleep(500)
  await shot('shots/auth-login.png')

  // switch to the register tab
  await evaluate(`[...document.querySelectorAll('.auth__tab')].find(b => b.textContent.trim() === '注册')?.click()`)
  await sleep(500)
  await shot('shots/auth-register.png')

  // back to login and sign in with the demo account
  await evaluate(`[...document.querySelectorAll('.auth__tab')].find(b => b.textContent.trim() === '登录')?.click()`)
  await sleep(400)
  await evaluate(`
    (() => {
      const set = (el, value) => {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        desc.set.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const inputs = document.querySelectorAll('.auth input')
      set(inputs[0], 'demo@nestory.local')
      set(inputs[1], 'nestory123')
      document.querySelector('.auth form').requestSubmit()
    })()
  `)
  const signedIn = await waitFor('!document.querySelector(".auth") && !!document.querySelector(".app")', 25000)
  console.log('signed in:', signedIn)
  await sleep(1800)
  await shot('shots/auth-home.png')

  const name = await evaluate('document.querySelector(".profile-hero__name")?.textContent || document.body.innerText.slice(0, 80)')
  console.log('home name:', name)

  await evaluate(`location.hash = '#/profile'`)
  await sleep(1200)
  if (await waitFor('!!document.querySelector(".profile-hero")', 10000)) {
    await shot('shots/auth-profile.png')
  }
  console.log('console errors:', logs.length ? logs.join(' | ') : 'none')
  console.log('cookies:', await evaluate('document.cookie'))
} finally {
  ws.close()
  chrome.kill()
}
