import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Icon } from '../brand/icons'
import { NestoryLogo } from '../brand/Logo'
import { Sheet } from '../components/Sheet'
import { useStore } from '../data/store'
import { ageBetween, ageLabel, fromISODate, relativeFromNow, timeHM, toISODate } from '../lib/date'
import { navigate } from '../lib/route'
import type { Route } from '../lib/route'
import type { Baby, FamilyMember } from '../data/types'
import { APP, PERMISSIONS, PROFILE_MENU } from '../data/config'

type BabyForm = {
  name: string
  birthday: string
  birthTime: string
  gender: Baby['gender']
  birthWeightKg: string
  birthHeightCm: string
  birthHeadCm: string
  birthplace: string
  avatar: string
}

function toForm(baby: Baby): BabyForm {
  return {
    name: baby.name,
    birthday: baby.birthday,
    birthTime: baby.birthTime,
    gender: baby.gender,
    birthWeightKg: String(baby.birthWeightKg),
    birthHeightCm: String(baby.birthHeightCm),
    birthHeadCm: String(baby.birthHeadCm),
    birthplace: baby.birthplace,
    avatar: baby.avatar,
  }
}

const PERMISSION_MAP = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission.key, permission]),
) as Record<FamilyMember['permission'], (typeof PERMISSIONS)[number]>

const PERMISSION_OPTIONS = PERMISSIONS.map((permission) => ({
  value: permission.key,
  label: permission.short,
  desc: permission.desc,
}))

