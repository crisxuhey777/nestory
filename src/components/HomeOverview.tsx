import { Icon } from '../brand/icons'
import { QUICK_ACTIONS } from '../data/config'
import { minutesLabel, relativeFromNow, timeHM } from '../lib/date'
import type { diaperCountsToday, feedStats } from '../lib/stats'
import { signed } from '../lib/stats'

export type QuickTarget = (typeof QUICK_ACTIONS)[number]['target']

/**
 * 首页的「快速记录 + 今日摘要」两块。
 *
 * 纯展示：所有数字都由页面算好传进来，这里不读 store、不发请求——
 * 这样改版式不会碰到状态，写测试也能直接喂数据。
 */
export function HomeOverview({
  stats,
  now,
  sleepMinutes,
  sleepSegments,
  diapers,
  latestWeightKg,
  weightDelta,
  reminder,
  onQuick,
  onOpenFeed,
  onOpenReminders,
}: {
  stats: ReturnType<typeof feedStats>
  now: number
  sleepMinutes: number
  sleepSegments: number
  diapers: ReturnType<typeof diaperCountsToday>
  latestWeightKg: number | null
  weightDelta: number | null
  reminder: { enabled: boolean; nextAt: number | null; remainingMin: number | null; progress: number }
  onQuick: (target: QuickTarget) => void
  onOpenFeed: () => void
  onOpenReminders: () => void
}) {
  return (
    <>
      <section className="quick-strip" aria-label="快速记录">
        <div className="quick">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.key}
              className="quick__item"
              aria-label={`快速记录${action.label}`}
              onClick={() => onQuick(action.target)}
            >
              <span className="quick__circle">
                <Icon name={action.icon} size={action.key === 'feed' ? 25 : 24} />
              </span>
              <span className="quick__label">{action.label}</span>
            </button>
          ))}
        </div>
        <button className="overview__cta quick-strip__cta" aria-label="查看喂养记录" onClick={onOpenFeed}>
          <Icon name="clock" size={22} />
          <span className="overview__cta-main">
            <span className="overview__cta-title">喂养记录</span>
            <span className="overview__cta-sub">
              {stats.lastAt
                ? `上次 ${timeHM(stats.lastAt)} · 已过 ${minutesLabel(stats.sinceLastMin)}`
                : '还没有记录，从第一餐开始'}
            </span>
          </span>
          <Icon name="arrowRight" size={18} />
        </button>
      </section>

      <section className="overview" aria-label="今日成长摘要">
        <div className="overview__head">
          <span className="overview__title">今日成长摘要</span>
        </div>
        <div className="overview__grid">
          <div className="overview__cell">
            <div className="overview__value">
              {stats.count}
              <small>次</small>
            </div>
            <div className="overview__label">今日喂养</div>
          </div>
          <div className="overview__cell">
            <div className="overview__value">
              {stats.totalMl}
              <small>ml</small>
            </div>
            <div className="overview__label">瓶喂记录量</div>
          </div>
          <div className="overview__cell">
            <div
              className="overview__value"
              style={{ fontSize: 'calc(19px * var(--type-scale, 1))', letterSpacing: 0 }}
            >
              {stats.lastAt ? relativeFromNow(stats.lastAt, now) : '还没有'}
            </div>
            <div className="overview__label">
              最近喂养{stats.lastAt ? ` · ${timeHM(stats.lastAt)}` : ''}
            </div>
          </div>
          <div className="overview__cell">
            {latestWeightKg != null ? (
              <div className="overview__value">
                {latestWeightKg.toFixed(1)}
                <small>kg</small>
              </div>
            ) : (
              <div
                className="overview__value"
                style={{ fontSize: 'calc(19px * var(--type-scale, 1))', letterSpacing: 0 }}
              >
                还没有
              </div>
            )}
            <div className="overview__label">最近体重{weightDelta ? ` · 较上次 ${signed(weightDelta)}` : ''}</div>
          </div>
          <div className="overview__cell">
            <div className="overview__value">
              {Math.floor(sleepMinutes / 60)}
              <small>小时</small>
              {Math.round(sleepMinutes % 60)}
              <small>分</small>
            </div>
            <div className="overview__label">今日睡眠 · {sleepSegments} 段</div>
          </div>
          <div className="overview__cell">
            <div className="overview__value">
              {diapers.total}
              <small>次</small>
            </div>
            <div className="overview__label">
              今日尿布 · 湿 {diapers.wet} / 脏 {diapers.dirty}
            </div>
          </div>
        </div>

        {reminder.enabled && reminder.nextAt ? (
          <button type="button" className="overview__remind" onClick={onOpenReminders} aria-label="打开提醒中心">
            <Icon name="clock" size={13} />
            <span>
              下次提醒{' '}
              <b>
                {reminder.remainingMin != null && reminder.remainingMin > 0
                  ? `${minutesLabel(reminder.remainingMin)}后`
                  : '现在'}
              </b>
            </span>
            <span className="overview__bar">
              <span style={{ width: `${reminder.progress * 100}%` }} />
            </span>
          </button>
        ) : null}
      </section>
    </>
  )
}
