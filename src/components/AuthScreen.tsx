import { useState } from 'react'
import type { FormEvent } from 'react'
import type { RegisterInput } from '../data/api'
import { ApiError } from '../data/api'

type Props = {
  onSignIn: (email: string, password: string) => Promise<void>
  onSignUp: (input: RegisterInput) => Promise<void>
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function AuthScreen({ onSignIn, onSignUp }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    const mail = email.trim().toLowerCase()
    if (!EMAIL_RE.test(mail)) {
      setError('请输入有效的邮箱地址')
      return
    }
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (mode === 'register') {
      if (!nickname.trim()) {
        setError('给自己起个昵称吧')
        return
      }
    }

    setBusy(true)
    try {
      if (mode === 'login') {
        await onSignIn(mail, password)
      } else {
        await onSignUp({ email: mail, password, nickname: nickname.trim() })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <div className="auth__mark">N</div>
          <h1 className="auth__name">Nestory</h1>
          <p className="auth__kicker">FAMILY STORIES</p>
        </div>
        <p className="auth__lede">把宝宝的每一天，收进一个只属于你们的小巢。</p>

        <div className="auth__card">
          <div className="auth__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`auth__tab${mode === 'login' ? ' is-on' : ''}`}
              onClick={() => switchMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={`auth__tab${mode === 'register' ? ' is-on' : ''}`}
              onClick={() => switchMode('register')}
            >
              注册
            </button>
          </div>

          <form className="auth__form" onSubmit={submit} noValidate>
            <label className="field">
              <span className="field__label">邮箱</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className="field">
              <span className="field__label">密码</span>
              <input
                className="input"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={mode === 'login' ? '输入密码' : '至少 8 位'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {mode === 'register' && (
              <>
                <label className="field">
                  <span className="field__label">你的昵称</span>
                  <input
                    className="input"
                    type="text"
                    autoComplete="nickname"
                    placeholder="例如：小柚妈妈"
                    maxLength={60}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </label>
              </>
            )}

            {error && (
              <p className="auth__error" role="alert">
                {error}
              </p>
            )}

            <button className="btn btn--primary btn--full auth__submit" type="submit" disabled={busy}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}
            </button>
          </form>

          <p className="auth__note">
            账号与记录保存在本机 <b>MySQL</b> 里
            <br />
            浏览器只保留一个登录 Cookie，换设备需要重新登录
          </p>
        </div>
      </div>
    </div>
  )
}
