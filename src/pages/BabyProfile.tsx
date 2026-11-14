import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { BabyFields } from '../components/BabyFields'
import { BabyAvatarPicker } from '../components/BabyAvatarPicker'
import type { AvatarChoice } from '../components/BabyAvatarPicker'
import { Sheet } from '../components/Sheet'
import { useStore } from '../data/store'
import { preBirthConflicts } from '../lib/birth'
import type { BirthConflicts } from '../lib/birth'
import { shortDate } from '../lib/date'
import { uploadBabyAvatar } from '../lib/media'
import { goBack } from '../lib/route'
import type { Baby } from '../data/types'

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
  avatarHidden: string[]
}

const DEFAULT_AVATAR = '/brand/app-icon-180.png'

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
    avatarHidden: baby.avatarHidden ?? [],
  }
}

export default function BabyProfilePage() {
  const { state, dispatch, toast } = useStore()
  const [baseline, setBaseline] = useState<BabyForm>(() => toForm(state.baby))
  const [form, setForm] = useState<BabyForm>(baseline)
  const [uploading, setUploading] = useState(false)
  const [conflict, setConflict] = useState<{ baby: Baby; counts: BirthConflicts } | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [holdingAvatar, setHoldingAvatar] = useState<string | null>(null)
  const [removeKey, setRemoveKey] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const conflictRef = useRef<HTMLDivElement>(null)
  const holdTimer = useRef<number | null>(null)
  const holdStart = useRef<{ x: number; y: number } | null>(null)
  const longPressFired = useRef(false)
  const allowLeave = useRef(false)
  const blockedBack = useRef(false)
  const guardPushed = useRef(false)
  const now = Date.now()

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // 家人改了宝宝资料、而本地没有未保存修改时，基线跟着更新，避免「保存」把别人改的覆盖回去。
  useEffect(() => {
    if (dirtyRef.current) return
    const next = toForm(state.baby)
    setBaseline(next)
    setForm(next)
  }, [state.baby])

  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!conflict) return
    const id = window.setTimeout(() => {
      conflictRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
    return () => window.clearTimeout(id)
  }, [conflict])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  useEffect(() => {
    if (!dirty || guardPushed.current) return
    // 第一次产生修改时垫一条同地址历史：手机返回会先落在这一条上，
    // 页面不会被路由卸载，表单和未保存状态都能保留。
    guardPushed.current = true
    blockedBack.current = true
    history.pushState({ ...(history.state ?? {}) }, '', '#/baby')
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const onPop = () => {
      if (allowLeave.current) return
      blockedBack.current = false
      if (window.location.hash !== '#/baby') {
        history.pushState({ ...(history.state ?? {}) }, '', '#/baby')
      }
      setLeaveOpen(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [dirty])

  const exitPage = () => {
    allowLeave.current = true
    setLeaveOpen(false)
    if (!blockedBack.current) {
      goBack('profile')
      return
    }
    blockedBack.current = false
    // go(-2) 要跳过「脏数据哨兵」和用户按的那一次返回；
    // 不再用固定 220ms 猜导航速度，改成等 popstate 落地后再判断。
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      window.removeEventListener('popstate', onPop)
      if (window.location.hash === '#/baby') goBack('profile')
    }
    const onPop = () => window.setTimeout(settle, 0)
    window.addEventListener('popstate', onPop)
    history.go(-2)
    window.setTimeout(settle, 400)
  }

  const requestClose = () => {
    if (!dirty) {
      exitPage()
      return
    }
    setLeaveOpen(true)
  }

  const commitBaby = (baby: Baby) => {
    dispatch({ type: 'updateBaby', baby })
    toast('宝宝资料已更新')
    exitPage()
  }

  const saveBaby = () => {
    setLeaveOpen(false)
    const name = form.name.trim()
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(form.birthday)) {
      toast('请填写昵称和生日')
      return
    }
    if (form.birthTime && !/^\d{2}:\d{2}$/.test(form.birthTime)) {
      toast('出生时间格式不正确')
      return
    }
    const birthTs = Date.parse(`${form.birthday}T00:00:00`)
    if (!Number.isFinite(birthTs) || birthTs > Date.now()) {
      toast('出生日期不能晚于今天')
      return
    }
    if (!dirty) {
      toast('宝宝资料没有变化')
      exitPage()
      return
    }
    const num = (v: string, fallback: number) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? n : fallback
    }
    const baby: Baby = {
      name,
      birthday: form.birthday,
      birthTime: form.birthTime,
      gender: form.gender,
      birthWeightKg: num(form.birthWeightKg, state.baby.birthWeightKg),
      birthHeightCm: num(form.birthHeightCm, state.baby.birthHeightCm),
      birthHeadCm: num(form.birthHeadCm, state.baby.birthHeadCm),
      birthplace: form.birthplace.trim() || state.baby.birthplace,
      avatar: form.avatar,
      avatarHidden: form.avatarHidden,
    }
    if (form.birthday !== state.baby.birthday) {
      const counts = preBirthConflicts(state, baby)
      if (counts.total > 0) {
        setConflict({ baby, counts })
        return
      }
    }
    commitBaby(baby)
  }

  const onAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploading) return
    if (!file.type.startsWith('image/')) {
      toast('请选择一张照片')
      return
    }
    setUploading(true)
    try {
      // 头像也进媒体库：state 里只存 /api/media/blob/<id>，不再塞 base64。
      const avatar = await uploadBabyAvatar(file)
      setForm((prev) => ({ ...prev, avatar }))
    } catch (error) {
      toast(error instanceof Error ? `头像没能上传：${error.message}` : '头像没能上传，稍后再试')
    } finally {
      setUploading(false)
    }
  }

  const avatarChoices = (() => {
    const photoIdBySrc = new Map(state.photos.map((photo) => [photo.thumb, photo.id]))
    const keyFor = (src: string) => {
      if (src === DEFAULT_AVATAR) return 'default'
      const photoId = photoIdBySrc.get(src)
      if (photoId) return `photo:${photoId}`
      if (src.startsWith('data:')) return `data:${src.length}:${src.slice(-24)}`
      return `src:${src}`
    }
    const hidden = new Set(form.avatarHidden)
    const seen = new Set<string>()
    const list: AvatarChoice[] = []
    const add = (src: string, deletable = true) => {
      if (!src || seen.has(src)) return
      const key = keyFor(src)
      if (hidden.has(key)) return
      seen.add(src)
      list.push({ key, src, deletable })
    }
    add(form.avatar, form.avatar !== DEFAULT_AVATAR)
    state.photos.forEach((photo) => add(photo.thumb))
    add(DEFAULT_AVATAR, false)
    return list
  })()

  const conflictRows = conflict
    ? ([
        ['成长记录', conflict.counts.growths],
        ['照片 / 视频', conflict.counts.photos],
        ['喂养记录', conflict.counts.feeds],
        ['睡眠记录', conflict.counts.sleeps],
        ['尿布记录', conflict.counts.diapers],
        ['成长里程碑', conflict.counts.milestones],
      ] as const).filter(([, n]) => n > 0)
    : []

  const cancelAvatarHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    holdStart.current = null
    setHoldingAvatar(null)
  }

  const selectAvatar = (choice: AvatarChoice) => {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    setRemoveKey(null)
    setForm({ ...form, avatar: choice.src })
  }

  const removeAvatar = (choice: AvatarChoice) => {
    if (!choice.deletable) {
      toast('默认头像会一直保留')
      return
    }
    if (avatarChoices.length <= 1) {
      toast('至少保留一张头像')
      return
    }
    const remaining = avatarChoices.filter((item) => item.key !== choice.key)
    const fallback = remaining[0]
    setForm((prev) => {
      const nextAvatar = prev.avatar === choice.src ? fallback.src : prev.avatar
      const nextHidden = Array.from(new Set([...prev.avatarHidden, choice.key]))
      return { ...prev, avatar: nextAvatar, avatarHidden: nextHidden }
    })
    setRemoveKey(null)
    toast('已移除这张头像，保存后生效')
  }

  const startAvatarHold = (event: ReactPointerEvent, choice: AvatarChoice) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancelAvatarHold()
    setRemoveKey(null)
    longPressFired.current = false
    holdStart.current = { x: event.clientX, y: event.clientY }
    setHoldingAvatar(choice.key)
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      longPressFired.current = true
      setHoldingAvatar(null)
      if (!choice.deletable) {
        toast('默认头像会一直保留')
        return
      }
      setRemoveKey(choice.key)
    }, 520)
  }

  const moveAvatarHold = (event: ReactPointerEvent) => {
    const start = holdStart.current
    if (!start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) {
      cancelAvatarHold()
    }
  }

  const endAvatarHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    holdStart.current = null
    setHoldingAvatar(null)
  }

  return (
    <div className="page page--sub baby-edit">
      <ScreenHead title="宝宝资料" sub="BABY PROFILE" onBack={requestClose} />

      <div className="page__body baby-edit__body">
        <div className="baby-edit__intro">
          <p>月龄、成长天数与出生信息会随着这里一起更新。</p>
          <span className={`baby-edit__status${dirty ? ' baby-edit__status--dirty' : ''}`}>
            {dirty ? '有修改未保存' : '所有修改已保存'}
          </span>
        </div>

        <section className="panel baby-edit__card">
          <div className="baby-form">
            <BabyFields
              form={form}
              now={now}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            />
            <div className="field">
              <span className="field__label">头像</span>
              <BabyAvatarPicker
                choices={avatarChoices}
                selected={form.avatar}
                holdingKey={holdingAvatar}
                removeKey={removeKey}
                onSelect={selectAvatar}
                onHoldStart={startAvatarHold}
                onHoldMove={moveAvatarHold}
                onHoldEnd={endAvatarHold}
                onRemove={removeAvatar}
                onPickUpload={() => uploadRef.current?.click()}
                onPickCamera={() => cameraRef.current?.click()}
                uploadRef={uploadRef}
                cameraRef={cameraRef}
                onFile={onAvatarFile}
              />
            </div>
          </div>

          {conflict ? (
            <div className="birth-conflict" ref={conflictRef} style={{ marginTop: 14 }}>
              <div className="birth-conflict__head">
                改到 {conflict.baby.birthday} 后，有 {conflict.counts.total} 条记录早于生日
              </div>
              <ul className="birth-conflict__list">
                {conflictRows.map(([label, n]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <b>{n} 条</b>
                  </li>
                ))}
              </ul>
              {conflict.counts.earliest ? (
                <p className="birth-conflict__hint">
                  最早一条在 {shortDate(conflict.counts.earliest)}。保存后这些内容会归档隐藏，不会删除；改回原生日可以恢复。
                </p>
              ) : null}
              <div className="birth-conflict__actions">
                <button type="button" className="btn btn--quiet" onClick={() => setConflict(null)}>
                  返回修改
                </button>
                <button type="button" className="btn btn--primary" onClick={() => commitBaby(conflict.baby)}>
                  保留并隐藏
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <p className="baby-edit__note">
          <Icon name="shield" size={13} />
          修改不会自动生效，点「保存资料」后才会更新。
        </p>
      </div>

      <div className="baby-edit__foot">
        <button className="btn btn--primary btn--full" onClick={saveBaby}>
          保存资料
        </button>
      </div>

      <Sheet
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="还有修改没有保存"
        desc="保存后才会更新宝宝资料，直接离开会放弃这次的修改。"
        footer={
          <div className="baby-leave__actions">
            <button className="btn btn--primary btn--full" onClick={saveBaby}>
              保存并返回
            </button>
            <div className="baby-leave__row">
              <button className="btn btn--quiet" onClick={() => setLeaveOpen(false)}>
                继续编辑
              </button>
              <button className="btn btn--quiet" onClick={exitPage}>
                不保存
              </button>
            </div>
          </div>
        }
      >
        <p className="exit-note">照片、生日与成长信息都还在，只有这次未保存的修改会丢失。</p>
      </Sheet>
    </div>
  )
}
