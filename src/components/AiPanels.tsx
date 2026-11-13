import { useEffect, useState } from 'react'
import { Icon } from '../brand/icons'
import { useStore } from '../data/store'
import type { AppState } from '../data/types'
import { API } from '../data/config'
import { shrinkToDataURL } from '../lib/media'

export type GrowthAnalysis = {
  headline: string
  points: { label: string; text: string }[]
  tips: string[]
}

export type AlbumStory = { title: string; body: string }

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => null)) as (T & { message?: string }) | null
  if (!res.ok || !payload) {
    throw new Error(payload?.message || '暂时无法生成，请稍后再试')
  }
  return payload
}

async function postAi<T>(path: string, state: AppState): Promise<T> {
  return postJson<T>(path, { state })
}

const ANALYSIS_LINES = ['数这七天的喂养和睡眠…', '看体重曲线上的小拐点…', '把变化写成一句人话…']
const STORY_LINES = ['翻一翻这两个月的照片…', '想起第一次抬头的那天…', '把零散的瞬间连成一段…']
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function Thinking({ lines, progress }: { lines: string[]; progress?: string }) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => (value + 1) % lines.length), 2400)
    return () => clearInterval(timer)
  }, [lines])

  return (
    <div className="ai-panel__loading" role="status" aria-live="polite">
      <span className="ai-panel__pulse" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="ai-panel__line">{progress || lines[index]}</span>
      <span className="ai-panel__hint">
        {progress ? '正在读照片里的画面…' : '大约 15–40 秒，先别关掉页面'}
      </span>
    </div>
  )
}

export function GrowthAiCard() {
  const { state, toast } = useStore()
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const [analysis, setAnalysis] = useState<GrowthAnalysis | null>(null)

  const run = async () => {
    setPhase('loading')
    try {
      const payload = await postAi<{ analysis: GrowthAnalysis }>(API.aiAnalysis, state)
      setAnalysis(payload.analysis)
      setPhase('done')
    } catch {
      setPhase('idle')
      toast('AI 分析没接上，稍后再试一次')
    }
  }

  return (
    <section className={`ai-panel${phase === 'loading' ? ' ai-panel--busy' : ''}`} aria-busy={phase === 'loading'}>
      <header className="ai-panel__head">
        <span className="ai-panel__badge">
          <Icon name="sparkle" size={13} /> AI 成长分析
        </span>
        <span className="ai-panel__tag">近 7 天</span>
      </header>

      {phase === 'idle' ? (
        <>
          <h3 className="ai-panel__title">这一周，宝宝在往哪儿长</h3>
          <p className="ai-panel__desc">
            把喂养、睡眠和体重的变化读成一句话，再给两条今天就能试的小建议。
          </p>
          <button className="ai-panel__cta" onClick={run}>
            开始分析
          </button>
        </>
      ) : null}

      {phase === 'loading' ? <Thinking lines={ANALYSIS_LINES} /> : null}

      {phase === 'done' && analysis ? (
        <div className="ai-panel__result">
          <h3 className="ai-panel__title">{analysis.headline}</h3>
          <ul className="ai-points">
            {analysis.points.map((point) => (
              <li key={point.label} className="ai-point">
                <span className="ai-point__label">{point.label}</span>
                <span className="ai-point__text">{point.text}</span>
              </li>
            ))}
          </ul>
          <div className="ai-tips">
            <span className="ai-tips__label">可以试试</span>
            {analysis.tips.map((tip) => (
              <span key={tip} className="ai-tip">
                <Icon name="leaf" size={12} />
                {tip}
              </span>
            ))}
          </div>
          <footer className="ai-panel__foot">
            <span>根据近 7 天记录生成 · 仅供参考</span>
            <button className="ai-panel__again" onClick={run}>
              再分析一次
            </button>
          </footer>
        </div>
      ) : null}
    </section>
  )
}

