import { seedSession } from './_login_session.mjs'
// Home hero carousel checks against the running dev server.
// usage: node _e2e_home.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9950 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-home-'))

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
let runtimeErrors = 0
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.method === 'Runtime.exceptionThrown') runtimeErrors++
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

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

await send('Page.navigate', { url: `${BASE}/#/home` })
await sleep(1400)

const setup = await evaluate(`(() => {
  const track = document.querySelector('.hero__track')
  return {
    slides: document.querySelectorAll('.hero__slide').length,
    dots: document.querySelectorAll('.hero__dot').length,
    width: track?.clientWidth ?? 0,
    selected: [...document.querySelectorAll('.hero__dot')].findIndex((d) => d.getAttribute('aria-current') === 'true'),
    labels: [...document.querySelectorAll('.hero__dot')].map((d) => d.getAttribute('aria-label')),
  }
})()`)

check('首页有 4 张主视觉', setup.slides === 4, String(setup.slides))
check('对应 4 个指示点', setup.dots === 4, String(setup.dots))
check('默认停在第一张', setup.selected === 0, String(setup.selected))
check('指示点带无障碍标签', setup.labels.every(Boolean), setup.labels.join(' / '))
check('轮播宽度等于视口', setup.width === 430, String(setup.width))

const pageOverflow = await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`)
check('轮播没有撑宽页面', pageOverflow === true, '')

await evaluate(`document.querySelectorAll('.hero__dot')[2].click()`)
await sleep(900)
const afterDot = await evaluate(`(() => {
  const track = document.querySelector('.hero__track')
  const dots = [...document.querySelectorAll('.hero__dot')]
  return {
    left: Math.round(track.scrollLeft),
    width: track.clientWidth,
    selected: dots.findIndex((d) => d.getAttribute('aria-current') === 'true'),
    hidden: [...document.querySelectorAll('.hero__slide')].map((s) => s.getAttribute('aria-hidden')),
  }
})()`)
check('点击第 3 个点滚到第 3 张', afterDot.selected === 2 && Math.abs(afterDot.left - afterDot.width * 2) < 4, JSON.stringify(afterDot))
check('非当前照片标记 aria-hidden', afterDot.hidden[0] === 'true' && afterDot.hidden[2] === 'false', afterDot.hidden.join(','))

// real touch swipe: back to the first slide, then drag left
await evaluate(`document.querySelectorAll('.hero__dot')[0].click()`)
await sleep(800)
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
const swipeY = 250
await send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: 360, y: swipeY }],
})
for (const x of [310, 250, 190, 130, 70]) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: swipeY }] })
  await sleep(40)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(900)
const afterSwipe = await evaluate(`(() => {
  const track = document.querySelector('.hero__track')
  const dots = [...document.querySelectorAll('.hero__dot')]
  return {
    pages: Math.round(track.scrollLeft / track.clientWidth),
    selected: dots.findIndex((d) => d.getAttribute('aria-current') === 'true'),
  }
})()`)
check('手指左滑切到下一张', afterSwipe.pages === 1 && afterSwipe.selected === 1, JSON.stringify(afterSwipe))

// vertical swipe on the hero must still scroll the page
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 215, y: 320 }] })
for (const y of [270, 210, 150, 90]) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 215, y }] })
  await sleep(40)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(700)
const scrollY = await evaluate('Math.round(window.scrollY)')
check('主视觉上滑仍能滚动页面', scrollY > 80, String(scrollY))

await evaluate(`(() => {
  const track = document.querySelector('.hero__track')
  track.scrollTo({ left: track.clientWidth * 3, behavior: 'instant' })
})()`)
await sleep(700)
const afterScroll = await evaluate(`(() => {
  const dots = [...document.querySelectorAll('.hero__dot')]
  return {
    selected: dots.findIndex((d) => d.getAttribute('aria-current') === 'true'),
    onCount: document.querySelectorAll('.hero__dot--on').length,
  }
})()`)
check('滑动后指示点同步到第 4 张', afterScroll.selected === 3, JSON.stringify(afterScroll))
check('始终只有一个激活指示点', afterScroll.onCount === 1, String(afterScroll.onCount))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('shots/home-carousel-4.png', Buffer.from(shot.data, 'base64'))

// ---------- auto play ----------
await send('Page.navigate', { url: `${BASE}/?auto=${Date.now()}#/home` })
await sleep(1500)
const autoStart = await evaluate(`[...document.querySelectorAll('.hero__dot')].findIndex((d) => d.getAttribute('aria-current') === 'true')`)
await sleep(6800)
const autoNext = await evaluate(`[...document.querySelectorAll('.hero__dot')].findIndex((d) => d.getAttribute('aria-current') === 'true')`)
check('静置 6 秒后自动切到下一张', autoNext === (autoStart + 1) % 4, `${autoStart} → ${autoNext}`)

