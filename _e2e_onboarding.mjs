// First-run onboarding: blank account → skip path stays empty; guided path fills only what the user typed.
// usage: node _e2e_onboarding.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5178'
const port = 9500 + Math.floor(Math.random() * 90)
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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nestory-onboarding-'))}`,
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
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const waitFor = async (expression, ms = 16000) => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await evaluate(expression)) return true
    await sleep(180)
  }
  return false
}
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const clickText = async (text) => {
  const found = await waitFor(`(() => {
    return [...document.querySelectorAll('button')].some((b) => b.textContent.trim().includes(${JSON.stringify(text)}))
  })()`, 8000)
  if (!found) throw new Error(`button not found: ${text}`)
  await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}))
    el.click()
    return true
  })()`)
  await sleep(320)
}
const setInput = async (selector, value) => {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) throw new Error('missing ' + ${JSON.stringify(selector)})
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(120)
}
const register = async (nickname) => {
  const email = `onboard.${Date.now()}.${Math.floor(Math.random() * 999)}@example.com`
  const res = await fetch('http://127.0.0.1:8000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'nestory1234', nickname }),
  })
  if (!res.ok) throw new Error(`register failed HTTP ${res.status}`)
  const cookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie')
  const value = cookie.split(';')[0].slice('nestory_session='.length)
  await send('Network.enable')
  await send('Network.clearBrowserCookies')
  await send('Network.setCookie', {
    name: 'nestory_session',
    value,
    url: BASE,
    path: '/',
    httpOnly: true,
  })
  return value
}
const goto = async (hash) => {
  await send('Page.navigate', { url: `${BASE}/?e2e=${Date.now()}${hash}` })
  await sleep(1300)
  await waitFor('!!document.querySelector(".page, .onboarding")')
}
const stateOf = async (cookie) => {
  const res = await fetch('http://127.0.0.1:8000/api/state', { headers: { Cookie: `nestory_session=${cookie}` } })
  return (await res.json()).state
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

  // ---------- A. skip path must stay empty ----------
  const skipCookie = await register('跳过测试')
  await goto('#/home')
  const welcomeReady = await waitFor('!!document.querySelector(".onboarding__welcome")')
  if (!welcomeReady) {
    console.log('DBG url', await evaluate('location.href'))
    console.log('DBG body', (await evaluate('document.body.innerText')).slice(0, 400))
  }
  check('新账号先进入引导', welcomeReady)
  check('引导页没有 TabBar', (await evaluate('!!document.querySelector(".tabbar")')) === false)
  const shotWelcome = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/onboarding-welcome.png', Buffer.from(shotWelcome.data, 'base64'))

  await clickText('跳过引导，直接使用')
  await waitFor('!!document.querySelector(".quick")')
  check('跳过后来到首页', (await evaluate('!!document.querySelector(".quick")')) === true)
  check('跳过没有宝宝昵称', (await evaluate(`document.querySelector('.hero__name')?.textContent.trim()`)) === '宝宝')
  check('跳过没有照片', (await evaluate(`document.querySelectorAll('.strip__item').length`)) === 0)
  check('跳过没有里程碑', (await evaluate(`document.querySelectorAll('.story__item').length`)) === 0)
  const skippedState = await stateOf(skipCookie)
  check('后端也是空状态', skippedState.photos.length === 0 && skippedState.feeds.length === 0 && skippedState.baby.name === '', JSON.stringify({ photos: skippedState.photos.length, feeds: skippedState.feeds.length, name: skippedState.baby.name }))

  await goto('#/profile')
  check('空资料落在我的页', (await evaluate(`document.querySelector('.profile-hero__name')?.textContent.trim()`)) === '还没有宝宝资料', await evaluate(`document.querySelector('.profile-hero__name')?.textContent`))
  check(
    '新账号家庭只有自己',
    (await evaluate(`document.querySelectorAll('.family__avatar').length`)) === 1 &&
      (await evaluate(`document.querySelector('.family__name')?.textContent.trim()`)) === '跳过测试',
    `avatars=${await evaluate(`document.querySelectorAll('.family__avatar').length`)} name=${await evaluate(`document.querySelector('.family__name')?.textContent.trim()`)}`,
  )
  const shotProfile = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/onboarding-empty-profile.png', Buffer.from(shotProfile.data, 'base64'))

  await clickText('通用设置')
  await sleep(500)
  const settingsText = await evaluate('document.body.innerText')
  check('普通用户没有恢复示例数据', settingsText.includes('恢复示例数据') === false)
  const shotSettings = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/onboarding-empty-settings.png', Buffer.from(shotSettings.data, 'base64'))

  // ---------- B. guided path fills only user input ----------
  await register('引导测试')
  await goto('#/home')
  check('第二个账号仍然先引导', await waitFor('!!document.querySelector(".onboarding__welcome")'))
  await clickText('开始设置')
  check('宝宝步骤出现', await waitFor(`!!document.querySelector('.onboarding__step')`))
  check('下一步在空表单时禁用', (await evaluate(`[...document.querySelectorAll('.onboarding__actions--step .btn')].find((b) => b.textContent.includes('下一步'))?.disabled`)) === true)
  const shotBaby = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/onboarding-baby.png', Buffer.from(shotBaby.data, 'base64'))

  await setInput('.onboarding__form input[type=text]', '果果')
  await setInput('.onboarding__form input[type=date]', '2026-08-01')
  await clickText('女孩')
  await clickText('下一步')
  check('照片步骤出现', (await evaluate(`document.body.innerText.includes('放进第一张照片')`)) === true)
  const shotPhoto = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/onboarding-photo.png', Buffer.from(shotPhoto.data, 'base64'))
  await clickText('暂时不放照片')
  check('提醒步骤出现', (await evaluate(`document.body.innerText.includes('要不要提醒你')`)) === true)
  const shotReminder = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/onboarding-reminder.png', Buffer.from(shotReminder.data, 'base64'))
  await clickText('每 4 小时')
  await clickText('进入 Nestory')
  await waitFor('!!document.querySelector(".quick")')
  check('完成引导进入首页', (await evaluate(`document.querySelector('.hero__name')?.textContent.trim()`)) === '果果')
  check('生日来自引导输入', (await evaluate(`document.body.innerText.includes('2026.08.01')`)) === true)
  check('没有自动填充照片', (await evaluate(`document.querySelectorAll('.strip__item').length`)) === 0)
  check('没有自动填充喂养', (await evaluate(`document.querySelector('.overview')?.innerText.includes('0')`)) === true)
  const shotHome = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('shots/onboarding-home.png', Buffer.from(shotHome.data, 'base64'))

  await goto('#/home')
  check('刷新后不再进入引导', (await evaluate('!!document.querySelector(".onboarding")')) === false)

  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  ws.close()
  chrome.kill()
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error(error)
  ws.close()
  chrome.kill()
  process.exitCode = 1
}
