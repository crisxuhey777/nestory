import { useEffect, useState } from 'react'
import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { useStore } from '../data/store'
import { NOTIFICATION_LABELS, REMINDER_INTERVALS } from '../data/config'
import { minutesLabel, timeHM } from '../lib/date'
import { notificationPermission, notify, requestNotificationPermission } from '../lib/notify'
import { isStandalone } from '../lib/pwa'
import { getRouteFrom } from '../lib/route'
import { feedStats } from '../lib/stats'

export default function RemindersPage() {
  const { state, dispatch, toast } = useStore()
  const r = state.reminder
  const now = Date.now()
  const stats = feedStats(state.feeds, r.intervalMinutes, now)
  const remaining = stats.nextReminderAt ? (stats.nextReminderAt - now) / 60000 : null
  const [permission, setPermission] = useState(() => notificationPermission())
  const standalone = isStandalone()

  useEffect(() => {
    const sync = () => setPermission(notificationPermission())
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const update = (patch: Partial<typeof r>, msg = '提醒设置已更新') => {
    dispatch({ type: 'updateReminder', reminder: patch })
    toast(msg)
  }

  const askNotify = async () => {
    const next = permission === 'granted' ? permission : await requestNotificationPermission()
    setPermission(next)
    if (next === 'granted') {
      if (!r.enabled) update({ enabled: true }, '通知已开启，喂养提醒会安静地出现')
      else toast('通知已开启，喂养提醒会安静地出现')
    } else if (next === 'denied') {
      toast('通知被浏览器拦住了，可在地址栏的站点设置里重新允许')
    } else {
      toast('当前浏览器不支持系统通知，会继续用应用内提示')
    }
  }

  const testNotify = async () => {
    const result = await notify('该喂奶啦', '这是一条测试提醒，到点时的提醒会长这样。', {
      tag: 'nestory-test',
      vibrate: r.vibration,
    })
    toast(result.ok ? '测试通知已发送' : '通知没发出去，到点时会用应用内提示')
  }

  const from = getRouteFrom()

  return (
    <div className="page page--sub">
      <ScreenHead title="提醒中心" sub="GENTLE REMINDERS" back={from ?? 'profile'} />
      <div className="page__body" style={{ paddingBottom: 56 }}>
        <div className="panel" style={{ background: 'var(--champagne-tint)', border: '1px solid transparent', display: 'flex', gap: 12 }}>
          <span className="setting__icon" style={{ flex: 'none', background: 'rgba(215,198,164,.5)' }}>
            <Icon name="bell" size={18} />
          </span>
          <div>
            <div className="switch-row__title" style={{ marginBottom: 4 }}>
              提醒只是辅助
            </div>
            <div className="switch-row__sub">
              它提醒你时间，但不能替代宝宝的饥饿信号。宝宝想吃的时候，随时都可以喂。
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            Notifications
          </div>
          <div className="switch-row">
            <div>
              <div className="switch-row__title">系统通知</div>
              <div className="switch-row__sub">
                {NOTIFICATION_LABELS[permission]?.text ?? permission} ·{' '}
                {NOTIFICATION_LABELS[permission]?.hint ?? '到点时会用应用内提示'}
              </div>
            </div>
            {permission === 'granted' ? (
              <button className="btn btn--quiet btn--sm" onClick={testNotify}>
                发送测试通知
              </button>
            ) : permission === 'unsupported' ? (
              <span className="setting__value" style={{ paddingRight: 0 }}>
                不可用
              </span>
            ) : (
              <button className="btn btn--quiet btn--sm" onClick={askNotify}>
                开启通知
              </button>
            )}
          </div>
          <p className="switch-row__sub" style={{ marginTop: 6 }}>
            {standalone
              ? '已安装到桌面，APP 在后台时提醒也能通过系统通知送达。'
              : 'iPhone 请先「分享 → 添加到主屏幕」，Android 建议安装到桌面；之后提醒才能在后台送达。'}
          </p>
        </div>

        <div className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            Reminder
          </div>
          <div className="switch-row">
            <div>
              <div className="switch-row__title">开启喂养提醒</div>
              <div className="switch-row__sub">按上一次喂养的开始时间推算</div>
            </div>
            <button
              className={`switch${r.enabled ? ' switch--on' : ''}`}
              role="switch"
              aria-checked={r.enabled}
              aria-label="开启喂养提醒"
              onClick={() => update({ enabled: !r.enabled }, r.enabled ? '喂养提醒已关闭' : '喂养提醒已开启')}
            >
              <span />
            </button>
          </div>
          <div className="switch-row">
            <div>
              <div className="switch-row__title">夜间安静时段</div>
              <div className="switch-row__sub">22:00 – 07:00 不做声音提醒，只保留记录</div>
            </div>
            <button
              className={`switch${r.quietNight ? ' switch--on' : ''}`}
              role="switch"
              aria-checked={r.quietNight}
              aria-label="夜间安静时段"
              onClick={() => update({ quietNight: !r.quietNight })}
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
              className={`switch${r.vibration ? ' switch--on' : ''}`}
              role="switch"
              aria-checked={r.vibration}
              aria-label="轻触反馈"
              onClick={() => update({ vibration: !r.vibration })}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Interval
          </div>
          <div className="switch-row__title" style={{ marginBottom: 4 }}>
            提醒间隔
          </div>
          <div className="switch-row__sub" style={{ marginBottom: 14 }}>
            仅作为参考节奏，按需调整。
          </div>
          <div className="interval-picker">
            {REMINDER_INTERVALS.map((m) => (
              <button
                key={m}
                className={r.intervalMinutes === m ? 'on' : ''}
                onClick={() => update({ intervalMinutes: m })}
              >
                {m / 60}
                <small>小时</small>
              </button>
            ))}
          </div>
          <div className="panel panel--flat" style={{ marginTop: 16, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="switch-row__sub">下一次提醒</span>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 'calc(18px * var(--type-scale, 1))', color: 'var(--forest)' }}>
                {!r.enabled
                  ? '已关闭'
                  : stats.nextReminderAt
                    ? remaining != null && remaining > 0
                      ? `${timeHM(stats.nextReminderAt)} · ${minutesLabel(remaining)}后`
                      : `${timeHM(stats.nextReminderAt)} · 该喂奶了`
                    : '记录后开始计算'}
              </span>
            </div>
            {stats.lastAt ? (
              <div className="switch-row__sub" style={{ marginTop: 6 }}>
                上次喂养 {timeHM(stats.lastAt)} · 每 {r.intervalMinutes / 60} 小时提醒一次
              </div>
            ) : null}
          </div>
        </div>

        <p className="about-note">
          每位家人都可以设置自己的提醒节奏。
        </p>
      </div>
    </div>
  )
}
