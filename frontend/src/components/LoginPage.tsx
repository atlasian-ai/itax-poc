import { useState, FormEvent } from 'react'
import { auth } from '../services/api'

interface Props {
  onLogin: () => void
}

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError(null)
    try {
      await auth.login(email, password)
      onLogin()
    } catch (err: any) {
      setError(err.message || '로그인에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <span style={s.logoMark}>i</span>
          <span style={s.logoText}>Tax</span>
        </div>
        <p style={s.subtitle}>법인세 세무서식 관리 시스템</p>

        <form onSubmit={handleSubmit} style={s.form}>
          <label style={s.label}>
            이메일
            <input
              type="email"
              style={s.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              autoFocus
              disabled={loading}
            />
          </label>

          <label style={s.label}>
            비밀번호
            <input
              type="password"
              style={s.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
            />
          </label>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, opacity: loading || !email || !password ? 0.6 : 1 }}
            disabled={loading || !email || !password}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p style={s.footer}>iTax PoC · 관리자 전용</p>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--c-form-bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Noto Sans KR', 'Malgun Gothic', sans-serif",
  },
  card: {
    background: 'var(--c-card-bg)',
    border: '1px solid var(--c-card-border)',
    borderRadius: 14,
    padding: '40px 44px',
    width: 380,
    boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logo: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
    marginBottom: 6,
  },
  logoMark: {
    fontSize: 38,
    fontWeight: 900,
    color: 'var(--c-accent)',
    fontStyle: 'italic',
    lineHeight: 1,
  },
  logoText: {
    fontSize: 32,
    fontWeight: 800,
    color: 'var(--c-text-primary)',
    lineHeight: 1,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--c-text-muted)',
    margin: '0 0 32px',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--c-text-secondary)',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid var(--c-input-border)',
    borderRadius: 7,
    fontSize: 14,
    background: 'var(--c-input-bg)',
    color: 'var(--c-text-primary)',
    outline: 'none',
  },
  error: {
    margin: 0,
    padding: '8px 12px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    fontSize: 13,
    color: '#dc2626',
  },
  btn: {
    marginTop: 4,
    padding: '11px',
    background: 'var(--c-accent)',
    color: 'var(--c-accent-fg)',
    border: 'none',
    borderRadius: 7,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    width: '100%',
  },
  footer: {
    marginTop: 28,
    fontSize: 11,
    color: 'var(--c-text-muted)',
  },
}
