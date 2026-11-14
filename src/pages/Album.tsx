import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../brand/icons'
import { TabHead, SectionHead } from '../components/Common'
import { AlbumAiCard } from '../components/AiPanels'
import { Sheet } from '../components/Sheet'
import { useStore, uid } from '../data/store'
import { usePhotoInk, usePhotoInkMap } from '../lib/photoTone'
import { ageBetween, fromISODate, longDate, monthDay, monthLabel, toISODate } from '../lib/date'
import { formatClipLength } from '../lib/media'
import { viewerName } from '../lib/viewer'
import { exitOverlay, pushOverlay } from '../lib/route'
import type { Photo } from '../data/types'
import { hasMotion, isVideoPhoto } from '../lib/photo'
import { isBeforeBirth } from '../lib/birth'

import { AlbumMoreCard, AlbumPhotoCard, KindBadge, requestCaptionTitles } from '../components/AlbumCards'
import type { AlbumDraft } from '../components/AlbumCards'
import { AlbumLightbox } from '../components/AlbumLightbox'
import { AlbumSelectBar } from '../components/AlbumSelectBar'
import { AlbumAddSheet } from '../components/AlbumAddSheet'
import { deletePhotos } from '../lib/photoDelete'
import { useLightboxZoom } from '../components/useLightboxZoom'

