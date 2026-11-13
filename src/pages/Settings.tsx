import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { Sheet } from '../components/Sheet'
import { useStore } from '../data/store'
import { navigate } from '../lib/route'
import { usePrefs } from '../lib/prefs'
import { timeHM } from '../lib/date'
import { feedStats } from '../lib/stats'
import { APP, FONT_OPTIONS, NOTIFICATION_LABELS } from '../data/config'

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function SettingsPage() {
  const { state, dispatch, toast, user, signOut } = useStore()
  const { prefs, update } = usePrefs()
  const [resetOpen, setResetOpen] = useState(false)
  const [policy, setPolicy] = useState<'privacy' | 'terms' | null>(null)
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const [storedBytes, setStoredBytes] = useState(0)

  useEffect(() => {
    let alive = true
    const estimate = navigator.storage?.estimate?.()
    if (estimate) {
      estimate
        .then((result) => {
          if (alive && result.usage) setStoredBytes(result.usage)
        })
        .catch(() => {
          /* estimate is optional */
        })
    }
    return () => {
      alive = false
    }
  }, [state.photos.length, state.feeds.length, state.sleeps.length, state.diapers.length, state.growths.length])

  const usage = useMemo(() => {
    const raw = JSON.stringify(state)
    const bytes = new Blob([raw]).size
    const records =
      state.feeds.length + state.sleeps.length + state.diapers.length + state.growths.length
    return { bytes, records, photos: state.photos.length }
  }, [state])

  const nextReminder = feedStats(state.feeds, state.reminder.intervalMinutes, Date.now()).nextReminderAt

  const askPermission = async () => {
    if (typeof Notification === 'undefined') {
      toast('当前浏览器不支持系统通知')
      return
    }
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') {
        if (!state.reminder.enabled) dispatch({ type: 'updateReminder', reminder: { enabled: true } })
        toast('通知已开启，喂养提醒会安静地出现')
      } else if (result === 'denied') {
        toast('通知被浏览器阻止了，可在地址栏的站点设置里重新允许')
      }
    } catch {
      toast('当前环境无法请求通知权限')
    }
  }

  const toggle = (key: 'enabled' | 'quietNight' | 'vibration', on: boolean, text: string) => {
    dispatch({ type: 'updateReminder', reminder: { [key]: on } })
    if (text) toast(text)
  }

  return (
    <div className="page">
      <ScreenHead title="设置" sub="Preferences" back="profile" />

      <div className="page__body">
        <section className="panel">
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
            Appearance
          </div>

          <div className="switch-row" style={{ borderBottom: 'none', paddingBottom: 4 }}>
            <div>
              <div className="switch-row__title">字体大小</div>
              <div className="switch-row__sub">调大后，数字与正文会更松弛一些</div>
            </div>
          </div>

          <div className="pref-preview" aria-live="polite">
            <span className="pref-preview__num">5.6</span>
            <span className="pref-preview__unit">kg</span>
            <span className="pref-preview__line">今天也长得很好，一点点就好。</span>
          </div>

          <div className="scale-picker">
            {FONT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`scale-picker__item${prefs.fontSize === option.key ? ' scale-picker__item--on' : ''}`}
                onClick={() => update({ fontSize: option.key })}
                aria-pressed={prefs.fontSize === option.key}
              >
                <span style={{ fontSize: `calc(${option.sample}px * var(--type-scale, 1))` }}>Aa</span>
                <small>{option.label}</small>
              </button>
            ))}
          </div>

          <div className="switch-row" style={{ borderBottom: 'none' }}>
            <div>
              <div className="switch-row__title">减少动态效果</div>
              <div className="switch-row__sub">减弱页面切换与抽屉的过渡动画</div>
            </div>
            <button
              className={`switch${prefs.reduceMotion ? ' switch--on' : ''}`}
              role="switch"
              aria-checked={prefs.reduceMotion}
              aria-label="减少动态效果"
              onClick={() => update({ reduceMotion: !prefs.reduceMotion })}
            >
              <span />
            </button>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>
            Notifications
          </div>

          <div className="switch-row">
            <div>
              <div className="switch-row__title">通知权限</div>
              <div className="switch-row__sub">
                {NOTIFICATION_LABELS[permission]?.text ?? permission} ·{' '}
                {NOTIFICATION_LABELS[permission]?.hint ?? '当前只在应用内提示'}
              </div>
            </div>
            {permission !== 'granted' && permission !== 'unsupported' ? (
              <button className="btn btn--quiet btn--sm" onClick={askPermission}>
                {NOTIFICATION_LABELS[permission]?.action || '去开启'}
              </button>
            ) : (
              <span className="setting__value" style={{ paddingRight: 0 }}>
                {NOTIFICATION_LABELS[permission]?.text ?? '不可用'}
              </span>
            )}
          </div>

          <div className="switch-row">
            <div>
              <div className="switch-row__title">喂养提醒</div>
              <div className="switch-row__sub">按上一次喂养的开始时间推算</div>
            </div>
            <button
              className={`switch${state.reminder.enabled ? ' switch--on' : ''}`}
              role="switch"
              aria-checked={state.reminder.enabled}
              aria-label="喂养提醒"
              onClick={() =>
                toggle('enabled', !state.reminder.enabled, state.reminder.enabled ? '喂养提醒已关闭' : '喂养提醒已开启')
              }
            >
              <span />
            </button>
          </div>

          <div className="switch-row">
            <div>
              <div className="switch-row__title">夜间安静</div>
              <div className="switch-row__sub">22:00 – 07:00 不发出声音，只保留记录</div>
            </div>
            <button
              className={`switch${state.reminder.quietNight ? ' switch--on' : ''}`}
              role="switch"
              aria-checked={state.reminder.quietNight}
              aria-label="夜间安静"
              onClick={() => toggle('quietNight', !state.reminder.quietNight, '')}
            >
              <span />
            </button>
          </div>

          <div className="switch-row" style={{ borderBottom: 'none' }}>
            <div>
              <div className="switch-row__title">轻触反馈</div>
              <div className="switch-row__sub">保存记录时给一次很轻的振动</div>
            </div>
            <button
              className={`switch${state.reminder.vibration ? ' switch--on' : ''}`}
              role="switch"
              aria-checked={state.reminder.vibration}
              aria-label="轻触反馈"
              onClick={() => toggle('vibration', !state.reminder.vibration, '')}
            >
              <span />
            </button>
          </div>

          <div className="settings" style={{ marginTop: 4 }}>
            <button className="setting" onClick={() => navigate('reminders', 'settings')}>
              <span className="setting__icon">
                <Icon name="clock" size={17} />
              </span>
              <span className="setting__main">
                <span className="setting__title">提醒节奏</span>
                <span className="setting__sub" style={{ display: 'block' }}>
                  每 {state.reminder.intervalMinutes / 60} 小时
                  {nextReminder ? ` · 下次 ${timeHM(nextReminder)}` : ''}
                </span>
              </span>
              <span className="setting__value">
                <Icon name="chevronRight" size={12} />
              </span>
            </button>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Storage
          </div>

          <div className="storage-figures">
            <div className="storage-figure">
              <b>{formatBytes(Math.max(usage.bytes, storedBytes))}</b>
              <span>已用空间</span>
            </div>
            <div className="storage-figure">
              <b>{usage.records}</b>
              <span>条记录</span>
            </div>
            <div className="storage-figure">
              <b>{usage.photos}</b>
              <span>照片 / 视频</span>
            </div>
          </div>

          <p className="timer__hint" style={{ textAlign: 'left', marginTop: 12 }}>
            照片会压缩后再保存，视频与 Live 短片存在账号的媒体库里，换设备登录也能看到。
          </p>

          {user.isDemo ? (
            <div className="settings" style={{ marginTop: 6 }}>
              <button className="setting" onClick={() => setResetOpen(true)}>
                <span className="setting__icon">
                  <Icon name="sync" size={17} />
                </span>
                <span className="setting__main">
                  <span className="setting__title">恢复示例数据</span>
                  <span className="setting__sub" style={{ display: 'block' }}>
                    回到初次打开时的样子，用于演示
                  </span>
                </span>
                <span className="setting__value">
                  <Icon name="chevronRight" size={12} />
                </span>
              </button>
            </div>
          ) : null}
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            About
          </div>
          <div className="settings">
            <div className="setting" style={{ cursor: 'default' }}>
              <span className="setting__icon">
                <Icon name="leaf" size={17} />
              </span>
              <span className="setting__main">
                <span className="setting__title">Nestory</span>
                <span className="setting__sub" style={{ display: 'block' }}>
                  版本 {APP.version} · {APP.year}
                </span>
              </span>
            </div>
            <button className="setting" onClick={() => setPolicy('privacy')}>
              <span className="setting__icon">
                <Icon name="shield" size={17} />
              </span>
              <span className="setting__main">
                <span className="setting__title">隐私政策</span>
              </span>
              <span className="setting__value">
                <Icon name="chevronRight" size={12} />
              </span>
            </button>
            <button className="setting" onClick={() => setPolicy('terms')}>
              <span className="setting__icon">
                <Icon name="book" size={17} />
              </span>
              <span className="setting__main">
                <span className="setting__title">用户协议</span>
              </span>
              <span className="setting__value">
                <Icon name="chevronRight" size={12} />
              </span>
            </button>
          </div>
        </section>

        <p className="settings-foot">
          设置只影响这台设备。家庭成员共享的是记录，不共享各自的阅读与提醒偏好。
        </p>
      </div>

      <Sheet
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="恢复示例数据？"
        desc="这个账号里的记录会被示例数据替换，已上传的照片与视频会保留。"
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn--quiet" style={{ flex: 1 }} onClick={() => setResetOpen(false)}>
              取消
            </button>
            <button
              className="btn btn--danger"
              style={{ flex: 1 }}
              onClick={() => {
                dispatch({ type: 'reset' })
                setResetOpen(false)
                toast(`已恢复示例数据 · ${timeHM(Date.now())}`)
              }}
            >
              恢复
            </button>
          </div>
        }
      >
        <p className="about-copy" style={{ marginBottom: 0 }}>
          示例数据只替换文字记录，媒体库里的照片与视频不会被删除。
        </p>
      </Sheet>

      <Sheet
        open={policy !== null}
        onClose={() => setPolicy(null)}
        title={policy === 'privacy' ? '隐私政策' : '用户协议'}
        desc={policy === 'privacy' ? '最后更新 · 2026 年 11 月' : `适用于 Nestory ${APP.version}`}
        footer={
          <button className="btn btn--primary btn--full" onClick={() => setPolicy(null)}>
            我知道了
          </button>
        }
      >
        {policy === 'privacy' ? (
          <div className="policy">
            <p>Nestory 记录的是家庭里最私人的一部分。我们的原则很简单：</p>
            <p>一、宝宝的记录、照片与文字保存在你的账号与本机数据库里，不进入任何公开推荐，也不用于广告或模型训练。</p>
            <p>二、家庭成员共享时，由管理员决定每位家人是管理员、可编辑还是只读。</p>
            <p>三、你可以随时删除自己的照片与视频，或恢复示例数据清空当前记录。</p>
            <p>四、通知只用于喂养提醒，不包含营销内容。</p>
          </div>
        ) : (
          <div className="policy">
            <p>Nestory 是一个家庭成长记录工具，不提供医疗诊断或治疗建议。</p>
            <p>喂养、睡眠与生长数据仅作家庭参考；如对宝宝的健康有疑问，请咨询儿科医生。</p>
            <p>请妥善保管自己的账号密码，账号里的照片与成长信息只对家庭成员可见。</p>
            <p>继续使用即表示你理解并同意以上说明。</p>
          </div>
        )}
      </Sheet>
    </div>
  )
}
