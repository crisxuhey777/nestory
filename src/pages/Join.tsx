import { useEffect, useState } from 'react'
import { Icon } from '../brand/icons'
import { ScreenHead } from '../components/Common'
import { ApiError, api } from '../data/api'
import type { InvitePreview, Permission } from '../data/api'
import { useStore } from '../data/store'
import { getHashParam, navigate } from '../lib/route'
import { PERMISSIONS } from '../data/config'

const LABEL = Object.fromEntries(PERMISSIONS.map((item) => [item.key, item.short])) as Record<
  Permission,
  string
>

type View =
  | { status: 'loading' }
  | { status: 'ok'; preview: InvitePreview }
  | { status: 'used' | 'expired' | 'invalid' }
  | { status: 'error'; message: string }

export default function JoinPage() {
  const { reload, toast } = useStore()
  const [token] = useState(() => getHashParam('t') ?? '')
  const [view, setView] = useState<View>({ status: 'loading' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = '加入家庭 · Nestory'
    if (!token) {
      setView({ status: 'invalid' })
      return
    }
    let alive = true
    void api
      .previewInvite(token)
      .then((preview) => {
        if (!alive) return
        if (preview.status === 'ok') setView({ status: 'ok', preview })
        else setView({ status: preview.status })
      })
      .catch((error: unknown) => {
        if (!alive) return
        if (error instanceof ApiError && error.status === 404) {
          setView({ status: 'invalid' })
          return
        }
        setView({
          status: 'error',
          message: error instanceof Error ? error.message : '邀请加载失败',
        })
      })
    return () => {
      alive = false
    }
  }, [token])

  const join = async () => {
    if (busy || !token) return
    setBusy(true)
    try {
      await api.joinFamily(token)
      await reload()
      toast('已加入这个家庭，之后看到的记录会和家人同步')
      navigate('home', undefined, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入失败，请稍后再试'
      toast(message)
      setBusy(false)
    }
  }

  return (
    <div className="page page--sub">
      <ScreenHead title="加入家庭" sub="JOIN THE NEST" back="home" />
      <div className="page__body" style={{ paddingBottom: 56 }}>
        {view.status === 'loading' ? (
          <p className="timer__hint" style={{ marginTop: 48, textAlign: 'center' }}>
            正在打开邀请…
          </p>
        ) : null}

        {view.status === 'ok' ? (
          <section className="panel" style={{ marginTop: 24, textAlign: 'center' }}>
            <span className="join-mark">
              <Icon name="family" size={26} />
            </span>
            <div className="eyebrow" style={{ marginTop: 12 }}>
              FAMILY INVITE
            </div>
            <h2 className="join-title">{view.preview.household.name}</h2>
            <p className="about-copy">
              {view.preview.inviter} 邀请你一起记录宝宝的成长。加入后，你们会看到同一份喂养、睡眠与照片。
            </p>
            <p className="join-perm">
              {LABEL[view.preview.permission]} · 邀请 {new Date(view.preview.expiresAt).toLocaleDateString('zh-CN')} 前有效
            </p>
            <button
              className="btn btn--primary btn--full"
              type="button"
              disabled={busy}
              onClick={() => void join()}
            >
              {busy ? '正在加入…' : '加入这个家庭'}
            </button>
            <button
              className="btn btn--quiet btn--full"
              style={{ marginTop: 10 }}
              type="button"
              onClick={() => navigate('home')}
            >
              先不加入
            </button>
          </section>
        ) : null}

        {view.status === 'used' ? (
          <EmptyState
            title="这个邀请已经被使用过了"
            body="每个邀请链接只能使用一次。请让家人重新生成一个，或者直接用账号登录已有的家庭。"
          />
        ) : null}

        {view.status === 'expired' ? (
          <EmptyState
            title="这个邀请已经过期"
            body="邀请链接的有效期是 7 天。请让家人重新生成一个链接，再发给你。"
          />
        ) : null}

        {view.status === 'invalid' ? (
          <EmptyState title="邀请链接不完整" body="链接可能换行被截断了，请让家人重新复制一次完整的链接。" />
        ) : null}

        {view.status === 'error' ? (
          <EmptyState title="暂时打不开这个邀请" body={view.message} retry={() => window.location.reload()} />
        ) : null}
      </div>
    </div>
  )
}

function EmptyState({ title, body, retry }: { title: string; body: string; retry?: () => void }) {
  return (
    <section className="panel" style={{ marginTop: 24, textAlign: 'center' }}>
      <span className="join-mark">
        <Icon name="family" size={26} />
      </span>
      <h2 className="join-title" style={{ marginTop: 14 }}>
        {title}
      </h2>
      <p className="about-copy">{body}</p>
      {retry ? (
        <button className="btn btn--quiet btn--full" type="button" onClick={retry}>
          重新加载
        </button>
      ) : null}
      <button
        className="btn btn--primary btn--full"
        style={{ marginTop: retry ? 10 : 0 }}
        type="button"
        onClick={() => navigate('home')}
      >
        回到首页
      </button>
    </section>
  )
}
