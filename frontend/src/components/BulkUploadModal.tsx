import { useRef, useState } from 'react'
import { api } from '../services/api'

interface FileStatus {
  file: File
  state: 'queued' | 'processing' | 'done' | 'error'
  result?: string
  error?: string
}

interface Props {
  onClose: () => void
  onDone: () => void
}

const CONCURRENCY = 10

export function BulkUploadModal({ onClose, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [files, setFiles] = useState<FileStatus[]>([])
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []).filter(
      (f) => f.type === 'application/pdf'
    )
    setFiles(picked.map((f) => ({ file: f, state: 'queued' })))
    setFinished(false)
  }

  async function handleStart() {
    if (!effectiveFrom || files.length === 0) return
    setRunning(true)

    const queue = [...files.map((_, i) => i)]
    const inProgress = new Set<number>()
    const statuses = files.map((fs) => ({ ...fs }))
    setFiles([...statuses])

    async function processOne(idx: number) {
      statuses[idx] = { ...statuses[idx], state: 'processing' }
      setFiles([...statuses])

      const formData = new FormData()
      formData.append('pdfs', statuses[idx].file)
      formData.append('effective_from', effectiveFrom)

      try {
        const res = await fetch('/api/forms/bulk-upload', {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        const item = Array.isArray(data) ? data[0] : data
        if (item?.status === 'error') {
          statuses[idx] = { ...statuses[idx], state: 'error', error: item.error }
        } else {
          statuses[idx] = {
            ...statuses[idx],
            state: 'done',
            result: item?.result?.form_name || item?.form_name || '완료',
          }
        }
      } catch (e: unknown) {
        statuses[idx] = {
          ...statuses[idx],
          state: 'error',
          error: e instanceof Error ? e.message : String(e),
        }
      }
      inProgress.delete(idx)
      setFiles([...statuses])
    }

    // Semaphore-style dispatch
    const workers: Promise<void>[] = []
    for (let i = 0; i < Math.min(CONCURRENCY, files.length); i++) {
      const runChain = async () => {
        while (queue.length > 0) {
          const idx = queue.shift()!
          inProgress.add(idx)
          await processOne(idx)
        }
      }
      workers.push(runChain())
    }
    await Promise.all(workers)

    setRunning(false)
    setFinished(true)
  }

  const doneCount = files.filter((f) => f.state === 'done').length
  const errorCount = files.filter((f) => f.state === 'error').length
  const processingCount = files.filter((f) => f.state === 'processing').length

  return (
    <div style={s.backdrop}>
      <div style={s.modal}>
        <div style={s.header}>
          <span style={s.title}>일괄 서식 업로드</span>
          <button style={s.closeBtn} onClick={onClose} disabled={running}>✕</button>
        </div>

        <div style={s.body}>
          <label style={s.label}>시행일자 (effective_from)</label>
          <input
            style={s.input}
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            disabled={running}
          />

          <label style={s.label}>PDF 파일 선택 (여러 개 가능)</label>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            style={{ display: 'none' }}
            onChange={handleFilePick}
          />
          <button
            style={s.pickBtn}
            onClick={() => inputRef.current?.click()}
            disabled={running}
          >
            파일 선택…
          </button>

          {files.length > 0 && (
            <div style={s.fileList}>
              <div style={s.fileListHeader}>
                {files.length}개 파일
                {running && <span style={s.badge}> · 처리 중 {processingCount}</span>}
                {finished && (
                  <span style={s.badge}>
                    {' '}· 완료 {doneCount} / 오류 {errorCount}
                  </span>
                )}
              </div>
              {files.map((fs, i) => (
                <div key={i} style={s.fileRow}>
                  <span style={stateIcon[fs.state]}>{stateEmoji[fs.state]}</span>
                  <span style={s.fileName}>{fs.file.name}</span>
                  {fs.result && <span style={s.fileResult}>{fs.result}</span>}
                  {fs.error && <span style={s.fileError}>{fs.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={s.footer}>
          {finished ? (
            <button className="btn-accent" style={s.primaryBtn} onClick={() => { onDone(); onClose() }}>
              완료 (서식 목록 새로고침)
            </button>
          ) : (
            <button
              className="btn-accent"
              style={s.primaryBtn}
              onClick={handleStart}
              disabled={running || files.length === 0 || !effectiveFrom}
            >
              {running ? `업로드 중… (${doneCount + errorCount}/${files.length})` : '업로드 시작'}
            </button>
          )}
          <button style={s.cancelBtn} onClick={onClose} disabled={running}>취소</button>
        </div>
      </div>
    </div>
  )
}

const stateEmoji: Record<FileStatus['state'], string> = {
  queued: '⏳',
  processing: '⚙️',
  done: '✅',
  error: '❌',
}

const stateIcon: Record<FileStatus['state'], React.CSSProperties> = {
  queued: { color: '#94a3b8', fontSize: 13 },
  processing: { color: '#f59e0b', fontSize: 13 },
  done: { color: 'var(--c-success)', fontSize: 13 },
  error: { color: '#dc2626', fontSize: 13 },
}

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'var(--c-modal-overlay)',
    zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--c-modal-bg)', borderRadius: 10, width: 560, maxHeight: '80vh',
    display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.3)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid var(--c-card-border)',
  },
  title: { fontWeight: 700, fontSize: 15, color: 'var(--c-text-primary)' },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 16, color: 'var(--c-text-muted)', padding: 4,
  },
  body: { padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--c-text-secondary)' },
  input: {
    padding: '8px 12px', border: '1px solid var(--c-input-border)', borderRadius: 6,
    fontSize: 13, outline: 'none', background: 'var(--c-input-bg)', color: 'var(--c-text-primary)',
  },
  pickBtn: {
    alignSelf: 'flex-start', padding: '8px 16px', background: 'var(--c-meta-label-bg)',
    border: '1px solid var(--c-card-border)', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: 600, color: 'var(--c-text-secondary)',
  },
  fileList: {
    marginTop: 8, border: '1px solid var(--c-card-border)', borderRadius: 6,
    maxHeight: 280, overflowY: 'auto',
  },
  fileListHeader: {
    padding: '8px 12px', background: 'var(--c-form-bg)', borderBottom: '1px solid var(--c-card-border)',
    fontSize: 12, fontWeight: 600, color: 'var(--c-text-muted)',
  },
  badge: { fontWeight: 400 },
  fileRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px', borderBottom: '1px solid var(--c-divider)', fontSize: 12,
  },
  fileName: { flex: 1, color: 'var(--c-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fileResult: { color: 'var(--c-success)', fontSize: 11, flexShrink: 0 },
  fileError: { color: '#dc2626', fontSize: 11, flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' },
  footer: {
    display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--c-card-border)',
    justifyContent: 'flex-end',
  },
  primaryBtn: {
    padding: '8px 20px', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  },
  cancelBtn: {
    padding: '8px 16px', background: 'transparent', color: 'var(--c-text-muted)',
    border: '1px solid var(--c-input-border)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
}
