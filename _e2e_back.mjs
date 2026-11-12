import { seedSession } from './_login_session.mjs'
// Back-navigation transition regression.
// usage: node _e2e_back.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9750 + Math.floor(Math.random() * 120)
const profile = mkdtempSync(join(tmpdir(), 'nestory-back-'))
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'], { stdio: 'ignore' })
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
await seedSession(send, BASE)
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
async function goto(hash) {
  await send('Page.navigate', { url: `${BASE}/#/${hash}` })
  await sleep(800)
  await evaluate('document.fonts.ready')
  await sleep(250)
}
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

await goto('settings')
check('设置页已渲染', (await evaluate(`!!document.querySelector('.screen-head')`)) === true, '')
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(60)
const mid = await evaluate(`(() => {
  const v = document.querySelector('.route-view')
  const s = getComputedStyle(v)
  const tab = document.querySelector('.tabbar')?.getBoundingClientRect()
  return {
    hash: location.hash,
    backClass: v.className.includes('route-view--back'),
    animation: s.animationName,
    opacity: s.opacity,
    transform: s.transform,
    tabTop: tab?.top,
    tabBottom: tab?.bottom,
    vh: innerHeight,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }
})()`)
check('返回标记为 back 视图', mid.backClass === true, JSON.stringify(mid))
check('播放 route-back 动画', mid.animation === 'route-back', mid.animation)
check('动画中页面有位移', mid.transform !== 'none' && mid.opacity < 1, `${mid.transform} / ${mid.opacity}`)
check('返回后到我的家庭', mid.hash === '#/profile', mid.hash)
check('TabBar 保持贴底', mid.tabBottom <= mid.vh + 1 && mid.tabTop > mid.vh - 160, `${mid.tabTop}-${mid.tabBottom}/${mid.vh}`)
check('过渡期间无横向溢出', mid.overflow <= 0, String(mid.overflow))
await sleep(360)
const end = await evaluate(`(() => {
  const v = document.querySelector('.route-view')
  const s = getComputedStyle(v)
  return { opacity: s.opacity, transform: s.transform }
})()`)
check('动画结束后归位', end.opacity === '1' && end.transform === 'none', JSON.stringify(end))

// 关于页底部「回到我的家庭」也走同一返回动效
await goto('about')
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('回到我的家庭')).click()`)
await sleep(55)
const aboutBack = await evaluate(`(() => {
  const v = document.querySelector('.route-view')
  return { hash: location.hash, backClass: v.className.includes('route-view--back'), animation: getComputedStyle(v).animationName }
})()`)
check('关于页按钮返回也有动效', aboutBack.hash === '#/profile' && aboutBack.backClass && aboutBack.animation === 'route-back', JSON.stringify(aboutBack))
await sleep(360)

// 减少动态效果时不播放
await goto('settings')
await evaluate(`document.documentElement.dataset.reduceMotion = 'true'`)
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(50)
const reduced = await evaluate(`(() => {
  const v = document.querySelector('.route-view')
  return { hash: location.hash, animation: getComputedStyle(v).animationName, backClass: v.className.includes('route-view--back') }
})()`)
check('减少动态效果时不动', reduced.hash === '#/profile' && reduced.animation === 'none', JSON.stringify(reduced))
await evaluate(`delete document.documentElement.dataset.reduceMotion`)

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

await goto('settings')
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(70)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('shots/back-transition.png', Buffer.from(shot.data, 'base64'))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
