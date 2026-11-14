import { Fragment, useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import { NestoryLogo } from '../brand/Logo'
import { Sheet } from '../components/Sheet'
import { useStore } from '../data/store'
import { api } from '../data/api'
import { uploadAvatar } from '../lib/media'
import { ageBetween, ageLabel, fromISODate } from '../lib/date'
import { navigate } from '../lib/route'
import type { Route } from '../lib/route'
import type { FamilyMember } from '../data/types'
import { APP, PERMISSIONS, PROFILE_MENU } from '../data/config'

const PERMISSION_MAP = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission.key, permission]),
) as Record<FamilyMember['permission'], (typeof PERMISSIONS)[number]>

const PERMISSION_OPTIONS = PERMISSIONS.map((permission) => ({
  value: permission.key,
  label: permission.short,
  desc: permission.desc,
}))

export default function ProfilePage() {
  const { state, dispatch, toast } = useStore()
  const [privacy, setPrivacy] = useState(false)
  const [member, setMember] = useState<FamilyMember | null>(null)
  const [permError, setPermError] = useState('')
  const [removing, setRemoving] = useState<FamilyMember | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)

  const now = Date.now()
  const hasBirth = /^\d{4}-\d{2}-\d{2}$/.test(state.baby.birthday)
  const age = hasBirth ? ageBetween(new Date(fromISODate(state.baby.birthday, 6, 20)), new Date(now)) : null
  const viewerMember = state.family.find((m) => m.id === state.viewerId)
  const canManage = viewerMember?.permission === 'admin'

  const babyFacts = [
    state.baby.gender === 'girl' ? '女孩' : state.baby.gender === 'boy' ? '男孩' : '',
    state.baby.birthplace,
    state.baby.birthWeightKg > 0 ? `出生 ${state.baby.birthWeightKg} kg` : '',
    state.baby.birthHeightCm > 0 ? `${state.baby.birthHeightCm} cm` : '',
  ].filter(Boolean)

  const changePermission = async (next: FamilyMember['permission']) => {
    if (!member || member.permission === next) return
    if (!canManage) {
      setPermError('只有家庭管理员可以修改成员权限')
      return
    }
    const admins = state.family.filter((m) => m.permission === 'admin')
    if (member.permission === 'admin' && next !== 'admin' && admins.length <= 1) {
      setPermError('至少要保留一位家庭管理员')
      return
    }
    try {
      await api.updateMember(member.id, next)
    } catch (error) {
      setPermError(error instanceof Error ? error.message : '权限没有保存，请稍后再试')
      return
    }
    dispatch({ type: 'updateFamilyMember', id: member.id, patch: { permission: next } })
    setMember({ ...member, permission: next })
    setPermError('')
    toast(`已把${member.name}的权限改为「${PERMISSION_OPTIONS.find((o) => o.value === next)?.label}」`)
  }

  const removeMember = async () => {
    if (!removing) return
    if (!canManage) {
      toast('只有家庭管理员可以移出成员')
      return
    }
    if (removing.id === state.viewerId) {
      toast('不能移出当前登录的账号')
      return
    }
    const admins = state.family.filter((m) => m.permission === 'admin')
    if (removing.permission === 'admin' && admins.length <= 1) {
      toast('至少要保留一位家庭管理员')
      return
    }
    try {
      await api.removeMember(removing.id)
    } catch (error) {
      toast(error instanceof Error ? error.message : '移出失败，请稍后再试')
      return
    }
    dispatch({ type: 'removeFamilyMember', id: removing.id })
    toast(`${removing.name} 已移出家庭`)
    setRemoving(null)
  }

  const pickAvatar = async (file: File | undefined) => {
    if (!file || avatarBusy) return
    setAvatarBusy(true)
    try {
      const url = await uploadAvatar(file)
      dispatch({ type: 'updateFamilyMember', id: state.viewerId, patch: { avatarUrl: url } })
      toast('头像已更新')
    } catch (error) {
      toast(error instanceof Error ? error.message : '头像上传失败')
    } finally {
      setAvatarBusy(false)
      if (avatarRef.current) avatarRef.current.value = ''
    }
  }

  const canDelete = state.family.some((m) => m.id === state.viewerId && m.permission === 'admin')

  const menuActions: Record<(typeof PROFILE_MENU)[number]['key'], () => void> = {
    settings: () => navigate('settings'),
    reminders: () => navigate('reminders'),
    privacy: () => setPrivacy(true),
    about: () => navigate('about' as Route),
  }

  const rows = PROFILE_MENU.map((item) => ({
    ...item,
    sub:
      item.key === 'reminders'
        ? state.reminder.enabled
          ? `每 ${state.reminder.intervalMinutes / 60} 小时 · 夜间安静`
          : '当前已关闭'
        : item.sub,
    value:
      item.key === 'reminders'
        ? state.reminder.enabled
          ? '已开启'
          : '已关闭'
        : undefined,
    onClick: menuActions[item.key],
  }))

  return (
    <div className="page">
      <header
        className="screen-head"
        style={{ alignItems: 'flex-end', paddingTop: 'calc(20px + env(safe-area-inset-top))' }}
      >
        <div>
          <div className="eyebrow" style={{ fontSize: 'calc(9px * var(--type-scale, 1))', marginBottom: 5 }}>
            Nestory Family
          </div>
          <h1 className="screen-head__title" style={{ fontSize: 'calc(21px * var(--type-scale, 1))' }}>
            我的家庭
          </h1>
        </div>
      </header>

      <div className="page__body">
        <section className="profile-hero">
          <img
            className="profile-hero__avatar"
            src={state.baby.avatar || '/brand/app-icon-180.png'}
            alt={state.baby.name || '宝宝头像'}
          />
          <div className="profile-hero__main">
            <div className="profile-hero__name">{state.baby.name || '还没有宝宝资料'}</div>
            <div className="profile-hero__meta">
              {age
                ? `${ageLabel(age)} · ${state.baby.birthday.replace(/-/g, '.')}${state.baby.birthTime ? ` ${state.baby.birthTime}` : ''} 出生`
                : '点右侧铅笔，填上昵称和生日'}
            </div>
            {age ? (
              <span className="profile-hero__badge">
                <Icon name="sparkle" size={10} />
                已珍藏 {age.totalDays} 天
              </span>
            ) : null}
          </div>
          <button className="profile-hero__edit" aria-label="编辑宝宝资料" onClick={() => navigate('baby')}>
            <Icon name="edit" size={14} />
          </button>
        </section>

        {babyFacts.length ? <p className="profile-hint">{babyFacts.join(' · ')}</p> : null}

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            家庭成员 · {state.family.length}
          </div>
          {state.family.length ? (
            <>
              <div className="family">
                {state.family.map((m) => (
                  <button key={m.id} type="button" className="family__item" onClick={() => { setPermError(''); setMember(m) }}>
                    {m.avatarUrl ? (
                      <img className="family__avatar family__avatar--img" src={m.avatarUrl} alt="" />
                    ) : (
                      <span className="family__avatar" style={{ background: m.color }}>
                        {m.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="family__name">{m.name}</span>
                  </button>
                ))}
                {canManage ? (
                  <button className="family__item" onClick={() => navigate('invite', 'profile')}>
                    <span className="family__add">
                      <Icon name="plus" size={15} />
                    </span>
                    <span className="family__name">邀请家人</span>
                  </button>
                ) : null}
              </div>
              <p className="timer__hint" style={{ textAlign: 'left', marginTop: 12 }}>
                {canManage
                  ? '点头像可调整权限或更换自己的头像 · 长辈可以设为只读，看得见，也不必担心误改。'
                  : '只有家庭管理员可以调整成员权限。'}
              </p>
            </>
          ) : (
            <div className="empty">
              <p>还没有家庭成员</p>
              <button className="btn btn--quiet" type="button" onClick={() => navigate('invite', 'profile')}>
                邀请家人
              </button>
            </div>
          )}
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>
            Settings
          </div>
          <div className="settings">
            {rows.map((r) => (
              <Fragment key={r.title}>
                {r.key === 'about' && canDelete ? (
                  <button className="setting" onClick={() => navigate('trash', 'profile')}>
                    <span className="setting__icon">
                      <Icon name="trash" size={18} />
                    </span>
                    <span className="setting__main">
                      <span className="setting__title">最近删除</span>
                      <span className="setting__sub" style={{ display: 'block' }}>
                        7 天内可恢复 · 仅管理员
                      </span>
                    </span>
                    <span className="setting__value">
                      <Icon name="chevronRight" size={12} />
                    </span>
                  </button>
                ) : null}
                <button className="setting" onClick={r.onClick}>
                  <span className="setting__icon">
                    <Icon name={r.icon} size={18} />
                  </span>
                  <span className="setting__main">
                    <span className="setting__title">{r.title}</span>
                    <span className="setting__sub" style={{ display: 'block' }}>
                      {r.sub}
                    </span>
                  </span>
                  <span className="setting__value">
                    {r.value}
                    <Icon name="chevronRight" size={12} />
                  </span>
                </button>
              </Fragment>
            ))}
          </div>
        </section>

        <div className="sync-chip">
          <span className="sync-chip__dot" />
          已登录 · 记录会自动保存
        </div>

        <div className="brand-foot">
          <div className="brand-foot__logo">
            <NestoryLogo size={24} descriptor />
          </div>
          <p className="brand-foot__tag">{APP.tagline}</p>
          <p className="brand-foot__tag" style={{ fontFamily: 'var(--font-sans)', fontStyle: 'normal', marginTop: 4 }}>
            {APP.taglineZh}
          </p>
          <p className="brand-foot__ver">NESTORY V{APP.version} · {APP.year}</p>
        </div>
      </div>

      <Sheet
        open={member !== null}
        onClose={() => { setMember(null); setPermError('') }}
        title={member ? member.name : '家庭成员'}
        desc={canManage ? '管理员可以调整每位家人的权限，其他成员只能查看。' : '只有家庭管理员可以调整成员权限。'}
        footer={
          member ? (
            member.id === state.viewerId ? (
              <p className="timer__hint" style={{ textAlign: 'center', margin: 0 }}>
                这是当前登录的账号，不能移出自己。
              </p>
            ) : canManage ? (
              <button
                className="btn btn--danger btn--full"
                onClick={() => {
                  setRemoving(member)
                  setMember(null)
                }}
              >
                移出家庭
              </button>
            ) : (
              <p className="timer__hint" style={{ textAlign: 'center', margin: 0 }}>
                只有家庭管理员可以移出成员。
              </p>
            )
          ) : null
        }
      >
        {member ? (
          <>
            <div className="member-card">
              {member.avatarUrl ? (
                <img className="family__avatar family__avatar--img" src={member.avatarUrl} alt="" />
              ) : (
                <span className="family__avatar" style={{ background: member.color, width: 54, height: 54, fontSize: 'calc(18px * var(--type-scale, 1))' }}>
                  {member.name.slice(0, 1)}
                </span>
              )}
              <div>
                <div className="switch-row__title">{member.role}</div>
                <div className="switch-row__sub">{PERMISSION_MAP[member.permission].label}</div>
                {member.id === state.viewerId ? (
                  <button
                    className="avatar-edit"
                    type="button"
                    disabled={avatarBusy}
                    onClick={() => avatarRef.current?.click()}
                  >
                    {avatarBusy ? '正在上传…' : member.avatarUrl ? '更换头像' : '设置头像'}
                  </button>
                ) : null}
              </div>
            </div>
            <input
              ref={avatarRef}
              className="sr-only"
              type="file"
              accept="image/*"
              aria-label="选择头像图片"
              onChange={(event) => void pickAvatar(event.target.files?.[0])}
            />

            {canManage ? (
              <div className="perm-block">
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  权限 · 仅家庭管理员可修改
                </div>
                <div className="perm-list">
                  {PERMISSION_OPTIONS.map((option) => {
                    const on = member.permission === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`perm${on ? ' perm--on' : ''}`}
                        onClick={() => changePermission(option.value)}
                        aria-pressed={on}
                      >
                        <span className="perm__mark">{on ? <Icon name="check" size={11} /> : null}</span>
                        <span className="perm__text">
                          <span className="perm__label">{option.label}</span>
                          <span className="perm__desc">{option.desc}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {permError ? (
                  <p className="perm-error" role="status">
                    {permError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="timer__hint" style={{ marginTop: 18 }}>
                你当前是「{PERMISSION_MAP[member.permission].label}」，只有家庭管理员可以调整权限。
              </p>
            )}
          </>
        ) : null}
        <p className="about-note" style={{ textAlign: 'left' }}>
          移出后，这位家人将无法再查看新的记录与照片；已经留下的记录会保留在这个家里。
        </p>
      </Sheet>

      <Sheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `将 ${removing.name} 移出家庭？` : '移出家庭'}
        desc="这个操作不会删除任何已有的喂养、睡眠与照片记录。"
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn--quiet" style={{ flex: 1 }} onClick={() => setRemoving(null)}>
              保留
            </button>
            <button
              className="btn btn--danger"
              style={{ flex: 1 }}
              onClick={() => void removeMember()}
            >
              确认移出
            </button>
          </div>
        }
      >
        <p className="about-copy" style={{ marginBottom: 0 }}>
          如果只是暂时不想让长辈看到，也可以把权限改为只读，不必移出家庭。
        </p>
      </Sheet>

      <Sheet
        open={privacy}
        onClose={() => setPrivacy(false)}
        title="隐私与安全"
        desc="Nestory 把家庭记忆当作需要被认真保管的东西。"
        footer={
          <button className="btn btn--primary btn--full" onClick={() => setPrivacy(false)}>
            我知道了
          </button>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          {[
            ['仅家庭可见', '所有照片与记录默认仅家庭成员可见，不进入任何公开推荐。'],
            ['不用于训练', '宝宝的影像与文字不会被用于模型训练或广告投放。'],
            ['随时导出', '成长数据与相册支持导出，也可以随时彻底删除。'],
          ].map(([t, d]) => (
            <div key={t} style={{ display: 'flex', gap: 10 }}>
              <span className="setting__icon" style={{ flex: 'none' }}>
                <Icon name="shield" size={17} />
              </span>
              <div>
                <div className="switch-row__title">{t}</div>
                <div className="switch-row__sub">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  )
}
