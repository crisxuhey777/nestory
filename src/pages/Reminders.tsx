import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { useStore } from '../data/store'
import { REMINDER_INTERVALS } from '../data/config'
import { minutesLabel, timeHM } from '../lib/date'
import { getRouteFrom } from '../lib/route'
import { feedStats } from '../lib/stats'

export default function RemindersPage() {
  const { state, dispatch, toast } = useStore()
  const r = state.reminder
  const now = Date.now()
  const stats = feedStats(state.feeds, r.intervalMinutes, now)
  const remaining = stats.nextReminderAt ? (stats.nextReminderAt - now) / 60000 : null

  const update = (patch: Partial<typeof r>, msg = '提醒设置已更新') => {
    dispatch({ type: 'updateReminder', reminder: patch })
    toast(msg)
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
                    ? `${timeHM(stats.nextReminderAt)}${remaining != null && remaining > 0 ? ` · ${minutesLabel(remaining)}后` : ' · 现在'}`
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
          提醒设置只影响这台设备。家人共享的记录会同步，但各自的提醒节奏可以不同。
        </p>
      </div>
    </div>
  )
}
