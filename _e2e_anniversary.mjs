import { seedSession } from './_login_session.mjs'
// Anniversary card: countdown is read-only, the day itself opens a small capture sheet.
// usage: node _e2e_anniversary.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9700 + Math.floor(Math.random() * 120)
const profile = mkdtempSync(join(tmpdir(), 'nestory-anniv-'))
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
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function waitFor(expression, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return true
    await sleep(100)
  }
  throw new Error('timeout: ' + expression)
}
async function goto(url) {
  await send('Page.navigate', { url })
  await waitFor('!!document.querySelector(".app")')
  await sleep(1500)
}
async function reload() {
  await send('Page.reload', { ignoreCache: true })
  await waitFor('!!document.querySelector(".app")')
  await sleep(1500)
}
async function shot(path) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path, Buffer.from(r.data, 'base64'))
}

await goto(BASE + '/?e2e=anniv#/home')

const before = await evaluate(`(async () => (await (await fetch('/api/state')).json()).state)()`)

try {
  const normal = await evaluate(`(() => {
    const el = document.querySelector('.anniversary')
    return { tag: el?.tagName, text: el?.innerText.replace(/\\s+/g, ' ').trim() }
  })()`)
  check('倒计时卡片是只读信息', normal.tag === 'DIV', JSON.stringify(normal))
  check('倒计时显示天数与日期', /^\d+天/.test(normal.text) && /\d+ 月 \d+ 日/.test(normal.text), normal.text)

  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const patched = { ...before, baby: { ...before.baby, birthday: iso } }
  await evaluate(
    `fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: ${JSON.stringify(patched)} }) }).then(r => r.status)`,
  )
  await reload()

  const today = await evaluate(`(() => {
    const el = document.querySelector('.anniversary--today')
    return { tag: el?.tagName, text: el?.innerText.replace(/\\s+/g, ' ').trim() }
  })()`)
  check('纪念日当天卡片可点', today.tag === 'BUTTON', JSON.stringify(today))
  check('当天文案是「今天」', today.text.startsWith('今天'), today.text)

  await evaluate(`document.querySelector('.anniversary--today').click()`)
  await waitFor('!!document.querySelector(".sheet")')
  await sleep(300)
  check('录入面板打开', (await evaluate(`document.querySelector('.sheet')?.innerText.includes('今天的一句话')`)) === true)

  await evaluate(`document.querySelector('.sheet textarea').focus()`)
  await send('Input.insertText', { text: '满月这天，第一次笑出声。' })
  await shot('shots/e2e-anniversary.png')
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('记下来'))
    btn?.click()
    return !!btn
  })()`)
  await waitFor(`document.body.innerText.includes('已记下满月纪念')`, 6000)

  let created
  for (let i = 0; i < 20; i++) {
    const after = await evaluate(`(async () => (await (await fetch('/api/state')).json()).state)()`)
    created = (after.milestones || []).find((m) => m.title === '满月纪念')
    if (created) break
    await sleep(250)
  }
  check(
    '一句话写进成长时间轴',
    created?.note === '满月这天，第一次笑出声。' && created?.kind === 'anniversary',
    JSON.stringify(created),
  )
  check('纪念日记录带上写下时的生日', created?.birthday === iso, `${created?.birthday} vs ${iso}`)

  const readState = () => evaluate(`(async () => (await (await fetch('/api/state')).json()).state)()`)
  const putState = (state) =>
    evaluate(
      `fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: ${JSON.stringify(state)} }) }).then(r => r.status)`,
    )

  // 把生日改回真实值：属于假生日的纪念日应被收起（而不是删掉）。
  const current = await readState()
  await putState({ ...current, baby: { ...current.baby, birthday: before.baby.birthday } })
  await reload()
  const afterReal = await readState()
  const stillVisible = (afterReal.milestones || []).some((m) => m.title === '满月纪念')
  const keptAside = (afterReal.archived?.milestones || []).some((m) => m.title === '满月纪念')
  check('改回出生日期后记录从时间轴收起', !stillVisible && keptAside, JSON.stringify({ stillVisible, keptAside }))

  // 再改回假生日：收起的那条应回来。
  const back = await readState()
  await putState({ ...back, baby: { ...back.baby, birthday: iso } })
  await reload()
  const afterBack = await readState()
  check(
    '生日改回去后记录重新出现',
    (afterBack.milestones || []).some((m) => m.title === '满月纪念') &&
      !(afterBack.archived?.milestones || []).some((m) => m.title === '满月纪念'),
  )
} finally {
  await evaluate(
    `fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: ${JSON.stringify(before)} }) }).then(r => r.status)`,
  )
  await sleep(1500)
  await reload()
  const restored = await evaluate(`document.querySelector('.anniversary')?.innerText.replace(/\\s+/g, ' ').trim()`)
  check('演示数据已还原', !restored?.startsWith('今天'), restored)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
