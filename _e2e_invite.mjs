// Family invite / join regression:
// A (demo) invites a read-only member, B registers, joins through the invite page,
// sees the same records, is blocked from writing, and sets an avatar that A can see.
// usage: node _e2e_invite.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const ORIGIN = new URL(BASE).origin
const AVATAR = join(process.cwd(), 'shots', 'final-home.png')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function launch(tag) {
  const port = 9700 + Math.floor(Math.random() * 200)
  const profile = mkdtempSync(join(tmpdir(), `nestory-invite-${tag}-`))
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
  await send('DOM.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true })
  try {
    await send('Browser.grantPermissions', {
      origin: ORIGIN,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
  } catch {
    /* clipboard grant is best-effort */
  }

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
  async function waitFor(expression, timeout = 8000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        const value = await evaluate(expression)
        if (value) return value
      } catch {
        /* retry */
      }
      await sleep(200)
    }
    return null
  }
  const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`)
  const clickText = (label, selector = 'button') =>
    evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(label)}))
      if (!el) return false
      el.click()
      return true
    })()`)
  async function reload() {
    await send('Page.reload', { ignoreCache: true })
    await sleep(600)
    for (let i = 0; i < 40; i += 1) {
      try {
        if (await evaluate(`!!document.querySelector('.app')`)) break
      } catch {
        /* still booting */
      }
      await sleep(150)
    }
    await sleep(300)
  }
  return {
    send,
    evaluate,
    goto,
    reload,
    waitFor,
    text,
    clickText,
    close() {
      ws.close()
      chrome.kill()
    },
  }
}

async function registerUser(nickname) {
  const email = `e2e_invite_${Date.now()}@nestory.local`
  const res = await fetch(`${ORIGIN}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'nestory123', nickname }),
  })
  if (!res.ok) throw new Error(`register failed: HTTP ${res.status} ${await res.text()}`)
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie')
  if (!raw) throw new Error('register returned no cookie')
  const cookie = raw.split(';')[0].slice('nestory_session='.length)
  // 新账号从「未完成引导」开始，先把引导标记为完成，才能进入二级页
  const stateRes = await fetch(`${ORIGIN}/api/state`, { headers: { Cookie: `nestory_session=${cookie}` } })
  const payload = await stateRes.json()
  const state = { ...payload.state, onboarded: true }
  const saveRes = await fetch(`${ORIGIN}/api/state`, {
    method: 'PUT',
    headers: { Cookie: `nestory_session=${cookie}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  })
  if (!saveRes.ok) throw new Error(`state seed failed: HTTP ${saveRes.status}`)
  return { email, cookie }
}

const a = await launch('a')
const { seedSession } = await import('./_login_session.mjs')
await seedSession(a.send, BASE)
const b = await launch('b')
const member = await registerUser('外婆')
await b.send('Network.enable')
await b.send('Network.setCookie', {
  name: 'nestory_session',
  value: member.cookie,
  url: ORIGIN,
  path: '/',
  httpOnly: true,
  secure: ORIGIN.startsWith('https:'),
})