export function AlbumAiCard() {
  const { state, dispatch, toast } = useStore()
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const [stage, setStage] = useState<'reading' | 'writing' | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [story, setStory] = useState<AlbumStory | null>(null)
  const [storyMeta, setStoryMeta] = useState<{ visuals: number } | null>(null)

  const run = async () => {
    const at = Date.now()
    const recent = [...state.photos].sort((a, b) => b.at - a.at).slice(0, 8)
    const missing = recent.filter((p) => !p.visualCaption?.trim())
    const queue = [...missing]
    const described: Record<string, string> = {}
    let done = 0
    let failed = 0

    setPhase('loading')
    setStory(null)
    setProgress({ done: 0, total: missing.length })
    setStage(missing.length ? 'reading' : 'writing')

    const worker = async () => {
      while (queue.length) {
        const photo = queue.shift()
        if (!photo) continue
        try {
          let lastError: unknown = null
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const image = await shrinkToDataURL(photo.thumb || photo.src, 768)
              const result = await postJson<{ description: string }>(API.aiDescribe, { image })
              const description = String(result.description || '').trim()
              if (!description) throw new Error('empty description')
              described[photo.id] = description
              lastError = null
              break
            } catch (error) {
              lastError = error
              if (attempt < 2) await wait(1200 * (attempt + 1))
            }
          }
          if (lastError) throw lastError
        } catch {
          failed += 1
        } finally {
          done += 1
          setProgress({ done, total: missing.length })
        }
      }
    }

    try {
      if (missing.length) {
        await Promise.all(
          Array.from({ length: 1 }, () => worker()),
        )
      }

      if (Object.keys(described).length) {
        dispatch({
          type: 'setPhotoVisuals',
          visuals: Object.entries(described).map(([id, visualCaption]) => ({
            id,
            visualCaption,
            visualAt: at,
          })),
        })
      }

      const photos = state.photos.map((p) =>
        described[p.id] ? { ...p, visualCaption: described[p.id], visualAt: at } : p,
      )
      setStage('writing')
      const payload = await postAi<{ story: AlbumStory }>(API.aiStory, { ...state, photos })
      setStory(payload.story)
      setStoryMeta({ visuals: photos.filter((p) => p.visualCaption?.trim()).length })
      setPhase('done')
      if (failed) toast(`有 ${failed} 张没读懂，先用标题写成了这一段`)
    } catch {
      setPhase('idle')
      toast('相册故事没写出来，稍后再试一次')
    } finally {
      setStage(null)
    }
  }

  return (
    <section className={`ai-panel${phase === 'loading' ? ' ai-panel--busy' : ''}`} aria-busy={phase === 'loading'}>
      <header className="ai-panel__head">
        <span className="ai-panel__badge">
          <Icon name="sparkle" size={13} /> AI 相册故事
        </span>
        <span className="ai-panel__tag">{state.photos.length} 个瞬间</span>
      </header>

      {phase === 'idle' ? (
        <>
          <h3 className="ai-panel__title">把这一册，写成一段故事</h3>
          <p className="ai-panel__desc">
            写给未来的她，也写给现在的你。
          </p>
          <button className="ai-panel__cta" onClick={run}>
            写一段相册故事
          </button>
        </>
      ) : null}

      {phase === 'loading' ? (
        <Thinking
          lines={STORY_LINES}
          progress={
            stage === 'reading'
              ? `正在看照片 ${progress.done}/${progress.total}…`
              : undefined
          }
        />
      ) : null}

      {phase === 'done' && story ? (
        <div className="ai-panel__result">
          <h3 className="ai-story__title">{story.title}</h3>
          <p className="ai-story__body">{story.body}</p>
          <footer className="ai-panel__foot">
            <span>
              {storyMeta?.visuals
                ? `读了 ${storyMeta.visuals} 张照片与成长里程碑`
                : '根据相册与成长记录生成'}
            </span>
            <button className="ai-panel__again" onClick={run}>
              再写一段
            </button>
          </footer>
        </div>
      ) : null}
    </section>
  )
}
