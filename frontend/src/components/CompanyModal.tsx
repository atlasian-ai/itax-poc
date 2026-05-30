import { useState } from 'react'
import { api } from '../services/api'
import type { Company } from '../types'

interface Props {
  company?: Company
  onClose: () => void
  onSaved: (company: Company) => void
}

export function CompanyModal({ company, onClose, onSaved }: Props) {
  const [name, setName] = useState(company?.name ?? '')
  const [bizNo, setBizNo] = useState(company?.business_reg_no ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const body = { name: name.trim(), business_reg_no: bizNo.trim() }
      const result = company
        ? await api.updateCompany(company.id, body)
        : await api.createCompany(body)
      onSaved(result)
      onClose()
    } catch (e: any) {
      setError(e.message ?? '저장 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <h2 style={s.title}>{company ? '법인 수정' : '새 법인 추가'}</h2>
        <label style={s.label}>
          법인명 <span style={s.required}>*</span>
          <input
            style={s.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예) (주)한국산업"
            disabled={loading}
            autoFocus
          />
        </label>
        <label style={s.label}>
          사업자등록번호
          <input
            style={s.input}
            value={bizNo}
            onChange={(e) => setBizNo(e.target.value)}
            placeholder="예) 123-45-67890"
            disabled={loading}
          />
        </label>
        {error && <p style={s.error}>{error}</p>}
        <div style={s.actions}>
          <button style={s.btnSecondary} onClick={onClose} disabled={loading}>취소</button>
          <button
            className="btn-accent"
            style={{ ...s.btnPrimary, opacity: !name.trim() || loading ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
          >
            {loading ? '저장 중...' : '저장'}
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
    background: 'var(--c-modal-bg)', borderRadius: 12, padding: 28, width: 420,
    boxShadow: '0 20px 60px rgba(0,0,0,.3)',
  },
  title: { margin: '0 0 20px', fontSize: 17, fontWeight: 700, color: 'var(--c-text-primary)' },
  label: {
    display: 'flex', flexDirection: 'column', gap: 5,
    fontSize: 13, color: 'var(--c-text-secondary)', marginBottom: 14,
  },
  required: { color: '#dc2626' },
  input: {
    padding: '8px 10px', border: '1px solid var(--c-input-border)', borderRadius: 6,
    fontSize: 14, color: 'var(--c-text-primary)', background: 'var(--c-input-bg)',
  },
  error: { color: '#dc2626', fontSize: 13, margin: '0 0 12px' },
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