export default function AlbumPage() {
  const { state, dispatch, toast, canWrite } = useStore()
  const viewer = viewerName(state)
  const [filter, setFilter] = useState<'all' | string>('all')
  const [lightboxList, setLightboxList] = useState<Photo[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const [draft, setDraft] = useState<AlbumDraft | null>(null)
  const [captionEdit, setCaptionEdit] = useState<{ id: string; value: string } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const canDelete = state.family.some((m) => m.id === state.viewerId && m.permission === 'admin')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiTitles, setAiTitles] = useState<string[]>([])
  const aiSeq = useRef(0)
  const [ratio, setRatio] = useState(1)
  const [bare, setBare] = useState(false)
  const [slideDir, setSlideDir] = useState<'next' | 'prev'>('next')



  const photos = [...state.photos].sort((a, b) => b.at - a.at)
  const months = useMemo(() => {
    const keys: { key: string; label: string }[] = []
    for (const p of photos) {
      const d = new Date(p.at)
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`
      if (!keys.some((k) => k.key === key)) {
        keys.push({ key, label: `${d.getMonth() + 1} 月` })
      }
    }
    return keys
  }, [photos])

  const visible = filter === 'all' ? photos : photos.filter((p) => {
    const d = new Date(p.at)
    return `${d.getFullYear()}-${d.getMonth() + 1}` === filter
  })

  const lightbox = lightboxIndex === null ? null : lightboxList[lightboxIndex] ?? null
  const lightboxStill = lightbox ? !isVideoPhoto(lightbox) && !hasMotion(lightbox) : false
  const lightboxToneOK = lightbox ? !isVideoPhoto(lightbox) : false
  const coverImgRef = useRef<HTMLImageElement>(null)
  const coverInk = usePhotoInk(coverImgRef, photos[0]?.id)
  const lightboxImgRef = useRef<HTMLImageElement>(null)
  const lightboxInk = usePhotoInk(lightboxImgRef, lightbox?.id)
  // 明暗采样只覆盖当前这张和左右各一张：大相册打开时不再触发全册解码。
  const lightboxNeighbours = lightboxIndex === null
    ? []
    : lightboxList
        .slice(Math.max(0, lightboxIndex - 1), lightboxIndex + 2)
        .map((photo) => ({ id: photo.id, src: photo.src }))
  const lightboxTones = usePhotoInkMap(lightboxNeighbours, lightboxIndex !== null)
  const lightboxTone =
    lightboxInk ??
    (lightbox ? lightboxTones[lightbox.id] : null) ??
    (photos[0]?.id === lightbox?.id ? coverInk : null)

  const stepLightbox = useCallback(
    (delta: number) => {
      if (lightboxList.length < 2) return
      setSlideDir(delta > 0 ? 'next' : 'prev')
      setLightboxIndex((current) => {
        if (current === null) return current
        return Math.max(0, Math.min(lightboxList.length - 1, current + delta))
      })
    },
    [lightboxList.length],
  )

  const zoom = useLightboxZoom({
    ratio,
    canPinch: lightboxStill,
    resetKey: lightbox?.id,
    onSwipe: stepLightbox,
    onToggleBare: () => setBare((current) => !current),
  })

  useEffect(() => {
    setRatio(1)
  }, [lightbox?.id])

  const openLightbox = (photo: Photo) => {
    const index = visible.findIndex((p) => p.id === photo.id)
    setLightboxList(visible)
    setLightboxIndex(index >= 0 ? index : 0)
  }

  const openCover = (photo: Photo) => {
    setLightboxList([photo])
    setLightboxIndex(0)
  }

  useEffect(() => {
    if (lightboxIndex === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxIndex(null)
      if (zoom.scale > 1) return
      if (event.key === 'ArrowLeft') stepLightbox(-1)
      if (event.key === 'ArrowRight') stepLightbox(1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [lightboxIndex, zoom.scale, stepLightbox])

  useEffect(() => {
    if (!allOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onPop = () => {
      setLightboxIndex(null)
      setAllOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('popstate', onPop)
    }
  }, [allOpen])

  const openFullGallery = () => {
    setAllOpen(true)
    pushOverlay('album-all')
  }

  const closeFullGallery = () => {
    // 返回键会用同一条历史条目关掉「全部照片」；没有条目时才直接关
    if (!exitOverlay('album-all')) setAllOpen(false)
  }

  const photoCard = (p: Photo) => (
    <AlbumPhotoCard
      key={p.id}
      photo={p}
      onOpen={selectMode ? (photo) => toggleSelect(photo.id) : openLightbox}
      selectable={selectMode}
      selected={selected.includes(p.id)}
    />
  )

  const previewGrid = (items: Photo[]) => {
    const shown = selectMode ? items : items.length > 4 ? items.slice(0, 3) : items
    return (
      <div className="album-grid album-grid--rest album-grid--preview">
        {shown.map(photoCard)}
        {!selectMode && items.length > 4 ? (
          <AlbumMoreCard
            photo={items[3]}
            count={items.length - 3}
            onOpen={openFullGallery}
          />
        ) : null}
      </div>
    )
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const exitSelect = () => {
    setSelectMode(false)
    setSelected([])
  }

  const deleteSelected = async () => {
    if (!pendingDelete?.length || deleting) return
    const byId = new Map(state.photos.map((p) => [p.id, p]))
    const items = pendingDelete.map((id) => byId.get(id)).filter((p): p is Photo => !!p)
    setDeleting(true)
    const { removed, avatarBlocked, failed } = await deletePhotos(items)
    if (removed.length) {
      dispatch({ type: 'trashPhotos', photos: removed, deletedAt: Date.now() })
    }
    setDeleting(false)
    setPendingDelete(null)
    exitSelect()
    if (avatarBlocked) toast('有照片正在作为头像，先换掉头像再删')
    else if (failed) toast('有照片没能删掉，稍后再试')
    else if (removed.length) toast(`已移入最近删除 · ${removed.length} 项，7 天内可恢复`)
  }

  const groups = useMemo(() => {
    const out: { key: string; label: string; monthIndex: number; items: Photo[] }[] = []
    for (const p of visible) {
      const d = new Date(p.at)
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`
      const existing = out.find((g) => g.key === key)
      if (existing) existing.items.push(p)
      else
        out.push({
          key,
          label: monthLabel(p.at),
          monthIndex: Math.max(1, ageBetween(new Date(fromISODate(state.baby.birthday)), d).months + 1),
          items: [p],
        })
    }
    return out
  }, [visible, state.baby.birthday])

  const saveDraft = () => {
    if (!draft) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.atDate) || !/^\d{2}:\d{2}$/.test(draft.atTime)) {
      toast('请选择有效的日期和时间')
      return
    }
    const [hh, mm] = draft.atTime.split(':').map(Number)
    if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) {
      toast('请选择有效的时间')
      return
    }
    const at = fromISODate(draft.atDate, hh, mm)
    if (!Number.isFinite(at)) {
      toast('请选择有效的时间')
      return
    }
    if (at > Date.now() + 60_000) {
      toast('时间不能晚于现在')
      return
    }
    if (isBeforeBirth(at, state.baby)) {
      toast('照片不能早于宝宝的生日')
      return
    }
    const fallback = monthDay(at)
    const caption = draft.caption.trim() || fallback
    dispatch({
      type: 'addPhoto',
      photo: {
        id: uid('ph'),
        src: draft.src,
        thumb: draft.thumb,
        at,
        caption,
        author: viewer,
        kind: draft.kind,
        motion: draft.motion,
        video: draft.video,
        durationSec: draft.durationSec,
      },
    })
    setDraft(null)
    resetAi()
    setFilter('all')
    toast(draft.kind === 'video' ? '视频已加入相册' : draft.motion ? '会动的照片已加入相册' : '照片已加入相册')
  }

  const askAi = async (src: string, hint: string) => {
    const seq = ++aiSeq.current
    setAiBusy(true)
    setAiTitles([])
    try {
      const titles = await requestCaptionTitles(src, hint)
      if (seq === aiSeq.current) setAiTitles(titles)
    } catch (err) {
      if (seq === aiSeq.current) {
        const message = err instanceof Error ? err.message : '这次没想出合适的标题'
        toast(message.includes('fetch') ? 'AI 暂时连不上，先手动写一句吧' : message)
      }
    } finally {
      if (seq === aiSeq.current) setAiBusy(false)
    }
  }

  const resetAi = () => {
    aiSeq.current += 1
    setAiBusy(false)
    setAiTitles([])
  }

  const saveCaption = () => {
    if (!captionEdit) return
    const photo = state.photos.find((p) => p.id === captionEdit.id)
    if (!photo) return
    const caption = captionEdit.value.trim() || monthDay(photo.at)
    dispatch({ type: 'updatePhoto', id: photo.id, patch: { caption } })
    setCaptionEdit(null)
    resetAi()
    toast('标题已更新')
  }

  const milestones = [...state.milestones].sort((a, b) => b.at - a.at)
  const cover = photos[0] ?? null
  const scope = months.find((m) => m.key === filter)?.label

  return (
    <div className="page">
      <TabHead
        en="FAMILY ALBUM"
        title="成长相册"
        meta={
          filter === 'all'
            ? `${photos.length} 个瞬间 · ${months.length} 个月`
            : `${visible.length} 个瞬间 · ${scope ?? ''}`
        }
        right={
          <button className="icon-btn" aria-label="添加到相册" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={19} />
          </button>
        }
      />

      <div className="page__body">
        {cover ? (
          <button
            className="album-cover"
            data-kind={cover.kind ?? 'photo'}
            data-motion={hasMotion(cover) ? 'true' : 'false'}
            data-photo-ink={coverInk ?? undefined}
            onClick={() => openCover(cover)}
          >
            <img ref={coverImgRef} src={cover.src} alt={cover.caption} />
            <span className="album-cover__veil" />
            <span className="album-cover__tag">最近的一张</span>
            <KindBadge photo={cover} variant="cover" />
            <span className="album-cover__cap">
              <b>{cover.caption}</b>
              <span>
                {longDate(cover.at)} · {cover.author} {isVideoPhoto(cover) ? '录制' : '拍摄'}
                {hasMotion(cover) ? ' · live' : ''}
              </span>
            </span>
          </button>
        ) : null}

        <AlbumAiCard />

        <div className="album-filters">
          <div className="chip-row album-filters__chips">
            <button className={`chip${filter === 'all' ? ' chip--on' : ''}`} onClick={() => setFilter('all')}>
              全部 · {photos.length}
            </button>
            {months.map((m) => (
              <button
                key={m.key}
                className={`chip${filter === m.key ? ' chip--on' : ''}`}
                onClick={() => setFilter(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {canDelete && photos.length && !selectMode ? (
            <button type="button" className="album-select-btn" onClick={() => setSelectMode(true)}>
              <Icon name="check" size={13} />
              选择
            </button>
          ) : null}
        </div>

        {groups.length === 0 ? (
          <div className="empty" style={{ paddingTop: 60 }}>
            这里会慢慢装满成长的样子。
            <br />
            点击右上角，放入第一张照片或视频。
          </div>
        ) : filter === 'all' ? (
          previewGrid(visible)
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <div className="months">
                <span className="months__title">{g.label}</span>
                <span className="months__sub">
                  第 {g.monthIndex} 个月 · {g.items.length} 张
                </span>
              </div>
              {previewGrid(g.items)}
            </section>
          ))
        )}

        <section style={{ marginTop: 34 }}>
          <SectionHead title="成长时间轴" en="Milestones" />
          <div className="story">
            {milestones.map((m) => (
              <div key={m.id} className="story__item">
                <span className="story__dot" />
                <span className="story__text">
                  {m.title}
                  {m.note ? (
                    <span style={{ display: 'block', fontSize: 'calc(10.5px * var(--type-scale, 1))', color: 'var(--ink-3)', marginTop: 2 }}>{m.note}</span>
                  ) : null}
                </span>
                <span className="story__date">{longDate(m.at)}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="about-note">
          照片与成长数据仅家庭成员可见，默认不公开。
          <br />
          Nestory 珍藏每一个普通的日子。
        </p>
      </div>

      {selectMode ? (
        <AlbumSelectBar
          count={selected.length}
          onCancel={exitSelect}
          onDelete={() => setPendingDelete(selected)}
        />
      ) : null}

      <AlbumAddSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDraft={(next: AlbumDraft) => {
          resetAi()
          setDraft(next)
        }}
      />

      <Sheet
        open={!!draft}
        onClose={() => {
          setDraft(null)
          resetAi()
        }}
        title="这一刻"
        desc="给这一刻写一句话；不写就用日期当标题。"
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn--quiet"
              style={{ flex: 1 }}
              onClick={() => {
                setDraft(null)
                resetAi()
              }}
            >
              取消
            </button>
            <button className="btn btn--primary" style={{ flex: 2 }} onClick={saveDraft}>
              保存到相册
            </button>
          </div>
        }
      >
        {draft ? (
          <div className="album-draft">
            <div className="album-draft__media">
              <img src={draft.src} alt="" />
              {draft.kind === 'video' ? (
                <span className="album-badge album-badge--cover">
                  <Icon name="play" size={9} />
                  {formatClipLength(draft.durationSec) || '视频'}
                </span>
              ) : draft.motion ? (
                <span className="album-badge album-badge--live album-badge--cover">
                  <span className="album-badge__dot" />
                  live
                </span>
              ) : null}
            </div>
            <div className="field">
              <div className="album-ai__head">
                <span className="field__label">标题 · 选填</span>
                <button
                  type="button"
                  className="album-ai__ask"
                  disabled={aiBusy}
                  onClick={() => askAi(draft.src, `拍摄于 ${draft.atDate}`)}
                >
                  {aiBusy ? '正在想…' : '✦ 帮我想一句'}
                </button>
              </div>
              <input
                className="input"
                value={draft.caption}
                maxLength={24}
                placeholder="例如：睡着时的小呼吸"
                onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              />
              {aiTitles.length ? (
                <div className="album-ai__chips">
                  {aiTitles.map((title) => (
                    <button
                      key={title}
                      type="button"
                      className="album-ai__chip"
                      onClick={() => {
                        setDraft({ ...draft, caption: title })
                        setAiTitles([])
                      }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field__label">日期</span>
                <input
                  className="input"
                  type="date"
                  value={draft.atDate}
                  max={toISODate(Date.now())}
                  min={state.baby.birthday || undefined}
                  onChange={(e) => setDraft({ ...draft, atDate: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">时间</span>
                <input
                  className="input"
                  type="time"
                  value={draft.atTime}
                  onChange={(e) => setDraft({ ...draft, atTime: e.target.value })}
                />
              </label>
            </div>
            <p className="media-note">标题之后也可以随时修改。</p>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={!!captionEdit}
        onClose={() => {
          setCaptionEdit(null)
          resetAi()
        }}
        title="修改标题"
        footer={
          <button className="btn btn--primary btn--full" onClick={saveCaption}>
            保存标题
          </button>
        }
      >
        {captionEdit ? (
          <div className="field">
            <div className="album-ai__head">
              <span className="field__label">给这一刻写一句话</span>
              <button
                type="button"
                className="album-ai__ask"
                disabled={aiBusy}
                onClick={() => {
                  const photo = state.photos.find((p) => p.id === captionEdit.id)
                  if (photo) askAi(photo.src, `拍摄于 ${monthDay(photo.at)}`)
                }}
              >
                {aiBusy ? '正在想…' : '✦ 帮我想一句'}
              </button>
            </div>
            <input
              className="input"
              value={captionEdit.value}
              maxLength={24}
              placeholder="留空会用日期当标题"
              onChange={(e) => setCaptionEdit({ ...captionEdit, value: e.target.value })}
            />
            <span className="field__hint">留空时，标题会变成拍摄日期。</span>
            {aiTitles.length ? (
              <div className="album-ai__chips">
                {aiTitles.map((title) => (
                  <button
                    key={title}
                    type="button"
                    className="album-ai__chip"
                    onClick={() => {
                      setCaptionEdit({ ...captionEdit, value: title })
                      setAiTitles([])
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={!!pendingDelete}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        title="移入最近删除？"
        desc="照片会保留 7 天，期间家人看不到，但你可以从「最近删除」恢复。7 天后自动彻底删除，无法找回。"
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn--quiet"
              style={{ flex: 1 }}
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              再想想
            </button>
            <button
              className="btn btn--primary"
              style={{ flex: 2 }}
              disabled={deleting}
              onClick={deleteSelected}
            >
              {deleting ? '正在移入…' : `移入回收站${pendingDelete?.length ? ` · ${pendingDelete.length} 项` : ''}`}
            </button>
          </div>
        }
      >
        <p className="album-trash-note">
          {pendingDelete?.length
            ? `将移入最近删除：${pendingDelete
                .map((id) => state.photos.find((p) => p.id === id)?.caption ?? '')
                .filter(Boolean)
                .slice(0, 3)
                .join('、')}${pendingDelete.length > 3 ? ' 等' : ''}`
            : ''}
        </p>
      </Sheet>


      {allOpen ? (
        <div className="album-all" role="dialog" aria-modal="true" aria-label="全部照片">
          <div className="album-all__inner">
            <header className="album-all__head">
              <button className="icon-btn" aria-label="返回相册" onClick={closeFullGallery}>
                <Icon name="chevronLeft" size={20} />
              </button>
              <div className="album-all__title">
                <b>{filter === 'all' ? '全部照片' : `${months.find((m) => m.key === filter)?.label ?? ''}照片`}</b>
                <span>共 {visible.length} 张 · 按时间倒序</span>
              </div>
              <span className="album-all__spacer" aria-hidden="true" />
            </header>
            <div className="album-all__body">
              <div className="album-grid album-grid--rest album-grid--full">{visible.map(photoCard)}</div>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox && lightboxIndex !== null ? (
        <AlbumLightbox
          photo={lightbox}
          index={lightboxIndex}
          still={lightboxStill}
          total={lightboxList.length}
          step={stepLightbox}
          bare={bare}
          slideDir={slideDir}
          zoom={zoom}
          onRatio={setRatio}
          tone={lightboxToneOK ? lightboxTone ?? undefined : undefined}
          canWrite={canWrite}
          canDelete={canDelete}
          imgRef={lightboxImgRef}
          onClose={() => setLightboxIndex(null)}
          onEdit={() => {
            setLightboxIndex(null)
            setCaptionEdit({ id: lightbox.id, value: lightbox.caption })
          }}
          onDelete={() => {
            setLightboxIndex(null)
            setPendingDelete([lightbox.id])
          }}
        />
      ) : null}
    </div>
  )
}


