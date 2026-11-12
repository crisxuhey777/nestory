import { seedSession } from './_login_session.mjs'
// Profile / About regression: edit baby, remove family member, back navigation.
// usage: node _e2e_profile.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9800 + Math.floor(Math.random() * 150)
const profile = mkdtempSync(join(tmpdir(), 'nestory-profile-'))

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
    } catch {
      /* not up */
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function goto(url) {
  await send('Page.navigate', { url })
  await sleep(700)
  try {
    await evaluate('document.fonts.ready')
  } catch {
    /* ignore */
  }
  await sleep(250)
}
const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const clickText = (text, selector = 'button') =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`)
const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`)
const setValue = (selector, value) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`)
const back = () => evaluate(`(() => { const b = document.querySelector('.screen-head .icon-btn'); if (!b) return false; b.click(); return true })()`)
const clickSel = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)

// ---------- profile: edit baby ----------
await goto(BASE + '/#/home')
await evaluate('localStorage.clear()')
await goto(BASE + '/#/profile')
check('我的家庭显示宝宝昵称', (await text('.profile-hero__name')) === '小柚', await text('.profile-hero__name'))
check('资料行显示出生信息', (await text('.profile-hint')).includes('杭州'), await text('.profile-hint'))

await clickSel('.profile-hero__edit')
await sleep(400)
check('打开宝宝资料编辑', (await text('.sheet__title')).includes('编辑宝宝资料'), await text('.sheet__title'))

await setValue('.baby-form .input', '小柚子')
await clickText('男孩', '.baby-form button')
await sleep(120)
await clickText('保存资料')
await sleep(500)
check('保存后昵称更新', (await text('.profile-hero__name')) === '小柚子', await text('.profile-hero__name'))
check('保存后性别更新', (await text('.profile-hint')).includes('男孩'), await text('.profile-hint'))
const savedToast = await text('.toast')
check('保存资料有反馈', savedToast.includes('已更新'), savedToast)

await goto(BASE + '/#/profile')
check('刷新后资料仍在', (await text('.profile-hero__name')) === '小柚子', await text('.profile-hero__name'))

// ---------- profile: remove family member ----------
const before = await evaluate(`document.querySelectorAll('.family__avatar').length`)
await clickText('妈妈', '.family__item')
await sleep(400)
check('点开家庭成员详情', (await text('.sheet__title')) === '妈妈', await text('.sheet__title'))
await clickText('移出家庭', '.sheet .btn')
await sleep(400)
check('移出前二次确认', (await text('.sheet__title')).includes('将 妈妈 移出家庭'), await text('.sheet__title'))
await clickText('确认移出', '.sheet .btn')
await sleep(600)
const after = await evaluate(`document.querySelectorAll('.family__avatar').length`)
check('成员数量减少', after === before - 1, `${before} → ${after}`)
check('被移出的成员不再出现', !(await text('.family')).includes('妈妈'), await text('.family'))
const removeToast = await text('.toast')
check('移出后提示', removeToast.includes('已移出家庭'), removeToast)

await goto(BASE + '/#/profile')
const afterReload = await evaluate(`document.querySelectorAll('.family__avatar').length`)
check('刷新后成员状态保留', afterReload === after, String(afterReload))

// ---------- navigation ----------
await goto(BASE + '/#/reminders')
await back()
await sleep(400)
check('提醒中心返回我的家庭', (await evaluate('location.hash')) === '#/profile', await evaluate('location.hash'))

await goto(BASE + '/#/about')
await back()
await sleep(400)
check('关于页返回我的家庭', (await evaluate('location.hash')) === '#/profile', await evaluate('location.hash'))

await goto(BASE + '/#/about')
const aboutText = await text('.page__body')
check('关于页不再展示设计规范', !/Colour|Typography|Logo|图标|色板/i.test(aboutText), aboutText.slice(0, 40))
check('关于页包含品牌故事', aboutText.includes('Nest + Story') && aboutText.includes('凌晨三点'), '')
await clickText('回到我的家庭', '.btn')
await sleep(400)
check('关于页底部按钮返回', (await evaluate('location.hash')) === '#/profile', await evaluate('location.hash'))

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-profile.png', Buffer.from(shot.data, 'base64')),
)

// leave demo data untouched for the next run / screenshots
await evaluate('localStorage.clear()')
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
