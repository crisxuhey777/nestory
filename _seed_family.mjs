// Shared helper: give the demo household a second member so e2e checks that
// exercise member permissions / removal keep working now that family members are
// real accounts instead of fixture rows.
const DEMO = { email: 'demo@nestory.local', password: 'nestory123' }

function cookieOf(res) {
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie')
  if (!raw) throw new Error('no session cookie in response')
  return raw.split(';')[0]
}

export async function seedDemoMember(origin, nickname = '爸爸') {
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(DEMO),
  })
  if (!login.ok) throw new Error(`demo sign-in failed: HTTP ${login.status}`)
  const demoCookie = cookieOf(login)

  // 清掉上一轮遗留的成员，保证成员数可预测
  const family = await (await fetch(`${origin}/api/family`, { headers: { Cookie: demoCookie } })).json()
  for (const member of family.members ?? []) {
    if (member.id === family.me.userId) continue
    await fetch(`${origin}/api/family/member/remove`, {
      method: 'POST',
      headers: { Cookie: demoCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: Number(member.id) }),
    })
  }

  const invite = await fetch(`${origin}/api/family/invite`, {
    method: 'POST',
    headers: { Cookie: demoCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ permission: 'edit' }),
  })
  if (!invite.ok) throw new Error(`invite failed: HTTP ${invite.status}`)
  const { token } = await invite.json()

  const email = `e2e_member_${Date.now()}@nestory.local`
  const register = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'nestory123', nickname }),
  })
  if (!register.ok) throw new Error(`member register failed: HTTP ${register.status}`)
  const memberCookie = cookieOf(register)

  const join = await fetch(`${origin}/api/family/join`, {
    method: 'POST',
    headers: { Cookie: memberCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!join.ok) throw new Error(`member join failed: HTTP ${join.status}`)
  return { email, nickname }
}
