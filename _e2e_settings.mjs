import { seedSession } from './_login_session.mjs'
import { seedDemoMember } from './_seed_family.mjs'
// Settings / permissions / avatar regression.
// usage: node _e2e_settings.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9600 + Math.floor(Math.random() * 150)
const profile = mkdtempSync(join(tmpdir(), 'nestory-settings-'))
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

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function goto(url) {
  await send('Page.navigate', { url })
  await sleep(700)
  for (let i = 0; i < 30; i += 1) {
    try {
      if (await evaluate(`!!document.querySelector('.app')`)) break
    } catch {
      /* still booting */
    }
    await sleep(150)
  }
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
const clickSel = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`)
const back = () => evaluate(`(() => { const b = document.querySelector('.screen-head .icon-btn'); if (!b) return false; b.click(); return true })()`)

await goto(BASE + '/#/home')
await evaluate('localStorage.clear()')
await goto(BASE + '/#/profile')

// ---------- entry points ----------
check('我的家庭没有重复的右上角入口', (await evaluate(`document.querySelectorAll('[aria-label="设置"]').length`)) === 0, 'aria-label=设置')
check('资料行不再有「编辑资料」按钮', !(await text('.profile-hint')).includes('编辑资料'), await text('.profile-hint'))
check('设置列表出现通用设置', (await text('.settings')).includes('通用设置'), '')

await clickText('通用设置', '.setting')
await sleep(500)
check('进入设置页', (await evaluate('location.hash')) === '#/settings', await evaluate('location.hash'))
check('设置页标题', (await text('.screen-head__title')) === '设置', await text('.screen-head__title'))
check('存储空间有数值', /KB|MB/.test(await text('.storage-figure')), await text('.storage-figure'))

// ---------- font size ----------
const scaleBefore = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--type-scale').trim()`)
await clickText('大', '.scale-picker__item')
await sleep(350)
const scaleAfter = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--type-scale').trim()`)
check('字体大小切换生效', scaleBefore === '1' && scaleAfter === '1.08', `${scaleBefore} → ${scaleAfter}`)
check('选择状态写入本地', await evaluate(`JSON.parse(localStorage.getItem('nestory.prefs.v1')).fontSize === 'large'`), '')

await clickSel('.switch[aria-label="减少动态效果"]')
await sleep(250)
check('减少动态效果生效', (await evaluate(`document.documentElement.dataset.reduceMotion`)) === 'true', '')

await goto(BASE + '/#/settings')
check('刷新后字体大小保留', (await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--type-scale').trim()`)) === '1.08', '')
check('刷新后减少动效保留', (await evaluate(`document.documentElement.dataset.reduceMotion`)) === 'true', '')

const backClicked = await back()
await sleep(500)
check('设置页返回我的家庭', (await evaluate('location.hash')) === '#/profile', await evaluate('location.hash'))

// ---------- member permissions ----------
await seedDemoMember(BASE, '爸爸')
await goto(BASE + '/?seed=1#/profile')
await sleep(1200)
await clickText('爸爸', '.family__item')
await sleep(400)
check('成员详情出现权限选项', (await evaluate(`document.querySelectorAll('.perm').length`)) === 3, '3 options')
await clickText('只读', '.perm')
await sleep(350)
check('权限立即生效', (await text('.member-card')).includes('仅可查看'), await text('.member-card'))
check('权限修改有提示', (await text('.toast')).includes('权限'), await text('.toast'))

await goto(BASE + '/#/profile')
await clickText('爸爸', '.family__item')
await sleep(400)
check('刷新后权限保留', (await text('.perm--on')).includes('只读'), await text('.perm--on'))

await clickText('妈妈', '.family__item')
await sleep(300)
check('当前账号不显示移出自己', !(await text('.sheet__foot')).includes('移出家庭'), await text('.sheet__foot'))
await clickText('只读', '.perm')
await sleep(350)
check(
  '最后一位管理员不能被降级',
  (await text('.perm--on')).includes('家庭管理员') &&
    (await text('.perm-error')).includes('至少'),
  await text('.perm-error'),
)

// ---------- avatar upload ----------
await evaluate(`document.querySelector('.sheet-backdrop')?.click()`)
await sleep(300)
await clickSel('.profile-hero__edit')
await sleep(450)
const doc = await send('DOM.getDocument', { depth: -1 })
const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.baby-form input[type=file]' })
check('资料表单有文件输入', input.nodeId > 0, String(input.nodeId))
await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [resolve('public/assets/photos/p3@520.jpg')] })
await sleep(900)
check('上传后出现自定义头像', (await evaluate(`document.querySelector('.avatar-picker__item--on img').src.startsWith('data:image/')`)) === true, '')
await clickText('保存资料')
await sleep(700)
check('保存后头像使用上传图', (await evaluate(`document.querySelector('.profile-hero__avatar').src.startsWith('data:image/')`)) === true, '')

await goto(BASE + '/#/profile')
check('刷新后头像仍是上传图', (await evaluate(`document.querySelector('.profile-hero__avatar').src.startsWith('data:image/')`)) === true, '')

// ---------- back targets ----------
await goto(BASE + '/#/settings')
await clickText('提醒节奏')
await sleep(500)
check('设置进入提醒中心保留来源', (await evaluate('location.hash')).includes('from=settings'), await evaluate('location.hash'))
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(450)
check('提醒中心返回设置', (await evaluate('location.hash')) === '#/settings', await evaluate('location.hash'))

await goto(BASE + '/#/home')
await evaluate(`document.querySelector('.overview__remind').click()`)
await sleep(450)
check('首页进入提醒中心保留来源', (await evaluate('location.hash')).includes('from=home'), await evaluate('location.hash'))
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(450)
check('提醒中心返回首页', (await evaluate('location.hash')) === '#/home', await evaluate('location.hash'))

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-settings.png', Buffer.from(shot.data, 'base64')),
)

await evaluate('localStorage.clear()')
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
