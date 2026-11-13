import { seedSession } from './_login_session.mjs'
// Album lightbox checks: swipe, arrows, keyboard, wrap-around.
// usage: node _e2e_lightbox.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.argv[2] ?? 'http://localhost:5178'
const port = 10130 + Math.floor(Math.random() * 40)
const profile = mkdtempSync(join(tmpdir(), 'nestory-lightbox-'))

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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` Ã¢â‚¬â€ ${detail}` : ''}`)
}

async function click(selector, index = 0) {
  const ok = await evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!ok) throw new Error(`not found: ${selector}[${index}]`)
  await sleep(450)
}

async function counter() {
  return evaluate(`document.querySelector('.lightbox__count')?.textContent.trim() ?? ''`)
}

async function swipe(fromX, toX) {
  const rect = await evaluate(`(() => {
    const r = document.querySelector('.lightbox').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })()`)
  const y = Math.round(rect.y + Math.min(rect.h * 0.22, 130))
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] })
  const steps = 5
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(fromX + ((toX - fromX) * i) / steps), y }],
    })
    await sleep(30)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(500)
}

async function mouseSwipe(fromX, toX) {
  const y = 430
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 5; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(fromX + ((toX - fromX) * i) / 5),
      y,
      button: 'left',
      buttons: 1,
    })
    await sleep(30)
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(500)
}

async function tap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await sleep(30)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(40)
}

async function photoTransform() {
  return evaluate(`document.querySelector('.lightbox__photo')?.style.transform ?? ''`)
}

async function photoScale() {
  const transform = await photoTransform()
  const match = transform.match(/scale\(([\d.]+)/)
  return match ? Number(match[1]) : 1
}

async function pinchOut() {
  const y = 430
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 170, y, id: 1 },
      { x: 260, y, id: 2 },
    ],
  })
  for (let i = 1; i <= 5; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 170 - i * 12, y, id: 1 },
        { x: 260 + i * 12, y, id: 2 },
      ],
    })
    await sleep(35)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(300)
}

await send('Page.navigate', { url: `${BASE}/#/album` })
await sleep(2000)

check(
  'grid cards expose photo tones',
  (await evaluate(
    `[...document.querySelectorAll('.album-card')].every((el) => ['light', 'dark'].includes(el.dataset.photoInk))`,
  )) === true,
)

await click('.album-card', 1)
check('lightbox opens with counter', (await counter()) === '2 / 5', await counter())
check('arrows exist', (await evaluate(`document.querySelectorAll('.lightbox__nav').length`)) === 2)

await swipe(340, 80)
check('swipe left goes to next photo', (await counter()) === '3 / 5', await counter())
check('next item is the video', (await evaluate(`!!document.querySelector('.lightbox video[controls]')`)) === true)
check(
  'video caption keeps fixed chrome',
  (await evaluate(`document.querySelector('.lightbox__cap--video')?.dataset.photoInk ?? ''`)) === '',
  await evaluate(`document.querySelector('.lightbox__cap--video')?.dataset.photoInk ?? ''`),
)
check('lightbox stays open after swipe', (await evaluate(`!!document.querySelector('.lightbox')`)) === true)
check('slide-in animation direction', (await evaluate(`!!document.querySelector('.lightbox__slide--next')`)) === true)
check(
  'video caption clears the native controls',
  (await evaluate(
    `Math.round(window.innerHeight - document.querySelector('.lightbox__cap--video').getBoundingClientRect().bottom) >= 45`,
  )) === true,
  await evaluate(
    `Math.round(window.innerHeight - document.querySelector('.lightbox__cap--video').getBoundingClientRect().bottom)`,
  ),
)
await sleep(320)
await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/final-lightbox-video.png', Buffer.from(shot.data, 'base64')),
)

await swipe(340, 80)
check('swipe also works on video', (await counter()) === '4 / 5', await counter())
await click('.lightbox__nav--prev')
check('video back to video', (await counter()) === '3 / 5', await counter())
await click('.lightbox__nav--prev')
check('prev slide-in animation', (await evaluate(`!!document.querySelector('.lightbox__slide--prev')`)) === true)
check('prev arrow returns to photo', (await counter()) === '2 / 5', await counter())

await mouseSwipe(340, 80)
check('mouse drag also changes photo', (await counter()) === '3 / 5', await counter())
await click('.lightbox__nav--prev')
check('back to photo for zoom tests', (await counter()) === '2 / 5', await counter())

await tap(215, 430)
await sleep(80)
await tap(215, 430)
await sleep(350)
check('double tap zooms to 2x', (await photoTransform()).includes('scale(2)'), await photoTransform())
await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((shot) =>
  writeFileSync('shots/final-lightbox-zoom.png', Buffer.from(shot.data, 'base64')),
)

await swipe(340, 80)
check('swipe is locked while zoomed', (await counter()) === '2 / 5', await counter())
check('zoom survives locked swipe', (await photoTransform()).includes('scale(2)'), await photoTransform())

await tap(215, 430)
await sleep(80)
await tap(215, 430)
await sleep(350)
check('double tap returns to 1x', (await photoTransform()).includes('scale(1)'), await photoTransform())

