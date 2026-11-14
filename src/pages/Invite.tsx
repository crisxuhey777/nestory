import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { PERMISSIONS } from '../data/config'
import { api } from '../data/api'
import type { InvitePayload, Permission } from '../data/api'
import { useStore } from '../data/store'
import { navigate } from '../lib/route'

const PERMISSION_LABEL = Object.fromEntries(
  PERMISSIONS.map((item) => [item.key, item.short]),
) as Record<Permission, string>

const PERMISSION_HINT = Object.fromEntries(
  PERMISSIONS.map((item) => [item.key, item.desc]),
) as Record<Permission, string>

/** 可邀请的权限：默认「可记录与编辑」，也允许管理员与只读。 */
const INVITE_OPTIONS: Permission[] = ['edit', 'read', 'admin']

function inviteLink(token: string): string {
  const base = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '')
  return `${base}/#/join?t=${token}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走兜底
  }
  try {
    const input = document.createElement('textarea')
    input.value = text
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(input)
    return ok
  } catch {
    return false
  }
}

export default function InvitePage() {
  const { state, toast } = useStore()
  const [permission, setPermission] = useState<Permission>('edit')
  const [invite, setInvite] = useState<InvitePayload | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const me = state.family.find((m) => m.id === state.viewerId)
  const isAdmin = me?.permission === 'admin'
  const link = useMemo(() => (invite ? inviteLink(invite.token) : ''), [invite])

  useEffect(() => {
    document.title = '邀请家人 · Nestory'
  }, [])

  const generate = async () => {
    if (busy) return
    setBusy(true)
    try {
      const next = await api.createInvite(permission)
      setInvite(next)
      window.setTimeout(() => inputRef.current?.select(), 60)
    } catch (error) {
      toast(error instanceof Error ? error.message : '邀请链接生成失败')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!link) return
    if (await copyText(link)) {
      toast('邀请链接已复制，发给家人即可')
      return
    }
    toast('复制失败，长按链接手动复制')
    inputRef.current?.select()
  }

  const share = async () => {
    if (!link) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: '加入我的 Nestory 家庭',
          text: '一起记录宝宝的成长，邀请 7 天内有效。',
          url: link,
        })
        return
      } catch {
        // 用户取消分享或系统不支持，退回复制
      }
    }
    await copy()
  }

  return (
    <div className="page page--sub">
      <ScreenHead title="邀请家人" sub="FAMILY INVITE" back="profile" />
      <div className="page__body" style={{ paddingBottom: 56 }}>
        <p className="about-copy" style={{ marginTop: 4 }}>
          家是几个人一起记得的地方。邀请一位家人，你们会看到同一份喂养、睡眠与照片记录。
        </p>

        {isAdmin ? (
          <>
            <section className="panel" style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                家人可以做什么
              </div>
              <div className="perm-list">
                {INVITE_OPTIONS.map((key) => {
                  const on = permission === key
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`perm${on ? ' perm--on' : ''}`}
                      onClick={() => setPermission(key)}
                      aria-pressed={on}
                    >
                      <span className="perm__mark">{on ? <Icon name="check" size={11} /> : null}</span>
                      <span className="perm__text">
                        <span className="perm__label">{PERMISSION_LABEL[key]}</span>
                        <span className="perm__desc">{PERMISSION_HINT[key]}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            {invite ? (
              <section className="panel" style={{ marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>
                  邀请链接 · 7 天内有效，只能用一次
                </div>
                <input
                  ref={inputRef}
                  className="input"
                  readOnly
                  value={link}
                  aria-label="邀请链接"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <div className="invite-actions">
                  <button className="btn btn--quiet" type="button" onClick={() => void copy()}>
                    复制链接
                  </button>
                  <button className="btn btn--primary" type="button" onClick={() => void share()}>
                    分享给家人
                  </button>
                </div>
                <p className="timer__hint" style={{ textAlign: 'left', marginTop: 10 }}>
                  {PERMISSION_LABEL[invite.permission]} · 家人打开链接、注册并确认后就会加入这个家。
                </p>
              </section>
            ) : (
              <button
                className="btn btn--primary btn--full"
                style={{ marginTop: 18 }}
                type="button"
                disabled={busy}
                onClick={() => void generate()}
              >
                {busy ? '正在生成…' : '生成邀请链接'}
              </button>
            )}
          </>
        ) : (
          <div className="panel" style={{ marginTop: 14 }}>
            <p className="about-copy" style={{ margin: 0 }}>
              只有家庭管理员可以邀请家人。需要新的成员时，请让管理员打开这一页。
            </p>
          </div>
        )}

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            当前成员 · {state.family.length}
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {state.family.map((member) => (
              <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {member.avatarUrl ? (
                  <img className="family__avatar family__avatar--img" src={member.avatarUrl} alt="" />
                ) : (
                  <span className="family__avatar" style={{ background: member.color }}>
                    {member.name.slice(0, 1)}
                  </span>
                )}
                <div style={{ flex: 1 }}>
                  <div className="switch-row__title">
                    {member.name}
                    {member.id === state.viewerId ? '（我）' : ''}
                  </div>
                  <div className="switch-row__sub">{PERMISSION_LABEL[member.permission]}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <button
          className="btn btn--quiet btn--full"
          style={{ marginTop: 20 }}
          type="button"
          onClick={() => navigate('profile')}
        >
          回到我的家庭
        </button>
      </div>
    </div>
  )
}
