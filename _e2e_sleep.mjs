import { seedSession } from './_login_session.mjs'
// Sleep record checks: explicit start/end dates, no timer, overnight and validation.
// usage: node _e2e_sleep.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 10050 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-sleep-'))

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

async function goto(hash) {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}${hash}` })
  await sleep(1900)
}

async function go(hash) {
  const clean = hash
    .replace(/^\/?#/, '')
    .replace(/^\//, '')
    .replace(/^#/, '')
  await evaluate(`location.hash = ${JSON.stringify(`/${clean}`)}`)
  await sleep(700)
}

async function clickText(text, scope = 'button') {
  for (let i = 0; i < 25; i++) {
    const ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})
      if (!el) return false
      el.click()
      return true
    })()`)
    if (ok) {
      await sleep(350)
      return
    }
    await sleep(200)
  }
  throw new Error(`button not found: ${text} (hash: ${await evaluate('location.hash')})`)
}

async function setField(selector, index, value) {
  await evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!el) throw new Error('field ${selector} ${index} not found')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(150)
}

const iso = (offsetDays) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function openSleep() {
  await go('/#/home')
  await evaluate(`document.querySelectorAll('.quick__item')[1].click()`)
  await sleep(500)
}

await goto('/#/home')

const overview = await evaluate(`(() => ({
  cells: document.querySelectorAll('.overview__cell').length,
  labels: [...document.querySelectorAll('.overview__label')].map((n) => n.textContent.trim()),
}))()`)
check('overview has six cells', overview.cells === 6, String(overview.cells))
check('overview includes sleep and diaper rows', overview.labels.length === 6, overview.labels.join(' | '))
const beforeSleep = await evaluate(`document.querySelectorAll('.overview__cell')[4].textContent.trim()`)

await openSleep()
const sheet = await evaluate(`(() => ({
  dates: document.querySelectorAll('.sheet input[type=date]').length,
  times: document.querySelectorAll('.sheet input[type=time]').length,
  timer: !!document.querySelector('.sheet .amount__num'),
  chips: document.querySelectorAll('.sheet .chip-row').length,
  startDate: document.querySelectorAll('.sheet input[type=date]')[0]?.value ?? '',
  endDate: document.querySelectorAll('.sheet input[type=date]')[1]?.value ?? '',
  start: document.querySelectorAll('.sheet input[type=time]')[0]?.value ?? '',
  end: document.querySelectorAll('.sheet input[type=time]')[1]?.value ?? '',
}))()`)
check('two date and two time fields', sheet.dates === 2 && sheet.times === 2, JSON.stringify(sheet))
check('time is not entered by timer', sheet.timer === false, String(sheet.timer))
check('day chips removed', sheet.chips === 0, String(sheet.chips))
check('dates and times prefilled', /^\d{4}-\d{2}-\d{2}$/.test(sheet.startDate) && /^\d{2}:\d{2}$/.test(sheet.start), `${sheet.startDate} ${sheet.start} - ${sheet.endDate} ${sheet.end}`)

// 1) save the default 30 minutes
await clickText('保存睡眠记录')
await sleep(700)
check('default record saves and closes sheet', (await evaluate(`!!document.querySelector('.sheet')`)) === false)
await go('/#/home')
const afterDefault = await evaluate(`document.querySelectorAll('.overview__cell')[4].textContent.trim()`)
check('home sleep summary changes', afterDefault !== beforeSleep, `${beforeSleep} -> ${afterDefault}`)

// 2) explicit yesterday 10:20 -> 11:05 = 45m
await openSleep()
await setField('.sheet input[type=date]', 0, iso(-1))
await setField('.sheet input[type=date]', 1, iso(-1))
await setField('.sheet input[type=time]', 0, '10:20')
await setField('.sheet input[type=time]', 1, '11:05')
await clickText('保存睡眠记录')
await sleep(700)
await go('/#/growth')
await clickText('睡眠', '.segmented__item')
await sleep(500)
const rows = await evaluate(`[...document.querySelectorAll('.record')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`)
check('45m record appears on growth', rows.some((t) => t.includes('45m') && t.includes('10:20')), JSON.stringify(rows.slice(0, 3)))

// 3) overnight 22:00 -> 06:00 = 8h, dates explicit
// 用「前天 22:00 → 昨天 06:00」而不是「昨天 → 今天」，否则在凌晨（今天 06:00 还没到）会被
// 「结束时间晚于现在」拦下，这条用例就会随运行时刻时好时坏。
await openSleep()
await setField('.sheet input[type=date]', 0, iso(-2))
await setField('.sheet input[type=time]', 0, '22:00')
await setField('.sheet input[type=date]', 1, iso(-1))
await setField('.sheet input[type=time]', 1, '06:00')
await clickText('保存睡眠记录')
await sleep(700)
await go('/#/growth')
await clickText('睡眠', '.segmented__item')
await sleep(500)
const overnight = await evaluate(`[...document.querySelectorAll('.record')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).find((t) => t.includes('22:00')) ?? ''`)
check('overnight record is 8h', overnight.includes('8h'), overnight)

// 4) end before start on the same date is rejected
await openSleep()
await setField('.sheet input[type=date]', 0, iso(0))
await setField('.sheet input[type=time]', 0, '12:00')
await setField('.sheet input[type=date]', 1, iso(0))
await setField('.sheet input[type=time]', 1, '11:00')
await clickText('保存睡眠记录')
await sleep(500)
const invalid = await evaluate(`(() => ({
  open: !!document.querySelector('.sheet'),
  toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|'),
}))()`)
check('end-before-start is rejected', invalid.open === true && invalid.toast.includes('晚于'), JSON.stringify(invalid))

// close the sheet before the next case
await evaluate(`document.querySelector('.sheet-backdrop')?.click()`)
await sleep(300)

// 5) future dates are rejected
await openSleep()
await setField('.sheet input[type=date]', 0, iso(1))
await setField('.sheet input[type=time]', 0, '10:00')
await setField('.sheet input[type=date]', 1, iso(1))
await setField('.sheet input[type=time]', 1, '11:00')
await clickText('保存睡眠记录')
await sleep(500)
const future = await evaluate(`(() => ({
  open: !!document.querySelector('.sheet'),
  toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|'),
}))()`)
check('future record is rejected', future.open === true && future.toast.includes('不能晚于现在'), JSON.stringify(future))

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`)
check('no runtime errors', errors === 0, String(errors))

await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-sleep.png', Buffer.from(shot.data, 'base64')),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