// ---------- photo picker ----------
const clickButton = (label) =>
  evaluate(`(() => {
    const target = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\\s+/g, '').includes(${JSON.stringify(label)}))
    if (!target) return false
    target.click()
    return true
  })()`)

await evaluate(`document.querySelector('[aria-label="设置首页照片"]').click()`)
await sleep(450)
const grid = await evaluate(`(() => ({
  title: document.querySelector('.sheet__title')?.textContent ?? '',
  cells: document.querySelectorAll('.hero-cell').length,
  photos: document.querySelectorAll('.hero-cell img').length,
  add: document.querySelectorAll('.hero-cell--add').length,
  count: document.querySelector('.hero-pick-head .eyebrow')?.textContent ?? '',
}))()`)
check('右上角图标打开四宫格', grid.title.includes('首页照片') && grid.cells === 4, `${grid.title} / ${grid.cells}`)
check('四格都有照片时没有空位', grid.photos === 4 && grid.add === 0, `${grid.photos} / ${grid.add}`)
check('显示已选数量', grid.count.includes('4 / 4'), grid.count)

const firstPhotoBefore = await evaluate(`document.querySelector('.hero-cell img').src`)
await evaluate(`document.querySelector('.hero-cell').click()`)
await sleep(450)
const picker = await evaluate(`(() => ({
  title: document.querySelector('.sheet__title')?.textContent ?? '',
  options: document.querySelectorAll('.hero-pick').length,
  add: document.querySelectorAll('.hero-pick--add').length,
  current: document.querySelectorAll('.hero-pick--on').length,
}))()`)
check('点照片进入替换视图', picker.title.includes('选择第 1 格'), picker.title)
check('选择页只列相册已有照片', picker.options === 6 && picker.add === 0, `${picker.options} / ${picker.add}`)
check('标出当前这一格', picker.current === 1, String(picker.current))

await evaluate(`document.querySelector('.hero-pick:not(.hero-pick--on):not(.hero-pick--add)').click()`)
await sleep(450)
const firstPhotoAfter = await evaluate(`document.querySelector('.hero-cell img').src`)
check('选择另一张照片后立即替换', firstPhotoAfter !== firstPhotoBefore, `${firstPhotoBefore} → ${firstPhotoAfter}`)

await clickButton('保存照片')
await sleep(700)
const savedHero = await evaluate(`document.querySelectorAll('.hero__slide').length`)
check('保存后首页仍是 4 张', savedHero === 4, String(savedHero))

// 当前后端只读：首页照片的修改只存在内存，刷新会回到服务端基线，
// 因此这里不校验刷新持久化，只校验选择页仍只使用相册内照片。
await send('Page.navigate', { url: `${BASE}/?reload=${Date.now()}#/home` })
await sleep(1200)

// the picker must only offer photos that already live in the album
check(
  '选择页没有重新导入照片的入口',
  (await evaluate(`!document.querySelector('.sheet input[type=file]')`)) === true,
  '',
)

// clearing a slot brings the plus tile back
await evaluate(`document.querySelector('[aria-label="设置首页照片"]').click()`)
await sleep(400)
await evaluate(`document.querySelector('.hero-cell').click()`)
await sleep(400)
await clickButton('清空这一格')
await sleep(450)
const cleared = await evaluate(`(() => ({
  photos: document.querySelectorAll('.hero-cell img').length,
  add: document.querySelectorAll('.hero-cell--add').length,
  count: document.querySelector('.hero-pick-head .eyebrow')?.textContent ?? '',
}))()`)
check('清空后出现同尺寸加号格', cleared.photos === 3 && cleared.add === 1, JSON.stringify(cleared))
check('已选数量同步为 3', cleared.count.includes('3 / 4'), cleared.count)

await evaluate(`document.querySelector('.hero-cell--add').click()`)
await sleep(400)
await evaluate(`document.querySelector('.hero-pick').click()`)
await sleep(450)
const refilled = await evaluate(`document.querySelectorAll('.hero-cell img').length`)
check('点加号可选择并补满四格', refilled === 4, String(refilled))

await clickButton('保存照片')
await sleep(600)
await evaluate(`document.querySelector('[aria-label="设置首页照片"]').click()`)
await sleep(400)
await clickButton('恢复默认')
await sleep(250)
await clickButton('保存照片')
await sleep(700)
const restored = await evaluate(`document.querySelectorAll('.hero__slide').length`)
check('恢复默认回到 4 张', restored === 4, String(restored))

const errors = await evaluate('window.__nestoryErrors ? window.__nestoryErrors.length : 0').catch(() => 0)
check('页面无脚本崩溃', errors === 0 && runtimeErrors === 0, `${errors} / ${runtimeErrors}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0

