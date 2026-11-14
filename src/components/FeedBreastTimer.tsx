import { Icon } from '../brand/icons'
import { clock } from '../lib/date'

/**
 * 亲喂计时卡：左右侧切换 + 累计计时 + 开始/暂停/结束。
 *
 * 计时本身（interval、`breastStart`、累加）留在页面里——这一块只管显示与回调，
 * 这样以后调版式不会碰到计时状态。
 */
export function FeedBreastTimer({
  totalSec,
  leftSec,
  rightSec,
  side,
  running,
  hasBreast,
  onSide,
  onToggle,
  onEnd,
}: {
  totalSec: number
  leftSec: number
  rightSec: number
  side: 'left' | 'right'
  running: boolean
  hasBreast: boolean
  onSide: (side: 'left' | 'right') => void
  onToggle: () => void
  onEnd: () => void
}) {
  return (
    <div className="editor">
      <div className="editor__head">
        <span className="editor__title">亲喂计时</span>
        <span className="editor__note">分钟数不换算毫升</span>
      </div>
      <div className="timer">
        <div className="timer__digits">{clock(totalSec)}</div>
        <div className="timer__hint">
          {running ? `正在记录 · ${side === 'left' ? '左侧' : '右侧'}` : '左右侧可随时切换，计时会累加'}
        </div>
        <div className="sides">
          <button
            className={`side${side === 'left' ? ' side--on' : ''}${running && side === 'left' ? ' side--timing' : ''}`}
            onClick={() => onSide('left')}
          >
            <span className="side__label">
              <i className="side__dot" />
              左侧
            </span>
            <span className="side__time">{clock(Math.floor(leftSec))}</span>
          </button>
          <button
            className={`side${side === 'right' ? ' side--on' : ''}${running && side === 'right' ? ' side--timing' : ''}`}
            onClick={() => onSide('right')}
          >
            <span className="side__label">
              <i className="side__dot" />
              右侧
            </span>
            <span className="side__time">{clock(Math.floor(rightSec))}</span>
          </button>
        </div>
        <div className="timer__actions">
          <button className={`btn ${running ? 'btn--quiet' : 'btn--primary'}`} onClick={onToggle}>
            <Icon name={running ? 'pause' : 'play'} size={15} />
            {running ? '暂停计时' : hasBreast ? '继续计时' : '开始计时'}
          </button>
          <button className="btn btn--champagne" onClick={onEnd} disabled={!hasBreast}>
            <Icon name="check" size={15} />
            结束本节
          </button>
        </div>
      </div>
    </div>
  )
}
