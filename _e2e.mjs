import { seedSession } from './_login_session.mjs'
// End-to-end checks against the running dev server, through the real UI.
// usage: node _e2e.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 9800 + Math.floor(Math.random() * 150)
const profile = mkdtempSync(join(tmpdir(), 'nestory-e2e-'))

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
      /* not up */
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

const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`)
const feedCount = (value) => {
  const match = value.match(/已喂养\s*(\d+)\s*次/)
  return match ? Number(match[1]) : NaN
}

// ---------- 1. 首页 ----------
await goto(BASE + '/#/home')
await evaluate('localStorage.clear()')
await goto(BASE + '/#/home')
const heroName = await text('.hero__name')
const heroMeta = await text('.hero__meta')
check('首页显示宝宝昵称', heroName.trim().length > 0, heroName)
check('首页显示真实月龄与天数', /\d+ 个月 \d+ 天/.test(heroMeta) && /第 \d+ 天/.test(heroMeta), heroMeta)
const brandName = await text('.hero__brand')
check('首页显示 Nestory 品牌', brandName.includes('Nestory'), brandName)
const beforeCount = Number((await text('.overview__cell')).split('次')[0])

// ---------- 2. 两个入口进入不同界面 ----------
await clickText('喂养记录')
await sleep(450)
check('首页 CTA 进入喂养记录', (await evaluate('location.hash')) === '#/feed', await evaluate('location.hash'))
check('喂养记录显示统计与记录', (await evaluate(`!!document.querySelector('.stats-block')`)) === true, '')
check(
  '喂养记录不显示喂养方式表单',
  (await evaluate(`!document.querySelector('.composer')`)) === true &&
    (await evaluate(`!document.querySelector('.save-bar')`)) === true,
  '',
)
check('喂养记录右上角没有铃铛', (await evaluate(`!document.querySelector('[aria-label="喂养提醒"]')`)) === true, '')
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(400)
await clickText('喂奶', '.quick__item')
await sleep(350)
check('快捷喂奶停留在首页', (await evaluate('location.hash')) === '#/home', await evaluate('location.hash'))
check('快捷喂奶打开底部面板', (await evaluate(`!!document.querySelector('.sheet')`)) === true, '')
check('底部面板标题为记录喂养', (await text('.sheet__title')).includes('记录喂养'), await text('.sheet__title'))
check(
  '底部面板显示三种喂养方式',
  (await evaluate(`document.querySelectorAll('.sheet .method').length`)) === 3,
  '',
)
check('首页快捷喂奶与其他快捷项同色', (await evaluate(`document.querySelectorAll('.quick__circle--primary').length`)) === 0, '')
await clickText('母乳亲喂')
await clickText('开始计时')
await sleep(900)
await clickText('暂停计时')
const sheetTimer = await text('.sheet .timer__digits')
check('喂养面板亲喂计时会走动', sheetTimer !== '00:00:00', sheetTimer)
await evaluate(`document.querySelector('.sheet-backdrop').click()`)
await sleep(350)
check('关闭喂养面板回到首页', (await evaluate(`!document.querySelector('.sheet')`)) === true, '')

// ---------- 3. 快速记录表单（首页底部面板；#/record 已下线） ----------
await goto(BASE + '/#/home')
await sleep(350)
await evaluate(`document.querySelector('.quick__item[aria-label="快速记录喂奶"]').click()`)
await sleep(450)
check('快速记录初次进入没有选中方式', (await evaluate(`document.querySelectorAll('.method--on').length`)) === 0, '')
check('未选方式不能保存', (await evaluate(`[...document.querySelectorAll('.sheet .btn--primary')].find((b) => b.textContent.includes('保存这次喂养'))?.disabled`)) === true, '')

await clickText('瓶喂母乳')
await sleep(300)
check('选中瓶喂后显示喂养时间', (await evaluate(`!!document.querySelector('.feed-time__input')`)) === true, '')
check('瓶喂不需要亲喂计时器', (await evaluate(`!document.querySelector('.timer__digits')`)) === true, '')

await clickText('母乳亲喂')
await sleep(1300)
check(
  '选瓶喂后点亲喂不会自动计时',
  (await evaluate(`document.querySelector('.timer__digits')?.textContent`)) === '00:00:00',
  await text('.timer__digits'),
)
await clickText('瓶喂母乳')
await sleep(250)

await clickText('开始计时')
await sleep(900)
await clickText('暂停计时')
await sleep(1500)
await clickText('继续计时')
await sleep(900)
await clickText('结束本节')
await sleep(250)
const digits = await text('.timer__digits')
check('计时器实际走动', digits !== '00:00:00', digits)
check('亲喂计时后可以直接保存', (await evaluate(`[...document.querySelectorAll('.sheet .btn--primary')].find((b) => b.textContent.includes('保存这次喂养'))?.disabled`)) === false, '')

// ---------- 4. 保存记录 ----------
await clickText('保存这次喂养')
await sleep(800)
check('快速记录保存后回到首页', (await evaluate('location.hash')) === '#/home', await evaluate('location.hash'))
const toast = await text('.toast')
check('保存后出现反馈', /已保存|记录/.test(toast), toast)
const afterHomeCount = Number((await text('.overview__cell')).split('次')[0])
check('今日次数 +1', afterHomeCount === beforeCount + 1, `${beforeCount} → ${afterHomeCount}`)

await sleep(1000)
const savedFeed = await evaluate(`fetch('/api/state', { credentials: 'same-origin' })
  .then((r) => r.json())
  .then((d) => {
    const f = [...d.state.feeds].sort((a, b) => b.startedAt - a.startedAt)[0]
    return { elapsed: Date.now() - f.startedAt, breast: f.leftSec + f.rightSec }
  })`)
check(
  '暂停后开始时间仍取首次开始',
  savedFeed.elapsed > 2800 && savedFeed.elapsed < 7000,
  JSON.stringify(savedFeed),
)
check(
  '暂停时长不计入亲喂',
  savedFeed.breast >= 1 && savedFeed.breast <= 3,
  JSON.stringify(savedFeed),
)

await goto(BASE + '/#/feed')
const afterCount = feedCount(await text('.feed-today__title'))
check('喂养中心次数与首页一致', afterCount === beforeCount + 1, `${afterCount}`)
const firstTitle = await text('.record__title')
check('新记录出现在历史顶部', firstTitle.includes('亲喂'), firstTitle)

// ---------- 5. 数据来源 ----------
// 本阶段后端只读：这里只是同一页面内的 hash 导航（不会重新请求），记录仍在内存中。
// 真实刷新会重新 GET /api/state 回到服务端基线，见 backend/README.md「这一阶段的边界」。
await goto(BASE + '/#/feed')
const reloadedCount = feedCount(await text('.feed-today__title'))
check('同页切换后记录仍在（内存态）', reloadedCount === afterCount, String(reloadedCount))

// ---------- 5. 编辑 ----------
await evaluate(`(() => {
  const el = document.querySelector('.record [aria-label="编辑记录"]')
  if (!el) return false
  el.click()
  return true
})()`)
await sleep(350)
const saveLabel = await text('.save-bar .btn')
check('编辑态改为「保存修改」', saveLabel.includes('保存修改'), saveLabel)
await clickText('保存修改')
await sleep(450)
const afterEdit = feedCount(await text('.feed-today__title'))
check('编辑后次数不变', afterEdit === afterCount, String(afterEdit))

// ---------- 6. 删除（二次确认） ----------
await evaluate(`(() => {
  const el = document.querySelector('.record [aria-label="删除记录"]')
  if (!el) return false
  el.click()
  return true
})()`)
await sleep(350)
const sheetTitle = await text('.sheet__title')
check('删除前有二次确认', sheetTitle.includes('删除这条喂养记录'), sheetTitle)
await clickText('删除', '.sheet .btn')
await sleep(600)
const afterDelete = feedCount(await text('.feed-today__title'))
check('删除后统计立即重算', afterDelete === beforeCount, String(afterDelete))
const deleteToast = await text('.toast')
check('删除后提示重算', deleteToast.includes('重新计算'), deleteToast)

// ---------- 7. 喂养记录二级界面 ----------
await goto(BASE + '/#/feed')
check('主页面只展示最近 3 条', (await evaluate(`document.querySelectorAll('.records .record').length`)) === 3, '')
check('记录标题右侧没有查看全部入口', (await evaluate(`!document.querySelector('.section-head__action')`)) === true, '')
await clickText('查看全部')
await sleep(500)
check('打开全部记录二级界面', (await evaluate(`!!document.querySelector('.history-screen')`)) === true, '')
const historyRows = await evaluate(`document.querySelectorAll('.history-screen .record').length`)
const historyTotal = Number((await text('.history-screen__sub')).match(/(\d+) 条/)?.[1] ?? 0)
check('二级界面展示全部记录', historyRows === historyTotal && historyRows > 3, `${historyRows} / ${historyTotal}`)
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
  nativeVirtualKeyCode: 27,
})
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
  nativeVirtualKeyCode: 27,
})
await sleep(350)
check('二级界面可用 Esc 关闭', (await evaluate(`!document.querySelector('.history-screen')`)) === true, '')
await clickText('查看全部')
await sleep(400)
await evaluate(`document.querySelector('.history-screen__head .icon-btn').click()`)
await sleep(350)
check('二级界面可返回', (await evaluate(`!document.querySelector('.history-screen')`)) === true, '')

// ---------- 8. 瓶喂记录真实时间（首页底部面板） ----------
await goto(BASE + '/#/home')
await sleep(350)
await evaluate(`document.querySelector('.quick__item[aria-label="快速记录喂奶"]').click()`)
await sleep(450)
await clickText('瓶喂母乳')
await sleep(300)
await evaluate(`(() => {
  const el = document.querySelector('.amount__input')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, '137')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return el.value
})()`)
await sleep(220)
const customBottle = await evaluate(`document.querySelector('.amount__input').value`)
check('瓶喂奶量可自定义输入', customBottle === '137', customBottle)
await sleep(150)
await evaluate(`(() => {
  const el = document.querySelector('.feed-time__input')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, '00:05')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return el.value
})()`)
await sleep(250)
await clickText('保存这次喂养')
await sleep(800)
await goto(BASE + '/#/feed')
await sleep(350)
await clickText('查看全部')
await sleep(500)
const timedTop = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.history-screen .record')].find((r) => r.textContent.includes('137 ml'))
  return row?.querySelector('.record__time')?.textContent ?? 'missing'
})()`)
check('瓶喂按填写时间记录', timedTop === '00:05', timedTop)
await evaluate(`document.querySelector('.history-screen__head .icon-btn').click()`)
await sleep(350)

