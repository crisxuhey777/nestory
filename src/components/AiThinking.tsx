import { useEffect, useState } from 'react'
import { NestoryMark } from '../brand/Logo'

const LINES = [
  '回看今天的第一餐…',
  '数一数睡了几段…',
  '把细碎的时刻，写成一句话…',
]

/**
 * 等服务端 + 大模型返回时的全屏引导层。
 * 不显示进度条，只循环播放呼吸动画和文案（模型耗时不可预测）。
 */
export default function AiThinking({ name }: { name: string }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((n) => (n + 1) % LINES.length), 2600)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="ai-thinking" role="status" aria-live="polite" aria-label="正在生成今日小结">
      <div className="ai-thinking__nest">
        <span className="ai-thinking__ring" />
        <span className="ai-thinking__ring ai-thinking__ring--late" />
        <span className="ai-thinking__core">
          <NestoryMark size={30} />
        </span>
      </div>

      <div className="ai-thinking__title">正在为{name}写今日小结</div>
      <div className="ai-thinking__line">{LINES[index]}</div>

      <div className="ai-thinking__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <p className="ai-thinking__hint">大约 10–30 秒，先别关掉页面</p>
    </div>
  )
}
