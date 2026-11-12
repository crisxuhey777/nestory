import { seedSession } from './_login_session.mjs'
// Layout checks for Growth / Album: no back button, new tab header, cover, tabs.
// usage: node _e2e_layout.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9600 + Math.floor(Math.random() * 120)
const profile = mkdtempSync(join(tmpdir(), 'nestory-layout-'))

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
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break
  } catch {
    /* not up */
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
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text)
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

async function goto(path) {
  await send('Page.navigate', { url: BASE + path })
  await sleep(750)
  try {
    await evaluate('document.fonts.ready')
  } catch {
    /* ignore */
  }
  await sleep(220)
}

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`)
}

const count = (sel) => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const has = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)
const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)

// ---------- Growth ----------
await goto('/#/growth')
await evaluate('localStorage.clear()')
await goto('/#/growth')

check('growth: no back button', (await count('.screen-head')) === 0)
check('growth: no plain icon button (back)', (await count('.icon-btn--plain')) === 0)
check('growth: tab header title', (await has('.tab-head__title')) === true)
check('growth: meta line', (await has('.tab-head__meta')) === true)
check('growth: latest measurement hero', (await has('.measure')) === true)
check('growth: measurement table = head + 4 rows', (await count('.growth-row')) === 5)
check('growth: columns in table header', (await count('.growth-row--head span')) === 5)

await click('.segmented__item:nth-child(2)')
await sleep(230)
check('growth: sleep tab shows 2 stats', (await count('.metric')) === 2)
check('growth: sleep tab meta', (await has('.tab-head__meta')) === true)

await click('.segmented__item:nth-child(3)')
await sleep(230)
check('growth: diaper tab shows 3 stats', (await count('.metric')) === 3)
check('growth: diaper quick add buttons', (await count('.page__body .btn--quiet')) >= 3)

// ---------- Album ----------
await goto('/#/album')
check('album: no back button', (await count('.screen-head')) === 0)
check('album: tab header title', (await has('.tab-head__title')) === true)
check('album: cover photo', (await has('.album-cover')) === true)
check('album: cover caption', (await has('.album-cover__cap')) === true)
check('album: cover excluded from grid', (await count('.album-card')) === 5)
check('album: month groups', (await count('.months')) === 2)

await click('.album-cover')
await sleep(320)
check('album: cover opens lightbox', (await has('.lightbox')) === true)
await click('.lightbox__close')
await sleep(250)
check('album: lightbox closes', (await has('.lightbox')) === false)

await click('.chip-row .chip:nth-child(3)')
await sleep(300)
check('album: month filter keeps cover', (await has('.album-cover')) === true)
check('album: month filter shrinks grid', (await count('.album-card')) === 0)

check('no runtime exceptions', errors.length === 0, errors.join(' / '))

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
ws.close()
chrome.kill()
process.exit(passed === results.length ? 0 : 1)
