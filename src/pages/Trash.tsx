import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { useStore } from '../data/store'
import { ApiError, mediaApi } from '../data/api'
import type { TrashItemDto } from '../data/api'
import { getRouteFrom, navigate } from '../lib/route'
import type { Route } from '../lib/route'
import { monthDay } from '../lib/date'
import type { Photo, TrashItem } from '../data/types'

const DAY = 86_400_000

function mediaIdOf(src: string): string | null {
  const match = /\/api\/media\/blob\/([A-Za-z0-9_-]+)/.exec(src)
  return match ? match[1] : null
}

function daysLeft(expiresAt: string | null): number {
  const at = expiresAt ? Date.parse(expiresAt) : NaN
  if (!Number.isFinite(at)) return 7
  return Math.max(0, Math.ceil((at - Date.now()) / DAY))
}

export default function TrashPage() {
  const { state, dispatch, toast } = useStore()
  const from: Route = getRouteFrom() === 'profile' ? 'profile' : 'album'
  const backLabel = from === 'profile' ? '回到我的' : '回到相册'
  const isAdmin = state.family.some((m) => m.id === state.viewerId && m.permission === 'admin')
  const [items, setItems] = useState<TrashItemDto[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = () => {
    setError('')
    mediaApi
      .trash()
      .then((res) => setItems(res.items))
      .catch((err: unknown) => {
        setItems([])
        setError(err instanceof ApiError ? err.message : '没能打开最近删除')
      })
  }

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin])

  const local = useMemo(() => {
    const map = new Map<string, Photo>()
    for (const entry of state.trash ?? []) {
      const id = mediaIdOf(entry.src)
      if (id) map.set(id, entry)
    }
    return map
  }, [state.trash])

  const localOnly = useMemo(() => {
    const known = new Set((items ?? []).map((item) => item.id))
    const now = Date.now()
    return (state.trash ?? []).filter((entry) => {
      const id = mediaIdOf(entry.src)
      if (id && known.has(id)) return false
      return entry.deletedAt + 7 * DAY > now
    })
  }, [items, state.trash])

  const restoreLocal = (entry: TrashItem) => {
    dispatch({ type: 'restorePhotos', ids: [entry.id] })
    toast('已恢复到相册')
  }
  const restore = async (item: TrashItemDto) => {
    if (busyId) return
    setBusyId(item.id)
    try {
      await mediaApi.restore(item.id)
      const saved = local.get(item.id)
      if (saved) {
        dispatch({ type: 'restorePhotos', ids: [saved.id] })
      } else {
        dispatch({
          type: 'addPhoto',
          photo: {
            id: `ph_${item.id}`,
            src: item.url,
            thumb: item.url,
            at: item.deletedAt ? Date.parse(item.deletedAt) : Date.now(),
            caption: '恢复的照片',
            author: item.author,
          },
        })
      }
      setItems((prev) => (prev ?? []).filter((x) => x.id !== item.id))
      toast('已恢复到相册')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'trash_expired') {
        setItems((prev) => (prev ?? []).filter((x) => x.id !== item.id))
        const saved = local.get(item.id)
        if (saved) dispatch({ type: 'dropTrash', ids: [saved.id] })
        toast('这张照片已经超过 7 天，自动删除了')
      } else {
        toast(err instanceof ApiError ? err.message : '恢复失败，稍后再试')
      }
    } finally {
      setBusyId('')
    }
  }

  if (!isAdmin) {
    return (
      <div className="page page--sub">
        <ScreenHead title="最近删除" sub="RECENTLY DELETED" back={from} />
        <div className="page__body">
          <div className="empty" style={{ paddingTop: 60 }}>
            只有家庭管理员可以查看最近删除。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page page--sub">
      <ScreenHead title="最近删除" sub="RECENTLY DELETED" back={from} />
      <div className="page__body">
        <p className="about-note" style={{ marginTop: 0 }}>
          删掉的照片会在这里留 7 天。7 天后自动彻底删除，无法找回。
        </p>

        {error ? (
          <div className="empty" style={{ paddingTop: 40 }}>
            {error}
            <br />
            <button type="button" className="link-btn" onClick={load}>
              再试一次
            </button>
          </div>
        ) : items === null ? (
          <div className="empty" style={{ paddingTop: 40 }}>
            正在打开…
          </div>
        ) : items.length === 0 && localOnly.length === 0 ? (
          <div className="empty" style={{ paddingTop: 60 }}>
            这里空着。
            <br />
            删除的照片会先放进这里，7 天内都可以恢复。
          </div>
        ) : (
          <div className="trash-list">
            {items.map((item) => {
              const left = daysLeft(item.expiresAt)
              const saved = local.get(item.id)
              return (
                <div className="trash-card" key={item.id}>
                  <div className="trash-card__thumb">
                    {item.kind === 'video' ? (
                      <span className="trash-card__video">
                        <Icon name="play" size={16} />
                      </span>
                    ) : (
                      <img src={item.url} alt={saved?.caption ?? '已删除的照片'} loading="lazy" />
                    )}
                  </div>
                  <div className="trash-card__body">
                    <b>{saved?.caption ?? '照片'}</b>
                    <span className="trash-card__meta">
                      {saved ? monthDay(saved.at) : item.author || '家人'} · 还剩 {left} 天
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--quiet trash-card__restore"
                    disabled={!!busyId}
                    onClick={() => restore(item)}
                  >
                    {busyId === item.id ? '恢复中' : '恢复'}
                  </button>
                </div>
              )
            })}
            {localOnly.map((entry) => {
              const left = Math.max(0, Math.ceil((entry.deletedAt + 7 * DAY - Date.now()) / DAY))
              return (
                <div className="trash-card" key={entry.id}>
                  <div className="trash-card__thumb">
                    {entry.kind === 'video' ? (
                      <span className="trash-card__video">
                        <Icon name="play" size={16} />
                      </span>
                    ) : (
                      <img src={entry.thumb || entry.src} alt={entry.caption || '已删除的照片'} loading="lazy" />
                    )}
                  </div>
                  <div className="trash-card__body">
                    <b>{entry.caption || '照片'}</b>
                    <span className="trash-card__meta">
                      {entry.author || '家人'} · 还剩 {left} 天
                    </span>
                  </div>
                  <button type="button" className="btn btn--quiet trash-card__restore" onClick={() => restoreLocal(entry)}>
                    恢复
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <button type="button" className="link-btn" style={{ marginTop: 24 }} onClick={() => navigate(from, 'trash')}>
          {backLabel}
        </button>
      </div>
    </div>
  )
}