await tap(215, 430)
await sleep(400)
check('single tap hides caption chrome', (await evaluate(`!!document.querySelector('.lightbox--bare')`)) === true, '')
await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((shot) =>
  writeFileSync('shots/final-lightbox-bare.png', Buffer.from(shot.data, 'base64')),
)
await tap(215, 430)
await sleep(400)
check('second tap restores chrome', (await evaluate(`!!document.querySelector('.lightbox--bare')`)) === false, '')

await pinchOut()
check('pinch zooms in', (await photoScale()) >= 1.5, String(await photoScale()))
await tap(215, 430)
await sleep(80)
await tap(215, 430)
await sleep(350)
check('double tap resets pinch', (await photoScale()) === 1, String(await photoScale()))

await swipe(80, 340)
check('swipe right goes back', (await counter()) === '1 / 5', await counter())

await click('.lightbox__nav--next')
check('next arrow works', (await counter()) === '2 / 5', await counter())

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
await sleep(400)
check('keyboard right works', (await counter()) === '3 / 5', await counter())

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(400)
check('escape closes', (await evaluate(`!!document.querySelector('.lightbox')`)) === false)

// the lightbox is a bounded strip: first and last do not wrap around
await evaluate(`document.querySelectorAll('.album-card')[0].click()`)
await sleep(350)
check('first grid photo opens at 1 / 5', (await counter()) === '1 / 5', await counter())
check('no previous arrow at the first photo', (await evaluate(`document.querySelectorAll('.lightbox__nav--prev').length`)) === 0, '')
await swipe(60, 340)
check('swiping back at the first stays at 1 / 5', (await counter()) === '1 / 5', await counter())
await click('.lightbox__close')

await click('.album-card--more')
await sleep(350)
check('more opens the full photo page', (await evaluate(`!!document.querySelector('.album-all')`)) === true, '')
await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((shot) =>
  writeFileSync('shots/final-album-all.png', Buffer.from(shot.data, 'base64')),
)
await evaluate(`[...document.querySelectorAll('.album-all .album-card')].at(-1).click()`)
await sleep(350)
check('last grid photo opens at 5 / 5', (await counter()) === '5 / 5', await counter())
check('no next arrow at the last photo', (await evaluate(`document.querySelectorAll('.lightbox__nav--next').length`)) === 0, '')
await swipe(340, 60)
check('swiping on at the last stays at 5 / 5', (await counter()) === '5 / 5', await counter())
await click('.lightbox__close')
await sleep(250)
await click('.album-all__head .icon-btn')
await sleep(300)
check('full page back returns to the tab', (await evaluate(`!!document.querySelector('.album-all')`)) === false, '')

// the cover opens as a single photo, with no lateral navigation
await click('.album-cover')
await sleep(300)
check('cover opens at 1 / 1', (await counter()) === '1 / 1', await counter())
check(
  'cover exposes a photo tone',
  ['light', 'dark'].includes(await evaluate(`document.querySelector('.album-cover')?.dataset.photoInk ?? ''`)),
  await evaluate(`document.querySelector('.album-cover')?.dataset.photoInk ?? ''`),
)
check('cover has no arrows', (await evaluate(`document.querySelectorAll('.lightbox__nav').length`)) === 0, '')
check(
  'single-photo caption has a photo tone',
  ['light', 'dark'].includes(
    await evaluate(`document.querySelector('.lightbox__cap')?.dataset.photoInk ?? ''`),
  ),
  await evaluate(`document.querySelector('.lightbox__cap')?.dataset.photoInk ?? ''`),
)
await swipe(60, 340)
check('cover swipe stays at 1 / 1', (await counter()) === '1 / 1', await counter())
await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((shot) =>
  writeFileSync('shots/final-lightbox.png', Buffer.from(shot.data, 'base64')),
)
await click('.lightbox__close')

const tones = await evaluate(`(async () => {
  const mod = await import('/src/lib/photoTone.ts')
  const make = async (fill) => {
    const img = new Image()
    img.src = 'data:image/svg+xml,' + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='" + fill + "'/></svg>"
    )
    img.style.cssText = 'position:fixed;left:-200px;top:0;width:96px;height:96px'
    document.body.appendChild(img)
    await img.decode()
    const ink = await mod.readPhotoInk(img)
    img.remove()
    return ink
  }
  return { white: await make('white'), black: await make('black') }
})()`)
check('light image uses dark type', tones.white === 'dark', String(tones.white))
check('dark image uses light type', tones.black === 'light', String(tones.black))

const errors = await evaluate(`window.__nestoryErrors ? window.__nestoryErrors.length : 0`)
const errorText = await evaluate(`JSON.stringify(window.__nestoryErrors || [])`)
check('no runtime errors', errors === 0, errorText)

await send('Page.captureScreenshot', { format: 'png' }).then((shot) =>
  writeFileSync('shots/e2e-lightbox.png', Buffer.from(shot.data, 'base64')),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
ws.close()
chrome.kill()
process.exitCode = failed.length ? 1 : 0



