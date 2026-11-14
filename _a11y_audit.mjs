import { seedSession } from './_login_session.mjs'
// Accessibility audit: inject axe-core from CDN and run it on every routed screen.
// usage: node _a11y_audit.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9900 + Math.floor(Math.random() * 90)
const profile = mkdtempSync(join(tmpdir(), 'nestory-a11y-'))
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
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function goto(url) {
  await send('Page.navigate', { url })
  await sleep(700)
  for (let i = 0; i < 40; i += 1) {
    try {
      if (await evaluate(`!!document.querySelector('.app')`)) break
    } catch {
      /* booting */
    }
    await sleep(150)
  }
  try {
    await evaluate('document.fonts.ready')
  } catch {
    /* ignore */
  }
  await sleep(300)
}

const AXE_URLS = [
  'https://cdn.jsdelivr.net/npm/axe-core@4.10.3/axe.min.js',
  'https://unpkg.com/axe-core@4.10.3/axe.min.js',
]
let axeSource = ''
for (const url of AXE_URLS) {
  try {
    const res = await fetch(url)
    if (!res.ok) continue
    axeSource = await res.text()
    if (axeSource.length > 100_000) break
  } catch {
    /* try next */
  }
}
if (!axeSource) throw new Error('无法获取 axe-core')

const ROUTES = [
  ['home', '#/home'],
  ['feed', '#/feed'],
  ['record', '#/record'],
  ['growth', '#/growth'],
  ['album', '#/album'],
  ['profile', '#/profile'],
  ['invite', '#/invite'],
  ['join', '#/join?t=0123456789abcdef0123456789abcdef'],
  ['baby', '#/baby'],
  ['reminders', '#/reminders'],
  ['settings', '#/settings'],
  ['about', '#/about'],
]

const findings = []
for (const [name, route] of ROUTES) {
  await goto(`${BASE}/${route}`)
  await evaluate(`${axeSource}\n;window.axe.version`)
  const violations = await evaluate(`axe.run(document, { resultTypes: ['violations'] }).then((r) =>
    r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.length,
      samples: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }))
  )`)
  for (const violation of violations) findings.push({ route: name, ...violation })
  console.log(`${violations.length ? '✗' : '✓'} ${name} — ${violations.length} 项`)
  if (violations.some((v) => v.id === 'heading-order')) {
    const outline = await evaluate(`[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName + (h.className ? '.' + String(h.className).split(' ')[0] : '') + ' ' + h.textContent.trim().slice(0, 24))`)
    console.log(`   标题顺序：${outline.join(' → ')}`)
  }
}

const byRule = new Map()
for (const f of findings) {
  const entry = byRule.get(f.id) ?? { ...f, routes: [] }
  if (!entry.routes.includes(f.route)) entry.routes.push(f.route)
  entry.nodes += f.nodes
  byRule.set(f.id, entry)
}
console.log('\n按规则汇总：')
for (const entry of byRule.values()) {
  console.log(`- [${entry.impact}] ${entry.id}: ${entry.help} — ${entry.routes.join(', ')}（共 ${entry.nodes} 个节点）`)
  console.log(`  ${entry.helpUrl}`)
  console.log(`  例：${entry.samples.join(' | ')}`)
}
const serious = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical')
console.log(`\n${findings.length} 处违规，其中 serious/critical ${serious.length} 处`)
if (serious.length) {
  for (const f of serious) console.log(`  ✗ ${f.route} · ${f.id} — ${f.samples.join(' | ')}`)
}

ws.close()
chrome.kill()
process.exitCode = serious.length ? 1 : 0
