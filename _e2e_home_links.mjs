import { seedSession } from './_login_session.mjs'
// 首页两个区块入口的回归：全部照片直达相册的全屏层、全部里程碑定位到成长时间轴。
// usage: node _e2e_home_links.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 10140 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-home-links-'))

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

async function waitFor(expression, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await sleep(150)
  }
  return null
}

async function goto(hash) {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}${hash}` })
  await sleep(500)
  await waitFor(`!!document.querySelector('.app')`, 8000)
  await sleep(700)
}

async function clickAction(title) {
  return evaluate(`(() => {
    const section = [...document.querySelectorAll('.section')].find((el) =>
      el.querySelector('.section-head__title')?.textContent.includes(${JSON.stringify(title)}),
    )
    const button = section?.querySelector('.section-head__action')
    if (!button) return null
    const label = button.textContent.trim()
    button.click()
    return label
  })()`)
}

try {
  await goto('/#/home')

  const labels = await evaluate(`(() => {
    const read = (title) => {
      const section = [...document.querySelectorAll('.section')].find((el) =>
        el.querySelector('.section-head__title')?.textContent.includes(title),
      )
      return section?.querySelector('.section-head__action')?.textContent.trim() ?? null
    }
    return { photos: read('最近的成长瞬间'), story: read('成长时间轴') }
  })()`)
  check('照片区块入口写作「全部照片」', labels.photos === '全部照片', String(labels.photos))
  check('时间轴入口写作「全部里程碑」', labels.story === '全部里程碑', String(labels.story))

  const photoLabel = await clickAction('最近的成长瞬间')
  await sleep(900)
  const photoState = await evaluate(`({
    hash: location.hash,
    open: !!document.querySelector('.album-all'),
    title: document.querySelector('.album-all__title b')?.textContent.trim() ?? null,
    cards: document.querySelectorAll('.album-all .album-card').length,
  })`)
  check('点「全部照片」进入相册的全屏层', photoLabel === '全部照片' && photoState.open === true, JSON.stringify(photoState))
  check('入口带 all=1 且记录来源', photoState.hash.includes('all=1') && photoState.hash.includes('from=home'), photoState.hash)
  check('全屏层标题与内容一致', photoState.title === '全部照片' && photoState.cards > 0, `${photoState.title} · ${photoState.cards}`)

  await evaluate(`document.querySelector('.album-all__head .icon-btn').click()`)
  await sleep(800)
  const closed = await evaluate(`({ hash: location.hash, open: !!document.querySelector('.album-all'), home: !!document.querySelector('.hero') })`)
  check('关闭全屏层回到首页', closed.hash === '#/home' && closed.open === false && closed.home === true, JSON.stringify(closed))

  const storyLabel = await clickAction('成长时间轴')
  await sleep(1400)
  const storyState = await evaluate(`(() => {
    const story = document.querySelector('.story')
    return {
      hash: location.hash,
      present: !!story,
      top: story ? Math.round(story.getBoundingClientRect().top) : null,
      scrollY: Math.round(window.scrollY),
    }
  })()`)
  check('点「全部里程碑」进入相册时间轴', storyLabel === '全部里程碑' && storyState.hash.includes('story=1'), JSON.stringify(storyState))
  check('时间轴已滚到视口内', storyState.present === true && storyState.top !== null && storyState.top < 900 && storyState.scrollY > 300, `${storyState.top} @ ${storyState.scrollY}`)

  await evaluate('history.back()')
  await sleep(800)
  const backHome = await evaluate(`({ hash: location.hash, home: !!document.querySelector('.hero') })`)
  check('返回键回到首页', backHome.hash === '#/home' && backHome.home === true, JSON.stringify(backHome))

  const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
  check('页面无脚本错误', errors === 0, String(errors))
} finally {
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  ws.close()
  chrome.kill()
  process.exitCode = failed ? 1 : 0
}