async function fileToAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = url
    })
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    const scale = Math.max(size / img.width, size / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    return canvas.toDataURL('image/jpeg', 0.84)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function ProfilePage() {
  const { state, dispatch, toast, user, signOut } = useStore()
  const [share, setShare] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [babyOpen, setBabyOpen] = useState(false)
  const [form, setForm] = useState<BabyForm>(() => toForm(state.baby))
  const [member, setMember] = useState<FamilyMember | null>(null)
  const [removing, setRemoving] = useState<FamilyMember | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const now = Date.now()
  const age = ageBetween(new Date(fromISODate(state.baby.birthday, 6, 20)), new Date(now))

  const openBaby = () => {
    setForm(toForm(state.baby))
    setBabyOpen(true)
  }

  const saveBaby = () => {
    const name = form.name.trim()
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(form.birthday) || !/^\d{2}:\d{2}$/.test(form.birthTime)) {
      toast('请填写昵称、生日和出生时间')
      return
    }
    const birthTs = Date.parse(`${form.birthday}T00:00:00`)
    if (!Number.isFinite(birthTs) || birthTs > Date.now()) {
      toast('出生日期不能晚于今天')
      return
    }
    const num = (v: string, fallback: number) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? n : fallback
    }
    dispatch({
      type: 'updateBaby',
      baby: {
        name,
        birthday: form.birthday,
        birthTime: form.birthTime,
        gender: form.gender,
        birthWeightKg: num(form.birthWeightKg, state.baby.birthWeightKg),
        birthHeightCm: num(form.birthHeightCm, state.baby.birthHeightCm),
        birthHeadCm: num(form.birthHeadCm, state.baby.birthHeadCm),
        birthplace: form.birthplace.trim() || state.baby.birthplace,
        avatar: form.avatar,
      },
    })
    setBabyOpen(false)
    toast('宝宝资料已更新')
  }

  const onAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('请选择一张照片')
      return
    }
    try {
      const avatar = await fileToAvatar(file)
      setForm((prev) => ({ ...prev, avatar }))
    } catch {
      toast('这张照片读不出来，换一张试试')
    }
  }

  const changePermission = (next: FamilyMember['permission']) => {
    if (!member || member.permission === next) return
    const admins = state.family.filter((m) => m.permission === 'admin')
    if (member.permission === 'admin' && next !== 'admin' && admins.length <= 1) {
      toast('至少要保留一位家庭管理员')
      return
    }
    dispatch({ type: 'updateFamilyMember', id: member.id, patch: { permission: next } })
    setMember({ ...member, permission: next })
    toast(`已把${member.name}的权限改为「${PERMISSION_OPTIONS.find((o) => o.value === next)?.label}」`)
  }

  const menuActions: Record<(typeof PROFILE_MENU)[number]['key'], () => void> = {
    settings: () => navigate('settings'),
    reminders: () => navigate('reminders'),
    share: () => setShare(true),
    backup: () => {
      dispatch({ type: 'sync', at: Date.now() })
      toast(`已同步 · ${timeHM(Date.now())}`)
    },
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
        : item.key === 'backup'
          ? `上次同步 ${relativeFromNow(state.lastSyncedAt, now)}`
          : item.sub,
    value:
      item.key === 'reminders'
        ? state.reminder.enabled
          ? '已开启'
          : '已关闭'
        : item.key === 'share'
          ? `${state.family.length} 位成员`
          : item.key === 'backup'
            ? '立即同步'
            : undefined,
    onClick: menuActions[item.key],
  }))

  const avatarChoices = Array.from(
    new Set([form.avatar, ...state.photos.map((photo) => photo.thumb)]),
  ).slice(0, 4)

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
          <img className="profile-hero__avatar" src={state.baby.avatar} alt={state.baby.name} />
          <div className="profile-hero__main">
            <div className="profile-hero__name">{state.baby.name}</div>
            <div className="profile-hero__meta">
              {ageLabel(age)} · {state.baby.birthday.replace(/-/g, '.')} {state.baby.birthTime} 出生
            </div>
            <span className="profile-hero__badge">
              <Icon name="sparkle" size={10} />
              已珍藏 {age.totalDays} 天
            </span>
          </div>
          <button className="profile-hero__edit" aria-label="编辑宝宝资料" onClick={openBaby}>
            <Icon name="edit" size={14} />
          </button>
        </section>

        <p className="profile-hint">
          {state.baby.gender === 'girl' ? '女孩' : '男孩'} · {state.baby.birthplace} · 出生{' '}
          {state.baby.birthWeightKg} kg / {state.baby.birthHeightCm} cm
        </p>

        <section className="panel" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="eyebrow">家庭成员 · {state.family.length}</span>
            <button className="section-head__action" onClick={() => setShare(true)}>
              <Icon name="plus" size={12} />
              邀请
            </button>
          </div>
          <div className="family">
            {state.family.map((m) => (
              <button key={m.id} type="button" className="family__item" onClick={() => setMember(m)}>
                <span className="family__avatar" style={{ background: m.color }}>
                  {m.name.slice(0, 1)}
                </span>
                <span className="family__name">{m.name}</span>
              </button>
            ))}
            <button className="family__item" onClick={() => setShare(true)}>
              <span className="family__add">
                <Icon name="plus" size={15} />
              </span>
              <span className="family__name">添加</span>
            </button>
          </div>
          {state.family.length === 0 ? (
            <div className="empty">还没有家庭成员，邀请家人一起记录吧</div>
          ) : null}
          <p className="timer__hint" style={{ textAlign: 'left', marginTop: 12 }}>
            点头像可调整权限 · 长辈可以设为只读，看得见，也不必担心误改。
          </p>
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="eyebrow">账号</span>
            <button className="section-head__action" onClick={signOut}>
              退出登录
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <span className="setting__icon">
              <Icon name="profile" size={18} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="switch-row__title">{user.nickname}</div>
              <div className="switch-row__sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.email}
              </div>
            </div>
          </div>
          <p className="timer__hint" style={{ textAlign: 'left', marginTop: 12 }}>
            记录会自动保存到这台电脑的 MySQL；退出后需要重新登录才能查看。
          </p>
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>
            Settings
          </div>
          <div className="settings">
            {rows.map((r) => (
              <button key={r.title} className="setting" onClick={r.onClick}>
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
            ))}
          </div>
        </section>

        <div className="sync-chip">
          <span className="sync-chip__dot" />
          已登录 · 记录自动保存到本机数据库
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
        open={babyOpen}
        onClose={() => setBabyOpen(false)}
        title="编辑宝宝资料"
        desc="月龄、成长天数与出生信息会随着这里一起更新。"
        footer={
          <button className="btn btn--primary btn--full" onClick={saveBaby}>
            保存资料
          </button>
        }
      >
        <div className="baby-form">
          <label className="field">
            <span className="field__label">昵称</span>
            <input
              className="input"
              value={form.name}
              maxLength={12}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="宝宝的小名"
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field__label">出生日期</span>
              <input
                className="input"
                type="date"
                value={form.birthday}
                max={toISODate(now)}
                onChange={(e) => setForm({ ...form, birthday: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">出生时间</span>
              <input
                className="input"
                type="time"
                value={form.birthTime}
                onChange={(e) => setForm({ ...form, birthTime: e.target.value })}
              />
            </label>
          </div>
          <div className="field">
            <span className="field__label">性别</span>
            <div className="segmented">
              {([
                ['girl', '女孩'],
                ['boy', '男孩'],
              ] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  className={`segmented__item${form.gender === v ? ' segmented__item--on' : ''}`}
                  onClick={() => setForm({ ...form, gender: v })}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row field-row--three">
            <label className="field">
              <span className="field__label">出生体重 · kg</span>
              <input
                className="input"
                inputMode="decimal"
                value={form.birthWeightKg}
                onChange={(e) => setForm({ ...form, birthWeightKg: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">出生身长 · cm</span>
              <input
                className="input"
                inputMode="decimal"
                value={form.birthHeightCm}
                onChange={(e) => setForm({ ...form, birthHeightCm: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">头围 · cm</span>
              <input
                className="input"
                inputMode="decimal"
                value={form.birthHeadCm}
                onChange={(e) => setForm({ ...form, birthHeadCm: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">出生地</span>
            <input
              className="input"
              value={form.birthplace}
              maxLength={20}
              onChange={(e) => setForm({ ...form, birthplace: e.target.value })}
              placeholder="例如 杭州"
            />
          </label>
          <div className="field">
            <span className="field__label">头像</span>
            <div className="avatar-picker">
              {avatarChoices.map((src, i) => (
                <button
                  key={`${src.slice(0, 24)}-${i}`}
                  type="button"
                  className={`avatar-picker__item${form.avatar === src ? ' avatar-picker__item--on' : ''}`}
                  onClick={() => setForm({ ...form, avatar: src })}
                  aria-label={i === 0 && form.avatar.startsWith('data:') ? '当前上传的头像' : '选择头像'}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
            <div className="avatar-actions">
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => uploadRef.current?.click()}>
                <Icon name="album" size={14} />
                从相册上传
              </button>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => cameraRef.current?.click()}>
                <Icon name="camera" size={14} />
                拍一张
              </button>
            </div>
            <input ref={uploadRef} className="sr-only" type="file" accept="image/*" onChange={onAvatarFile} />
            <input
              ref={cameraRef}
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onAvatarFile}
            />
            <p className="timer__hint" style={{ textAlign: 'left', marginTop: 8 }}>
              支持 JPG / PNG，会自动裁成方形并压缩，只保存在这台设备上。
            </p>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={member !== null}
        onClose={() => setMember(null)}
        title={member ? member.name : '家庭成员'}
        desc="管理员可以调整每位家人的权限，其他成员只能查看。"
        footer={
          member ? (
            <button
              className="btn btn--danger btn--full"
              onClick={() => {
                setRemoving(member)
                setMember(null)
              }}
            >
              移出家庭
            </button>
          ) : null
        }
      >
        {member ? (
          <>
            <div className="member-card">
              <span className="family__avatar" style={{ background: member.color, width: 54, height: 54, fontSize: 'calc(18px * var(--type-scale, 1))' }}>
                {member.name.slice(0, 1)}
              </span>
              <div>
                <div className="switch-row__title">{member.role}</div>
                <div className="switch-row__sub">{PERMISSION_MAP[member.permission].label}</div>
              </div>
            </div>

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
            </div>
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
              onClick={() => {
                if (!removing) return
                dispatch({ type: 'removeFamilyMember', id: removing.id })
                toast(`${removing.name} 已移出家庭`)
                setRemoving(null)
              }}
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
        open={share}
        onClose={() => setShare(false)}
        title="家庭共享"
        desc="邀请家人一起记录，也可以只让他们看见。"
        footer={
          <button
            className="btn btn--primary btn--full"
            onClick={() => {
              toast('邀请链接已复制，发给家人即可')
              setShare(false)
            }}
          >
            复制邀请链接
          </button>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {state.family.map((m) => (
            <div key={m.id} className="switch-row" style={{ padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="family__avatar" style={{ background: m.color, width: 34, height: 34 }}>
                  {m.name.slice(0, 1)}
                </span>
                <div>
                  <div className="switch-row__title">{m.name}</div>
                  <div className="switch-row__sub">{PERMISSION_MAP[m.permission].label}</div>
                </div>
              </div>
              <span style={{ fontSize: 'calc(10px * var(--type-scale, 1))', color: 'var(--ink-3)' }}>{m.role}</span>
            </div>
          ))}
        </div>
        <p className="about-note" style={{ textAlign: 'left' }}>
          宝宝照片与成长数据仅家庭成员可见，默认不公开。成员可以随时被移出家庭。
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
