import { useRef, useState } from 'react'
import { ONBOARDING } from '../data/config'
import { uid, useStore } from '../data/store'
import { api } from '../data/api'
import type { AppState } from '../data/types'
import { compressImage } from '../lib/media'
import { toISODate } from '../lib/date'
import { navigate } from '../lib/route'
import { Icon } from '../brand/icons'
import { NestoryMark, NestoryWordmark } from '../brand/Logo'

type Step = -1 | 0 | 1 | 2

export default function Onboarding() {
  const { state, dispatch, user, toast } = useStore()
  const [step, setStep] = useState<Step>(-1)
  const [name, setName] = useState('')
  const [birthday, setBirthday] = useState('')
  const [gender, setGender] = useState<'girl' | 'boy' | ''>('')
  const [interval, setIntervalMinutes] = useState(180)
  const [remind, setRemind] = useState(true)
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const today = toISODate(Date.now())
  const stepDef = step >= 0 ? ONBOARDING.steps[step] : null
  const canNext = step !== 0 || (name.trim().length > 0 && birthday.length > 0)

  const finish = async (skip = false) => {
    if (busy) return
    setBusy(true)
    let patch: Partial<AppState> = {}
    if (!skip) {
      const now = Date.now()
      const nextPhoto =
        photo && step >= 1
          ? {
              id: uid('ph'),
              src: photo,
              thumb: photo,
              at: now,
              caption: ONBOARDING.photoCaption,
              author: user.nickname || '我',
              kind: 'photo' as const,
            }
          : null
      const family = state.family.length
        ? state.family
        : [
            {
              id: 'u1',
              name: user.nickname || '家庭管理员',
              role: '家庭管理员',
              color: '#B8C3B1',
              permission: 'admin' as const,
            },
          ]
      patch = {
        baby: {
          ...state.baby,
          name: name.trim(),
          birthday,
          gender,
        },
        reminder: {
          ...state.reminder,
          enabled: remind && interval > 0,
          intervalMinutes: interval > 0 ? interval : state.reminder.intervalMinutes,
        },
        photos: nextPhoto ? [nextPhoto, ...state.photos] : state.photos,
        heroPhotoIds: nextPhoto ? [nextPhoto.id] : state.heroPhotoIds,
        family,
        viewerId: state.viewerId || family[0]?.id || '',
      }
    }

    // 引导是账号真正开始的节点，先显式落库，避免用户在 800ms 防抖结束前刷新又回到引导
    try {
      await api.saveState({ ...state, ...patch, onboarded: true } as AppState)
    } catch {
      toast('设置没能保存，请稍后再试一次')
      setBusy(false)
      return
    }
    dispatch({ type: 'completeOnboarding', patch })
    navigate('home', undefined, true)
  }

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      setPhoto(await compressImage(file))
    } catch {
      toast('这张照片没能读取，换一张试试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding__panel">
        <header className="onboarding__top">
          <div className="onboarding__brand">
            <NestoryMark size={26} />
            <NestoryWordmark size={20} />
          </div>
          {step >= 0 ? (
            <button className="onboarding__skip" type="button" onClick={() => finish(true)}>
              跳过引导
            </button>
          ) : null}
        </header>

        {step === -1 ? (
          <div className="onboarding__welcome">
            <div className="onboarding__nest">
              <NestoryMark size={78} tone="forest" />
            </div>
            <span className="eyebrow">{ONBOARDING.welcome.eyebrow}</span>
            <h1 className="onboarding__title">{ONBOARDING.welcome.title}</h1>
            <p className="onboarding__body">{ONBOARDING.welcome.body}</p>
            <ul className="onboarding__points">
              <li>
                <Icon name="heart" size={17} />
                <span>从宝宝的名字和第一张照片开始</span>
              </li>
              <li>
                <Icon name="leaf" size={17} />
                <span>不想填的都可以以后在「我的」里补</span>
              </li>
              <li>
                <Icon name="shield" size={17} />
                <span>只有你和家人能看到，随时可以修改</span>
              </li>
            </ul>
            <div className="onboarding__actions">
              <button className="btn btn--primary btn--full" type="button" onClick={() => setStep(0)}>
                {ONBOARDING.welcome.primary}
              </button>
              <button className="onboarding__textbtn" type="button" onClick={() => finish(true)}>
                {ONBOARDING.welcome.skip}
              </button>
            </div>
          </div>
        ) : (
          <div className="onboarding__step">
            <div className="onboarding__progress" aria-label={`第 ${step + 1} 步，共 3 步`}>
              {ONBOARDING.steps.map((item, index) => (
                <span key={item.key} className={index <= step ? 'is-on' : ''} />
              ))}
            </div>
            <span className="eyebrow">{stepDef?.eyebrow}</span>
            <h1 className="onboarding__title onboarding__title--step">{stepDef?.title}</h1>
            <p className="onboarding__body">{stepDef?.body}</p>

            {step === 0 ? (
              <div className="onboarding__form">
                <label className="field">
                  <span className="field__label">宝宝昵称</span>
                  <input
                    className="input"
                    type="text"
                    maxLength={20}
                    autoFocus
                    placeholder="例如：小柚"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">出生日期</span>
                  <input
                    className="input"
                    type="date"
                    max={today}
                    value={birthday}
                    onChange={(event) => setBirthday(event.target.value)}
                  />
                </label>
                <div className="field">
                  <span className="field__label">性别 · 可跳过</span>
                  <div className="onboarding__genders">
                    {ONBOARDING.genders.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className={`chip${gender === item.value ? ' chip--on' : ''}`}
                        onClick={() => setGender(item.value as 'girl' | 'boy' | '')}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="onboarding__photo">
                <input
                  ref={fileRef}
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void pickPhoto(event.target.files?.[0])}
                />
                {photo ? (
                  <button className="onboarding__shot" type="button" onClick={() => fileRef.current?.click()}>
                    <img src={photo} alt="第一张照片预览" />
                    <span>换一张</span>
                  </button>
                ) : (
                  <button className="onboarding__drop" type="button" onClick={() => fileRef.current?.click()}>
                    <span className="onboarding__plus">
                      <Icon name="plus" size={24} />
                    </span>
                    <b>{busy ? '正在读取…' : '从设备选一张照片'}</b>
                    <small>JPG / PNG，可稍后更换</small>
                  </button>
                )}
                <button className="onboarding__textbtn" type="button" onClick={() => setStep(2)}>
                  暂时不放照片
                </button>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="onboarding__form">
                <div className="field">
                  <span className="field__label">喂养提醒</span>
                  <div className="onboarding__intervals">
                    {ONBOARDING.intervals.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className={`chip${interval === item.value ? ' chip--on' : ''}`}
                        onClick={() => {
                          setIntervalMinutes(item.value)
                          setRemind(item.value > 0)
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className={`onboarding__toggle${remind ? ' is-on' : ''}`}
                  type="button"
                  onClick={() => setRemind((value) => !value)}
                  disabled={interval === 0}
                >
                  <span>
                    <b>接收喂养提醒</b>
                    <small>仅在应用内提示，不替代宝宝的饥饿信号</small>
                  </span>
                  <i aria-hidden="true" />
                </button>
                <p className="onboarding__fine">之后可在「设置 → 提醒中心」随时调整，也可以完全关掉。</p>
              </div>
            ) : null}

            <div className="onboarding__actions onboarding__actions--step">
              <button className="btn btn--quiet" type="button" onClick={() => setStep((step - 1) as Step)}>
                上一步
              </button>
              <button
                className="btn btn--primary"
                type="button"
                disabled={!canNext || busy}
                onClick={() => {
                  if (step < 2) setStep((step + 1) as Step)
                  else finish()
                }}
              >
                {step === 2 ? ONBOARDING.finish : '下一步'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
