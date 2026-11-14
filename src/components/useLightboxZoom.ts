import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

type Gesture = {
  x: number
  y: number
  at: number
  moved: boolean
  offsetX: number
  offsetY: number
  scale: number
  onVideo: boolean
  captured: boolean
}

type Pinch = {
  dist: number
  midX: number
  midY: number
  scale: number
  offsetX: number
  offsetY: number
}

export type LightboxZoomOptions = {
  /** 图片宽高比，用来把平移限制在图片自己的范围内 */
  ratio: number
  /** 视频 / Live 照片不参与双指缩放 */
  canPinch: boolean
  /** 横向滑动：+1 下一张，-1 上一张 */
  onSwipe: (delta: number) => void
  /** 单击（非双击）切换沉浸模式 */
  onToggleBare: () => void
  /** 换图时把缩放归位；值变化即重置 */
  resetKey?: string
}

/**
 * 灯箱里的缩放 / 拖拽 / 双指捏合 / 双击放大 / 单击沉浸。
 *
 * 从 Album.tsx 里整块搬出来的：原来这段手势状态和业务状态混在同一个
 * 1100 行组件里，改一处布局要读 300 行指针逻辑。现在组件只负责取景，
 * 手势全部收敛在这里，默认缩放 1 倍、平移 (0,0)。
 */
export function useLightboxZoom({
  ratio,
  canPinch,
  onSwipe,
  onToggleBare,
  resetKey,
}: LightboxZoomOptions) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [gesturing, setGesturing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const pinch = useRef<Pinch | null>(null)
  const tapTimer = useRef<number | null>(null)
  const lastTap = useRef(0)

  const clampOffset = (x: number, y: number, nextScale: number) => {
    const stage = stageRef.current
    if (!stage) return { x, y }
    const W = stage.clientWidth
    const H = stage.clientHeight
    let baseW = W
    let baseH = W / ratio
    if (baseH > H) {
      baseH = H
      baseW = H * ratio
    }
    const maxX = Math.max(0, (baseW * nextScale - W) / 2)
    const maxY = Math.max(0, (baseH * nextScale - H) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }

  const toggleZoom = () => {
    if (scale > 1) {
      setScale(1)
      setOffset({ x: 0, y: 0 })
      return
    }
    setScale(2)
    setOffset(clampOffset(0, 0, 2))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const onVideo = !!(event.target as HTMLElement).closest('video')
    const captured = !onVideo
    if (captured) event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 1) {
      gesture.current = {
        x: event.clientX,
        y: event.clientY,
        at: Date.now(),
        moved: false,
        offsetX: offset.x,
        offsetY: offset.y,
        scale,
        onVideo,
        captured,
      }
      setGesturing(true)
      return
    }

    if (pointers.current.size === 2) {
      if (!canPinch) {
        gesture.current = null
        pinch.current = null
        return
      }
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        scale,
        offsetX: offset.x,
        offsetY: offset.y,
      }
      gesture.current = null
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = null
      }
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const nextScale = Math.min(4, Math.max(1, (pinch.current.scale * dist) / Math.max(1, pinch.current.dist)))
      setScale(nextScale)
      setOffset(
        clampOffset(
          pinch.current.offsetX + (midX - pinch.current.midX),
          pinch.current.offsetY + (midY - pinch.current.midY),
          nextScale,
        ),
      )
      return
    }

    const start = gesture.current
    if (!start || pointers.current.size !== 1) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) + Math.abs(dy) > 6) start.moved = true
    if (start.scale > 1) {
      setOffset(clampOffset(start.offsetX + dx, start.offsetY + dy, start.scale))
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    const start = gesture.current
    if (start?.captured) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* pointer already released */
      }
    }
    if (pointers.current.size > 0) return

    setGesturing(false)

    if (pinch.current) {
      pinch.current = null
      if (scale < 1.03) {
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
      return
    }

    if (!start) return
    gesture.current = null
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2 && scale <= 1.01) {
      onSwipe(dx < 0 ? 1 : -1)
      return
    }

    if (start.onVideo) return

    if (start.moved || Date.now() - start.at > 320) return

    const now = Date.now()
    if (now - lastTap.current < 350) {
      lastTap.current = 0
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = null
      }
      toggleZoom()
      return
    }

    lastTap.current = now
    tapTimer.current = window.setTimeout(() => {
      onToggleBare()
      lastTap.current = 0
      tapTimer.current = null
    }, 300)
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) {
      gesture.current = null
      pinch.current = null
      setGesturing(false)
    }
  }

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [resetKey])

  useEffect(() => {
    return () => {
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current)
    }
  }, [])

  return {
    scale,
    offset,
    gesturing,
    stageRef,
    toggleZoom,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  }
}
