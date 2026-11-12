import { seedSession } from './_login_session.mjs'
// Exit confirmation regression: root back asks before leaving; cancel restores
// the guard, detail navigation consumes it, confirm actually leaves.
// usage: node _e2e_exit.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9900 + Math.floor(Math.random() * 90)
const profile = mkdtempSync(join(tmpdir(), 'nestory-exit-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {}
  await sleep(250)
}
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await seedSession(send, BASE)
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
async function goto(hash) {
  await send('Page.navigate', { url: `${BASE}/#/${hash}` })
  await sleep(1100)
  await evaluate('document.fonts.ready')
  await sleep(250)
}
async function clickText(text) {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}))
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!ok) throw new Error(`button not found: ${text}`)
  await sleep(260)
}
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

await goto('home')
check('根层装有退出哨兵', (await evaluate('Boolean(history.state?.nestoryExitGuard)')) === true, JSON.stringify(await evaluate('history.state')))

await evaluate('history.back()')
await sleep(450)
check('返回先弹出确认', (await evaluate(`document.querySelector('.sheet__title')?.textContent ?? ''`)).includes('要离开 Nestory'), await evaluate(`document.querySelector('.sheet__title')?.textContent ?? 'none'`))
check('确认框仍在首页', (await evaluate('location.hash')) === '#/home', await evaluate('location.hash'))

const dialogShot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('shots/exit-confirm.png', Buffer.from(dialogShot.data, 'base64'))

await clickText('继续使用')
check('取消后关闭确认', (await evaluate(`Boolean(document.querySelector('.sheet__title'))`)) === false, '')
check('取消后补回哨兵', (await evaluate('Boolean(history.state?.nestoryExitGuard)')) === true, '')

// 进入二级页：哨兵被真实页面替换，不会额外多一层
await evaluate(`document.querySelector('.overview__cta').click()`)
await sleep(500)
check('进入记录页后哨兵消失', (await evaluate('Boolean(history.state?.nestoryExitGuard)')) === false, '')
check('进入记录页不弹确认', (await evaluate(`Boolean(document.querySelector('.sheet__title'))`)) === false, '')

await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(500)
check('二级返回回到首页', (await evaluate('location.hash')) === '#/home', await evaluate('location.hash'))
check('回到首页重新装哨兵', (await evaluate('Boolean(history.state?.nestoryExitGuard)')) === true, '')
check('二级返回到首页不弹确认', (await evaluate(`Boolean(document.querySelector('.sheet__title'))`)) === false, '')

// 切 Tab 不增加层级，也不弹确认
await evaluate(`(() => {
  const el = [...document.querySelectorAll('.tabbar button')].find((b) => b.textContent.trim() === '成长')
  if (!el) throw new Error('tab not found')
  el.click()
})()`)
await sleep(350)
check('切 Tab 不弹确认', (await evaluate(`Boolean(document.querySelector('.sheet__title'))`)) === false, '')
check('Tab 根层仍有哨兵', (await evaluate('Boolean(history.state?.nestoryExitGuard)')) === true, '')

// 抽屉打开时，返回先关抽屉，而不是退出
await evaluate(`document.querySelector('.tab-head .icon-btn').click()`)
await sleep(420)
check('根层抽屉已打开', (await evaluate(`Boolean(document.querySelector('.sheet-backdrop'))`)) === true, '')
await evaluate('history.back()')
await sleep(420)
check('返回先关闭抽屉', (await evaluate(`Boolean(document.querySelector('.sheet-backdrop'))`)) === false, '')
check('关抽屉不弹退出确认', (await evaluate(`Boolean(document.querySelector('.sheet__title'))`)) === false, '')
check('关抽屉后仍在成长页', (await evaluate('location.hash')) === '#/growth', await evaluate('location.hash'))
check('关抽屉后补回哨兵', (await evaluate('Boolean(history.state?.nestoryExitGuard)')) === true, '')

// 确认退出：真正离开应用
await evaluate('history.back()')
await sleep(450)
check('Tab 根层返回也确认', (await evaluate(`document.querySelector('.sheet__title')?.textContent ?? ''`)).includes('要离开 Nestory'), '')
await clickText('退出应用')
await sleep(900)
const left = await evaluate('location.href').catch(() => 'closed')
check('确认后离开应用', !String(left).startsWith(BASE), String(left))

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
