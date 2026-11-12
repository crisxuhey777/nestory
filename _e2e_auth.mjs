// End-to-end auth check: register in the UI, reload to keep the session, then sign out.
// usage: node _e2e_auth.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5178'
const port = 9900 + Math.floor(Math.random() * 90)
const profile = mkdtempSync(join(tmpdir(), 'nestory-auth-e2e-'))
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
const errors = []
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text)
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
  results.push([name, ok, extra])
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
})()`

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `${BASE}/#/home` })
  await sleep(1200)
  check('登录页出现', await waitFor('!!document.querySelector(".auth")'))

  await evaluate(`[...document.querySelectorAll('.auth__tab')].find(b => b.textContent.trim() === '注册')?.click()`)
  await sleep(400)
  const email = `e2e${Date.now()}@nestory.local`
  await evaluate(setInput('.auth input[type=email]', email))
  await evaluate(setInput('.auth input[type=password]', 'nestory123'))
  await evaluate(setInput('.auth input[autocomplete=nickname]', 'E2E 妈妈'))
  await sleep(200)
  await evaluate(`document.querySelector('.auth form').requestSubmit()`)
  const onboarding = await waitFor('!!document.querySelector(".onboarding__welcome")', 25000)
  check('注册后进入新手引导', onboarding)
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('跳过引导')).click()`)
  const registered = await waitFor('!document.querySelector(".auth") && !!document.querySelector(".hero__name")', 25000)
  const hero = registered ? await evaluate('document.querySelector(".hero__name").textContent') : ''
  check('跳过引导后进入首页', registered, `宝宝=${hero}`)

  await send('Page.reload')
  await sleep(1500)
  const stayed = await waitFor('!document.querySelector(".auth") && !!document.querySelector(".hero__name")', 15000)
  check('刷新后仍保持登录', stayed)

  await evaluate(`[...document.querySelectorAll('.tabbar button')].find((b) => b.textContent.includes('我的'))?.click()`)
  await sleep(800)
  await waitFor('!!document.querySelector(".profile-hero")')
  const account = await evaluate(`[...document.querySelectorAll('.switch-row__sub')].map((el) => el.textContent).join('|')`)
  check('账号面板显示邮箱', account.includes(email), account)
  if (!account.includes(email)) {
    console.log('DBG hash', await evaluate('location.href'))
    console.log('DBG body', (await evaluate('document.body.innerText')).slice(0, 300))
  }

  await evaluate(`[...document.querySelectorAll('.section-head__action')].find(b => b.textContent.trim() === '退出登录')?.click()`)
  const signedOut = await waitFor('!!document.querySelector(".auth")', 15000)
  check('退出回到登录页', signedOut)

  await evaluate(`location.hash = '#/home'`)
  await sleep(300)
  await evaluate(setInput('.auth input[type=email]', email))
  await evaluate(setInput('.auth input[type=password]', 'nestory123'))
  await evaluate(`document.querySelector('.auth form').requestSubmit()`)
  const again = await waitFor('!document.querySelector(".auth") && !!document.querySelector(".hero__name")', 25000)
  check('再次登录成功', again)
  check('无未捕获异常', errors.length === 0, errors.join(' | '))
} finally {
  const failed = results.filter(([, ok]) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} auth checks passed`)
  ws.close()
  chrome.kill()
}