try {
  // ---------- A: 入口收敛为一个「邀请家人」 ----------
  await a.goto(`${BASE}/#/profile`)
  // 上一轮跑测留下的成员会污染 demo 家庭，先清理成只有 demo 自己
  const before = await a.evaluate('fetch("/api/family").then((r) => r.json())')
  for (const stale of (before?.members ?? []).filter((m) => m.id !== before.me.userId)) {
    await a.evaluate(`fetch('/api/family/member/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: ${Number(stale.id)} }),
    }).then((r) => r.status)`)
  }
  await a.send('Page.reload', { ignoreCache: true })
  await sleep(900)
  check('我的家庭页打开', (await a.text('.screen-head__title')) === '我的家庭', await a.text('.screen-head__title'))
  check('右上角邀请按钮已移除', (await a.evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.replace(/\\s+/g, '').trim() === '邀请').length`)) === 0)
  check('家庭共享菜单已移除', !(await a.text('.page__body')).includes('家庭共享'))
  const inviteEntries = await a.evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.includes('邀请家人')).length`)
  check('只剩一个邀请入口', inviteEntries === 1, String(inviteEntries))

  await a.clickText('邀请家人')
  const inviteOpen = await a.waitFor(`location.hash.startsWith('#/invite') && !!document.querySelector('.screen-head__title')`)
  check('邀请家人是二级页', !!inviteOpen, await a.evaluate('location.hash'))
  check('邀请页标题', (await a.text('.screen-head__title')) === '邀请家人', await a.text('.screen-head__title'))

  await a.clickText('只读')
  await a.clickText('生成邀请链接')
  const link = await a.waitFor(`document.querySelector('input[aria-label="邀请链接"]')?.value || null`, 8000)
  check('生成邀请链接', typeof link === 'string' && link.includes('/#/join?t='), String(link))
  check('邀请权限为只读', (await a.text('.panel')).includes('只读'), '')
  const token = typeof link === 'string' ? (link.split('t=')[1] ?? '') : ''
  check('邀请 token 是 32 位', /^[0-9a-f]{32}$/.test(token), token)
  check('复制按钮存在', await a.clickText('复制链接'), '')
  await sleep(600)
  const toastNow = await a.text('.toast')
  check('复制后给出反馈', toastNow.includes('邀请链接已复制') || toastNow.includes('复制失败'), toastNow)

  // ---------- B: 通过邀请链接加入 ----------
  await b.goto(`${BASE}/#/join?t=${token}`)
  const joinTitle = await b.waitFor(`document.querySelector('.join-title')?.textContent || null`, 8000)
  check('加入页显示家庭名', typeof joinTitle === 'string' && joinTitle.length > 0, String(joinTitle))
  check('加入页标明邀请人', (await b.text('.page__body')).includes('邀请你一起记录'), '')
  check('加入页标明只读权限', (await b.text('.join-perm')).includes('只读'), await b.text('.join-perm'))
  await b.clickText('加入这个家庭')
  const joined = await b.waitFor(`(document.querySelector('.toast')?.textContent || '').includes('已加入这个家庭')`, 8000)
  check('加入后给出提示', !!joined, await b.text('.toast'))
  const bFamily = await b.evaluate('fetch("/api/family").then((r) => r.json())')
  check('B 看到的成员数是 2', bFamily?.members?.length === 2, String(bFamily?.members?.length))
  check('B 的权限是只读', bFamily?.me?.permission === 'read', String(bFamily?.me?.permission))
  const bHome = await b.evaluate(`location.hash`)
  check('加入后回到首页', bHome === '#/home', String(bHome))

  const blocked = await b.evaluate(`fetch('/api/state')
    .then((r) => r.json())
    .then((p) => fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: p.state }),
    }))
    .then(async (r) => ({ status: r.status, body: await r.text() }))`)
  check('只读成员写入被拒（403）', blocked?.status === 403, JSON.stringify(blocked))

  const cannotDelete = await b.evaluate(`fetch('/api/media/e2e-not-a-real-id', { method: 'DELETE' })
    .then(async (r) => ({ status: r.status, body: await r.text() }))`)
  check('只读成员删除照片被拒（403）', cannotDelete?.status === 403, JSON.stringify(cannotDelete))

  // ---------- B: 设置头像，A 端可见 ----------
  await b.goto(`${BASE}/#/profile`)
  await b.evaluate(`[...document.querySelectorAll('.family__item')].find((el) => el.textContent.includes('外婆'))?.click()`)
  await b.waitFor(`!!document.querySelector('input[aria-label="选择头像图片"]')`, 6000)
  const handle = await b.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="选择头像图片"]')
    input.dataset.e2e = 'avatar'
    return true
  })()`)
  check('成员卡里有头像选择入口', handle === true, '')
  const avatarNode = await b.send('Runtime.evaluate', {
    expression: `document.querySelector('input[data-e2e="avatar"]')`,
  })
  await b.send('DOM.setFileInputFiles', { files: [AVATAR], objectId: avatarNode.result.objectId })
  await b.evaluate(`(() => {
    const input = document.querySelector('input[data-e2e="avatar"]')
    input?.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(1200)
  const uploaded = await b.waitFor(`document.querySelector('img.family__avatar--img')?.src || null`, 20000)
  check('头像上传成功并显示', typeof uploaded === 'string' && uploaded.includes('/api/media/blob/'), `${uploaded} · toast=${await b.text('.toast')}`)
  await b.evaluate('document.querySelector(".sheet-backdrop")?.click()')
  await sleep(400)

  await a.goto(`${BASE}/?r=1#/profile`)
  await a.reload()
  const aSees = await a.waitFor(
    `[...document.querySelectorAll('.family__item')].find((el) => el.textContent.includes('外婆'))?.querySelector('img')?.src || null`,
    8000,
  )
  check('邀请人端看到被邀请人的头像', typeof aSees === 'string' && aSees.includes('/api/media/blob/'), String(aSees))

  // ---------- A: 改 B 为可编辑后写入放行 ----------
  const openCard = await a.clickText('外婆')
  const sheetShown = await a.waitFor(`document.querySelector('.sheet__title')?.textContent || null`, 5000)
  check('成员卡打开成员详情', !!openCard && sheetShown === '外婆', `${openCard} · ${sheetShown}`)
  const permClick = await a.clickText('可记录与编辑')
  await sleep(600)
  const promoted = await a.waitFor(
    `fetch('/api/family').then((r) => r.json()).then((p) => {
      const target = p.members.find((m) => m.name === '外婆')
      return target && target.permission === 'edit' ? 'edit' : null
    })`,
    10000,
  )
  check('管理员把 B 改为可编辑', promoted === 'edit', `${promoted} · click=${permClick} · toast=${await a.text('.toast')} · err=${await a.text('.perm-error')}`)
  await a.evaluate('document.querySelector(".sheet-backdrop")?.click()')
  await sleep(300)

  await b.goto(`${BASE}/#/profile`)
  const bPerm = await b.waitFor(`fetch('/api/family').then((r) => r.json()).then((p) => p.me.permission)`, 8000)
  check('B 权限已升级为 edit', bPerm === 'edit', String(bPerm))

  const errors = await a.evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`).catch(() => 0)
  check('页面无脚本崩溃', errors === 0, String(errors))

  // 收尾：把测试成员移出，避免污染后续 e2e 的 demo 家庭
  const familyNow = await a.evaluate('fetch("/api/family").then((r) => r.json())')
  for (const extra of (familyNow?.members ?? []).filter((m) => m.id !== familyNow.me.userId)) {
    await a.evaluate(`fetch('/api/family/member/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: ${Number(extra.id)} }),
    }).then((r) => r.status)`)
  }
  await a.reload()
  const cleaned = await a.evaluate('fetch("/api/family").then((r) => r.json()).then((p) => p.members.length)')
  check('测试成员已清理', cleaned === 1, String(cleaned))

  await a.goto(`${BASE}/#/profile`)
  await a.send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
    writeFileSync('shots/e2e-invite.png', Buffer.from(shot.data, 'base64')),
  )
} finally {
  a.close()
  b.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length ? 1 : 0
