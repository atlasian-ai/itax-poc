import { useState } from 'react'

interface Props {
  companyName: string
  onClose: () => void
  onConfirm: (from: string, to: string) => void
}

export function TaxYearModal({ companyName, onClose, onConfirm }: Props) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const valid = from && to && from <= to

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <h2 style={s.title}>새 사업연도 추가</h2>
        <p style={s.sub}>{companyName}</p>
        <label style={s.label}>
          사업연도 시작일
          <input
            type="date"
            style={s.input}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            autoFocus
          />
        </label>
        <label style={s.label}>
          사업연도 종료일
          <input
            type="date"
            style={s.input}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {from && to && from > to && (
          <p style={s.error}>종료일은 시작일 이후여야 합니다.</p>
        )}
        <div style={s.actions}>
          <button style={s.btnSecondary} onClick={onClose}>취소</button>
          <button
            className="btn-accent"
            style={{ ...s.btnPrimary, opacity: valid ? 1 : 0.5 }}
            disabled={!valid}
            onClick={() => onConfirm(from, to)}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--c-modal-overlay)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  },
  modal: {
    background: 'var(--c-modal-bg)', borderRadius: 12, padding: 28, width: 380,
    boxShadow: '0 20px 60px rgba(0,0,0,.3)',
  },
  title: { margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--c-text-primary)' },
  sub: { margin: '0 0 20px', fontSize: 13, color: 'var(--c-text-muted)' },
  label: {
    display: 'flex', flexDirection: 'column', gap: 5,
    fontSize: 13, color: 'var(--c-text-secondary)', marginBottom: 14,
  },
  input: {
    padding: '8px 10px', border: '1px solid var(--c-input-border)',
    borderRadius: 6, fontSize: 14, color: 'var(--c-text-primary)', background: 'var(--c-input-bg)',
  },
  error: { color: '#dc2626', fontSize: 12, margin: '0 0 12px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  btnPrimary: {
    padding: '8px 20px', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnSecondary: {
    padding: '8px 20px', background: 'var(--c-card-bg)', color: 'var(--c-text-secondary)',
    border: '1px solid var(--c-input-border)', borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
}
