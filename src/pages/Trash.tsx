import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { useStore } from '../data/store'
import { ApiError, mediaApi } from '../data/api'
import type { TrashItemDto } from '../data/api'
import { getRouteFrom, navigate } from '../lib/route'
import type { Route } from '../lib/route'
import { monthDay } from '../lib/date'
import { mediaIdsOf } from '../lib/media'
import type { Photo, TrashItem } from '../data/types'

const DAY = 86_400_000

function daysLeft(expiresAt: string | null): number {
  const at = expiresAt ? Date.parse(expiresAt) : NaN
  if (!Number.isFinite(at)) return 7
  return Math.max(0, Math.ceil((at - Date.now()) / DAY))
}

export default function TrashPage() {
  const { state, dispatch, toast } = useStore()
  const from: Route = getRouteFrom() === 'profile' ? 'profile' : 'album'
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
      const id = mediaIdsOf(entry.src)[0]
      if (id) map.set(id, entry)
    }
    return map
  }, [state.trash])

  const localOnly = useMemo(() => {
    const known = new Set((items ?? []).map((item) => item.id))
    const now = Date.now()
    return (state.trash ?? []).filter((entry) => {
      const id = mediaIdsOf(entry.src)[0]
      if (id && known.has(id)) return false
      return entry.deletedAt + 7 * DAY > now
    })
  }, [items, state.trash])

  // 只有本地元数据、服务端回收站列表里没有的条目：恢复也必须先让服务端解除软删，
  // 否则 7 天后对象被清掉，相册里只会剩一张裂图。
  const restoreLocal = async (entry: TrashItem) => {
    if (busyId) return
    const id = mediaIdsOf(entry.src, entry.thumb)[0]
    if (!id) {
      dispatch({ type: 'restorePhotos', ids: [entry.id] })
      toast('已恢复到相册（这张照片没有云端副本）')
      return
    }
    setBusyId(entry.id)
    try {
      await mediaApi.restore(id)
      dispatch({ type: 'restorePhotos', ids: [entry.id] })
      toast('已恢复到相册')
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'trash_expired' || err.status === 410)) {
        dispatch({ type: 'dropTrash', ids: [entry.id] })
        toast('这张照片已经超过 7 天，自动删除了')
      } else if (err instanceof ApiError && err.status === 404) {
        dispatch({ type: 'restorePhotos', ids: [entry.id] })
        toast('已恢复到相册，但这张照片可能没有云端副本')
      } else {
        toast(err instanceof ApiError ? err.message : '恢复失败，稍后再试')
      }
    } finally {
      setBusyId('')
    }
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
      <div className="page__body trash-body">
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
                  <button
                    type="button"
                    className="btn btn--quiet trash-card__restore"
                    disabled={!!busyId}
                    onClick={() => void restoreLocal(entry)}
                  >
                    {busyId === entry.id ? '恢复中' : '恢复'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <button
          type="button"
          className="link-btn trash-back"
          onClick={() => navigate(from, 'trash')}
        >
          {from === 'profile' ? '我的' : '相册'}
        </button>
      </div>
    </div>
  )
}
