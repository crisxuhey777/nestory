// Run every browser check in this folder and print one summary.
// usage: node _e2e_all.mjs [baseUrl]
//
// 需要：dev server（默认 http://localhost:5178）、本机 Chrome、可登录的 demo 账号。
// 每个脚本自己会重置 demo 的状态，所以跑完 demo 账号回到示例数据。
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5178'

const scripts = readdirSync('.')
  .filter((name) => /^_e2e_.*\.mjs$/.test(name) && name !== '_e2e_all.mjs')
  .sort()

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [file, BASE], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      out += chunk
    })
    child.on('close', (code) => {
      const tail = out.trim().split('\n').slice(-3).join(' · ')
      resolve({ file, code, tail })
    })
  })

const started = Date.now()
const results = []
for (const file of scripts) {
  process.stdout.write(`→ ${file} … `)
  const result = await run(file)
  results.push(result)
  console.log(result.code === 0 ? 'ok' : `FAIL (exit ${result.code})`)
  if (result.code !== 0) console.log(`   ${result.tail}`)
}

const failed = results.filter((r) => r.code !== 0)
const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\n${results.length - failed.length}/${results.length} 套通过 · ${seconds}s`)
if (failed.length) {
  console.log('失败：')
  for (const item of failed) console.log(`- ${item.file}: ${item.tail}`)
  process.exit(1)
}