// ---------- 9. 首页同步 ----------
await goto(BASE + '/#/home')
const expectedHome = beforeCount + 1
const homeCount = Number((await text('.overview__cell')).split('次')[0])
check('首页今日摘要与喂养页一致', homeCount === expectedHome, `${homeCount} / ${expectedHome}`)

// ---------- 10. 喂养面板保存后回到首页 ----------
await clickText('喂奶', '.quick__item')
await sleep(350)
check('喂养面板可直接填写', (await evaluate(`!!document.querySelector('.sheet .methods')`)) === true, '')
await clickText('配方奶')
await sleep(250)
await evaluate(`(() => {
  const el = document.querySelector('.sheet .amount__input')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, '88')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
await sleep(220)
const customFormula = await evaluate(`document.querySelector('.sheet .amount__input').value`)
check('配方奶奶量可自定义输入', customFormula === '88', customFormula)
await clickText('保存这次喂养')
await sleep(700)
check('喂养面板保存后回到首页', (await evaluate('location.hash')) === '#/home', await evaluate('location.hash'))
check('保存后喂养面板关闭', (await evaluate(`!document.querySelector('.sheet')`)) === true, '')
const quickHomeCount = Number((await text('.overview__cell')).split('次')[0])
check('喂养面板记录已计入首页', quickHomeCount === expectedHome + 1, `${quickHomeCount} / ${expectedHome + 1}`)

// ---------- 11. 二级页返回首页 ----------
await goto(BASE + '/#/feed')
await evaluate(`document.querySelector('.screen-head .icon-btn').click()`)
await sleep(400)
check('喂养中心返回首页', (await evaluate('location.hash')) === '#/home', await evaluate('location.hash'))
await evaluate(`document.querySelector('.quick__item[aria-label="快速记录喂奶"]').click()`)
await sleep(400)
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(350)
check('快速记录面板可关闭并留在首页', (await evaluate(`!document.querySelector('.sheet') && location.hash === '#/home'`)) === true, '')

// ---------- 12. 控制台错误 ----------
const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
check('页面无脚本崩溃', errors === 0, String(errors))

// 截图留档（删除后的喂养页）
await goto(BASE + '/#/feed')
await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-feed-after-delete.png', Buffer.from(shot.data, 'base64')),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0
