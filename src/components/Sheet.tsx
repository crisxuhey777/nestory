import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { registerSheet } from '../lib/sheets'

export function Sheet({
  open,
  onClose,
  title,
  desc,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  desc?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef({ startY: 0, lastY: 0, lastMoveAt: 0, active: false })
  const closeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  // 关闭后重置下拉位移，避免下一次打开仍停在半空
  useEffect(() => {
    if (open) {
      setDragY(0)
      setDragging(false)
    }
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [open])

  // 登记给返回键处理：有抽屉开着时，返回先关抽屉而不是弹退出确认
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    return registerSheet(() => closeRef.current())
  }, [open])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return
    drag.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastMoveAt: performance.now(),
      active: true,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return
    const dy = Math.max(0, event.clientY - drag.current.startY)
    drag.current.lastY = event.clientY
    drag.current.lastMoveAt = performance.now()
    setDragY(dy)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!drag.current.active) return
    drag.current.active = false
    setDragging(false)
    const dy = Math.max(0, event.clientY - drag.current.startY)
    const quick = dy > 48 && performance.now() - drag.current.lastMoveAt < 130
    const shouldClose = !cancelled && (dy > 116 || quick)
    if (shouldClose) {
      setDragY(Math.max(540, window.innerHeight * 0.8))
      closeTimer.current = window.setTimeout(onClose, 170)
      return
    }
    setDragY(0)
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        className="sheet-backdrop"
        onClick={onClose}
        aria-hidden="true"
        style={{ opacity: dragY > 0 ? Math.max(0.25, 1 - dragY / 420) : undefined }}
      />
      <div
        className={`sheet${dragging ? ' sheet--dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={dragY > 0 ? { transform: `translate(-50%, ${dragY}px)` } : undefined}
      >
        <div
          className="sheet__head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
        >
          <div className="sheet__grab" />
          <div>
            <h3 className="sheet__title">{title}</h3>
            {desc ? <p className="sheet__desc">{desc}</p> : null}
          </div>
        </div>
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__foot">{footer}</div> : null}
      </div>
    </>,
    document.body,
  )
}
