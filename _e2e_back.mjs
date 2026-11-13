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

// 底部 Tab 切换不堆历史；硬件返回先回上一级，主界面再按才退出
await send('Page.navigate', { url: 'about:blank' })
await sleep(400)
await goto('home')
const len0 = await evaluate('history.length')
const clickTab = (label) => evaluate(`(() => {
  const el = [...document.querySelectorAll('.tabbar button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))
  if (!el) return false
  el.click()
  return true
})()`)
await clickTab('我的'); await sleep(300)
await clickTab('相册'); await sleep(300)
await clickTab('成长'); await sleep(300)
await clickTab('首页'); await sleep(300)
check('Tab 往返不增加历史记录', (await evaluate('history.length')) === len0, `${len0} → ${await evaluate('history.length')}`)

await clickTab('我的'); await sleep(300)
const drawerBtn = await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('通用设置'))?.click() ?? true`)
await sleep(500)
check('进入设置属于下一级', (await evaluate('location.hash')) === '#/settings', await evaluate('location.hash'))
const lenPush = await evaluate('history.length')
check('下一级只增加一条历史', lenPush === len0 + 1, `${len0} → ${lenPush}`)

// 用系统返回（不是页面按钮）退出到上一级
await evaluate('history.back()')
await sleep(70)
const hw = await evaluate(`(() => {
  const v = document.querySelector('.route-view')
  return { hash: location.hash, back: v?.className.includes('route-view--back'), anim: v ? getComputedStyle(v).animationName : '' }
})()`)
check('系统返回回到上一级', hw.hash === '#/profile', hw.hash)
check('系统返回也有滑动动效', hw.back === true && hw.anim === 'route-back', JSON.stringify(hw))
await sleep(320)
const lenBack = await evaluate('history.length')
check('返回不额外增加历史', lenBack === lenPush, `${lenPush} → ${lenBack}`)

// 从抽屉里再进一次设置，点页面返回箭头：应走 history.back() 且只回一级
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('通用设置')).click()`)
await sleep(500)
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(70)
const btnBack = await evaluate(`(() => {
  const v = document.querySelector('.route-view')
  return { hash: location.hash, back: v?.className.includes('route-view--back'), anim: v ? getComputedStyle(v).animationName : '' }
})()`)
check('页面返回按钮只回一级', btnBack.hash === '#/profile', btnBack.hash)
check('页面返回按钮也播放动效', btnBack.back === true && btnBack.anim === 'route-back', JSON.stringify(btnBack))
await sleep(320)
check('按钮返回不增加历史', (await evaluate('history.length')) === lenBack, String(await evaluate('history.length')))

// 主界面再按一次返回：先弹退出确认，确认后才离开应用
await clickTab('首页')
await sleep(300)
await evaluate('history.back()')
await sleep(450)
const exitTitle = await evaluate(`document.querySelector('.sheet__title')?.textContent ?? 'none'`)
check('主界面返回先确认退出', exitTitle.includes('要离开 Nestory'), exitTitle)
await evaluate(`[...document.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('退出应用')).click()`)
await sleep(900)
const afterExit = await evaluate('location.href').catch(() => 'detached')
check('确认后退出应用', !String(afterExit).startsWith(BASE), String(afterExit))

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
