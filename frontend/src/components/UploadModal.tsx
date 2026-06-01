import { useState, useEffect } from 'react'
import { api } from '../services/api'
import type { FormTemplate } from '../types'
import { BboxAnnotator } from './BboxAnnotator'

interface Props {
  onClose: () => void
  onUploaded: () => void
}

const STEPS = [
  { key: 'upload', label: 'PDF 업로드 중...' },
  { key: 'extract', label: 'AI가 필드 및 계산식 추출 중...' },
  { key: 'save', label: 'Supabase에 저장 중...' },
]

const NEW_FORM = '__new__'

type Phase = 'form' | 'uploading' | 'annotate'

export function UploadModal({ onClose, onUploaded }: Props) {
  const [phase, setPhase] = useState<Phase>('form')
  const [file, setFile] = useState<File | null>(null)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [formCodeHint, setFormCodeHint] = useState(NEW_FORM)
  const [existingForms, setExistingForms] = useState<FormTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<number>(-1)
  const [progress, setProgress] = useState<{ page: number; total: number; formName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Queue of forms to annotate one by one
  const [annotateQueue, setAnnotateQueue] = useState<FormTemplate[]>([])
  const [annotateTotal, setAnnotateTotal] = useState(0)
  const annotateTemplate = annotateQueue[0] ?? null
  const annotateIndex = annotateTotal - annotateQueue.length

  useEffect(() => {
    api.listForms().then(setExistingForms).catch(() => {})
  }, [])

  const isUpdate = formCodeHint !== NEW_FORM
  const selectedForm = existingForms.find((f) => f.form_code === formCodeHint)

  async function handleSubmit() {
    if (!file || !effectiveFrom) return
    setLoading(true)
    setError(null)
    setProgress(null)
    setPhase('uploading')

    try {
      setStep(0)
      const formData = new FormData()
      formData.append('pdf', file)
      formData.append('effective_from', effectiveFrom)
      if (isUpdate) formData.append('form_code_hint', formCodeHint)

      setStep(1)
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/forms/upload`, { method: 'POST', body: formData })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.detail || `서버 오류 ${response.status}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event = JSON.parse(line.slice(6))
          if (event.type === 'extracting') {
            setProgress({ page: event.page, total: event.total_pages, formName: event.form_name })
          } else if (event.type === 'saving') {
            setStep(2)
            setProgress(null)
          } else if (event.type === 'done') {
            const forms: FormTemplate[] = event.results ?? []
            if (forms.length > 0) {
              // Always annotate — queue all forms, show one at a time
              setAnnotateQueue(forms)
              setAnnotateTotal(forms.length)
              setPhase('annotate')
              setLoading(false)
              return
            }
            setLoading(false)
            return
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        }
      }
    } catch (e: any) {
      setError(e.message ?? '업로드 실패. 잠시 후 다시 시도해주세요.')
      setPhase('form')
      setStep(-1)
    } finally {
      setLoading(false)
    }
  }

  // Annotation complete for one form — advance to the next, or finish
  function handleAnnotationDone() {
    setAnnotateQueue((prev) => {
      const next = prev.slice(1)
      if (next.length === 0) {
        // All forms annotated
        onUploaded()
        onClose()
      }
      return next
    })
  }

  // Show the BboxAnnotator fullscreen when in annotate phase
  if (phase === 'annotate' && annotateTemplate) {
    return (
      <BboxAnnotator
        template={annotateTemplate}
        formIndex={annotateIndex}
        totalForms={annotateTotal}
        onDone={handleAnnotationDone}
      />
    )
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>NTS 세무서식 업로드</h2>
        <p style={styles.desc}>
          PDF를 업로드하면 AI가 자동으로 필드와 계산식을 추출합니다.
        </p>

        {/* Form code selector */}
        <label style={styles.label}>
          서식 구분 <span style={styles.optionalBadge}>단일 서식 PDF에만 적용</span>
          <select
            style={styles.select}
            value={formCodeHint}
            disabled={loading}
            onChange={(e) => setFormCodeHint(e.target.value)}
          >
            <option value={NEW_FORM}>— 새 서식 (신규 등록)</option>
            {existingForms.map((f) => (
              <option key={f.id} value={f.form_code}>
                {f.form_code} · {f.form_name}
              </option>
            ))}
          </select>
        </label>

        {/* Update notice */}
        {isUpdate && selectedForm && (
          <div style={styles.updateNotice}>
            <span style={styles.updateIcon}>↑</span>
            <div>
              <strong>{selectedForm.form_name}</strong> 업데이트로 처리됩니다.
              <div style={styles.updateSub}>
                현재 버전 v{selectedForm.version_tag}이 비활성화되고 마이그레이션 맵이 생성됩니다.
              </div>
            </div>
          </div>
        )}

        <label style={styles.label}>
          서식 PDF
          <input
            type="file"
            accept="application/pdf"
            style={styles.fileInput}
            disabled={loading}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <label style={styles.label}>
          적용 시작일 (사업연도 기준)
          <input
            type="date"
            style={styles.input}
            value={effectiveFrom}
            disabled={loading}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </label>

        {/* Progress */}
        {loading && (
          <div style={styles.progress}>
            {STEPS.map((s, i) => (
              <div key={s.key} style={styles.stepRow}>
                <span style={styles.stepIcon(i, step)}>
                  {i < step ? '✓' : i === step ? <Spinner /> : '○'}
                </span>
                <span style={styles.stepLabel(i, step)}>
                  {i === 1 && progress
                    ? `AI가 필드 및 계산식 추출 중... (${progress.page}/${progress.total} 페이지)${progress.formName ? ` — ${progress.formName}` : ''}`
                    : s.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.actions}>
          <button style={styles.btnSecondary} onClick={onClose} disabled={loading}>
            취소
          </button>
          <button
            className="btn-accent"
            style={{ ...styles.btnPrimary, opacity: (!file || !effectiveFrom || loading) ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={!file || !effectiveFrom || loading}
          >
            {loading ? 'AI 분석 중...' : isUpdate ? '업데이트 업로드' : '업로드'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return <span className="spinner">⟳</span>
}

const styles: Record<string, any> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--c-modal-overlay)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: 'var(--c-modal-bg)', borderRadius: 12, padding: 32, width: 460,
    boxShadow: '0 20px 60px rgba(0,0,0,.3)',
  },
  title: { margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--c-text-primary)' },
  desc: { margin: '0 0 20px', fontSize: 13, color: 'var(--c-text-muted)' },
  label: {
    display: 'flex', flexDirection: 'column', gap: 6,
    fontSize: 13, color: 'var(--c-text-secondary)', marginBottom: 16,
  },
  select: {
    padding: '8px 10px', border: '1px solid var(--c-input-border)', borderRadius: 6,
    fontSize: 13, background: 'var(--c-input-bg)', color: 'var(--c-text-primary)',
  },
  updateNotice: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    background: 'var(--c-accent-subtle-bg)', border: '1px solid var(--c-accent-subtle-border)', borderRadius: 8,
    padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--c-accent-subtle-text)',
  },
  updateIcon: { fontSize: 16, fontWeight: 800, flexShrink: 0, marginTop: 1 },
  updateSub: { fontSize: 11, color: 'var(--c-accent-subtle-text)', marginTop: 3, opacity: 0.8 },
  fileInput: { padding: '6px 0' },
  optionalBadge: {
    marginLeft: 6, fontSize: 10, color: 'var(--c-text-muted)',
    background: 'var(--c-meta-label-bg)', padding: '1px 6px',
    borderRadius: 4, border: '1px solid var(--c-card-border)',
  },
  input: { padding: '8px 10px', border: '1px solid var(--c-input-border)', borderRadius: 6, fontSize: 14, background: 'var(--c-input-bg)', color: 'var(--c-text-primary)' },
  progress: {
    margin: '16px 0', padding: '16px', background: 'var(--c-form-bg)',
    borderRadius: 8, border: '1px solid var(--c-card-border)', display: 'flex', flexDirection: 'column', gap: 10,
  },
  stepRow: { display: 'flex', alignItems: 'center', gap: 10 },
  stepIcon: (i: number, current: number) => ({
    fontSize: i < current ? 14 : 16,
    color: i < current ? 'var(--c-success)' : i === current ? 'var(--c-accent)' : 'var(--c-text-muted)',
    width: 20, textAlign: 'center', flexShrink: 0,
  }),
  stepLabel: (i: number, current: number) => ({
    fontSize: 13,
    color: i < current ? 'var(--c-success)' : i === current ? 'var(--c-accent-subtle-text)' : 'var(--c-text-muted)',
    fontWeight: i === current ? 600 : 400,
  }),
  error: { color: '#dc2626', fontSize: 13, margin: '0 0 12px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  btnPrimary: {
    padding: '9px 22px', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnSecondary: {
    padding: '9px 22px', background: 'var(--c-card-bg)', color: 'var(--c-text-secondary)',
    border: '1px solid var(--c-input-border)', borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
}
