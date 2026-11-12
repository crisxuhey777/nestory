// Shared helper for the browser checks: sign in through the real API and put the
// session cookie into the freshly launched Chrome profile.
const DEMO = { email: 'demo@nestory.local', password: 'nestory123' }

export async function seedSession(send, base) {
  const origin = new URL(base).origin
  const res = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(DEMO),
  })
  if (!res.ok) throw new Error(`demo sign-in failed: HTTP ${res.status}`)
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie')
  if (!raw) throw new Error('demo sign-in returned no cookie')
  const value = raw.split(';')[0].slice('nestory_session='.length)
  // 每个测试都从示例数据开始，避免上一次运行留下的改动影响断言
  const reset = await fetch(`${origin}/api/state/reset`, {
    method: 'POST',
    headers: { Cookie: `nestory_session=${value}` },
  })
  if (!reset.ok) throw new Error(`demo state reset failed: HTTP ${reset.status}`)
  await send('Network.enable')
  await send('Network.setCookie', {
    name: 'nestory_session',
    value,
    url: origin,
    path: '/',
    httpOnly: true,
    secure: origin.startsWith('https:'),
  })
  return value
}
