import { useState } from 'react'
import type { FormTemplate, FieldDefinition } from '../types'
import { api } from '../services/api'

interface Props {
  template: FormTemplate
  onSaved: (updated: FormTemplate) => void
}

export function FormulaEditor({ template, onSaved }: Props) {
  const [fields, setFields] = useState<FieldDefinition[]>(template.fields)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<FieldDefinition>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [filter, setFilter] = useState<'all' | 'calculated' | 'input'>('all')

  function startEdit(field: FieldDefinition) {
    setEditingId(field.id)
    setDraft({ ...field })
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({})
  }

  function applyEdit() {
    setFields((prev) =>
      prev.map((f) => (f.id === editingId ? { ...f, ...draft } as FieldDefinition : f))
    )
    setEditingId(null)
    setDraft({})
  }

  async function handleSaveAll() {
    setSaving(true)
    setSaved(false)
    try {
      // PATCH the fields array back via a dedicated endpoint
      // For now we use a workaround: re-upload via form update
      const res = await fetch(`/api/forms/${template.id}/fields`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      setSaved(true)
      onSaved(updated)
    } finally {
      setSaving(false)
    }
  }

  const visible = fields.filter(
    (f) => filter === 'all' || f.type === filter
  )

  return (
    <div style={s.container}>
      <div style={s.toolbar}>
        <div style={s.filters}>
          {(['all', 'input', 'calculated'] as const).map((v) => (
            <button
              key={v}
              style={{ ...s.filterBtn, ...(filter === v ? s.filterBtnActive : {}) }}
              onClick={() => setFilter(v)}
            >
              {v === 'all' ? '전체' : v === 'input' ? '입력 필드' : '계산 필드'}
            </button>
          ))}
        </div>
        <div style={s.actions}>
          {saved && <span style={s.savedMsg}>✓ 저장됨</span>}
          <button className="btn-accent" style={s.saveBtn} onClick={handleSaveAll} disabled={saving}>
            {saving ? '저장 중...' : '변경사항 저장'}
          </button>
        </div>
      </div>

      <div style={s.info}>
        <span style={s.infoText}>
          AI가 추출한 필드 정의를 검토하고 수정하세요. 계산식은 필드 번호로 작성합니다 (예: <code>01 + 02 - 03</code>).
        </span>
      </div>

      <table style={s.table}>
        <thead>
          <tr style={s.thead}>
            <th style={s.th}>번호</th>
            <th style={s.th}>레이블</th>
            <th style={s.th}>섹션</th>
            <th style={s.th}>유형</th>
            <th style={s.th}>계산식</th>
            <th style={s.th}></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((field) => {
            const isEditing = editingId === field.id
            return (
              <tr key={field.id} style={field.type === 'calculated' ? s.rowCalc : s.row}>
                <td style={s.tdNum}>{field.id}</td>

                {isEditing ? (
                  <>
                    <td style={s.td}>
                      <input
                        style={s.editInput}
                        value={draft.label ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                      />
                    </td>
                    <td style={s.td}>
                      <input
                        style={s.editInput}
                        value={draft.section ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, section: e.target.value }))}
                      />
                    </td>
                    <td style={s.td}>
                      <select
                        style={s.editSelect}
                        value={draft.type ?? 'input'}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            type: e.target.value as 'input' | 'calculated',
                            formula: e.target.value === 'input' ? null : d.formula,
                          }))
                        }
                      >
                        <option value="input">입력</option>
                        <option value="calculated">계산</option>
                      </select>
                    </td>
                    <td style={s.td}>
                      <input
                        style={s.editInput}
                        value={draft.formula ?? ''}
                        placeholder={draft.type === 'calculated' ? '예: 01 + 02 - 03' : '—'}
                        disabled={draft.type === 'input'}
                        onChange={(e) => setDraft((d) => ({ ...d, formula: e.target.value || null }))}
                      />
                    </td>
                    <td style={s.tdAction}>
                      <button className="btn-accent" style={s.applyBtn} onClick={applyEdit}>확인</button>
                      <button style={s.cancelBtn} onClick={cancelEdit}>취소</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={s.td}>{field.label}</td>
                    <td style={s.tdSection}>{field.section}</td>
                    <td style={s.td}>
                      <span style={typeBadge(field.type)}>
                        {field.type === 'calculated' ? '계산' : '입력'}
                      </span>
                    </td>
                    <td style={s.tdFormula}>
                      {field.formula ? (
                        <code style={s.formulaCode}>{field.formula}</code>
                      ) : (
                        <span style={s.noFormula}>—</span>
                      )}
                    </td>
                    <td style={s.tdAction}>
                      <button style={s.editBtn} onClick={() => startEdit(field)}>
                        수정
                      </button>
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const typeBadge = (type: string): React.CSSProperties => ({
  fontSize: 11, padding: '2px 8px', borderRadius: 10,
  background: type === 'calculated' ? 'var(--c-accent-subtle-bg)' : 'var(--c-meta-label-bg)',
  color: type === 'calculated' ? 'var(--c-accent-subtle-text)' : 'var(--c-text-secondary)',
  fontWeight: 600,
})

const s: Record<string, React.CSSProperties> = {
  container: { padding: '0 0 40px', height: '100%', overflowY: 'auto' as const, boxSizing: 'border-box' as const },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 28px', background: 'var(--c-topbar-bg)', borderBottom: '1px solid var(--c-divider)',
    position: 'sticky' as const, top: 0, zIndex: 10,
  },
  filters: { display: 'flex', gap: 6 },
  filterBtn: {
    padding: '5px 14px', border: '1px solid var(--c-card-border)', borderRadius: 6,
    background: 'var(--c-card-bg)', color: 'var(--c-text-secondary)', cursor: 'pointer', fontSize: 12,
  },
  filterBtnActive: { background: 'var(--c-accent)', color: 'var(--c-accent-fg)', borderColor: 'var(--c-accent)' },
  actions: { display: 'flex', alignItems: 'center', gap: 10 },
  savedMsg: { fontSize: 12, color: 'var(--c-success)', fontWeight: 600 },
  saveBtn: {
    padding: '7px 18px', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  },
  info: { padding: '10px 28px', background: 'var(--c-form-bg)', borderBottom: '1px solid var(--c-divider)' },
  infoText: { fontSize: 12, color: 'var(--c-text-muted)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  thead: { background: 'var(--c-form-bg)' },
  th: {
    padding: '10px 16px', textAlign: 'left' as const, fontSize: 11,
    fontWeight: 700, color: 'var(--c-text-muted)', borderBottom: '2px solid var(--c-divider)',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  },
  row: { borderBottom: '1px solid var(--c-divider)' },
  rowCalc: { borderBottom: '1px solid var(--c-divider)', background: 'var(--c-row-active)' },
  tdNum: { padding: '9px 16px', fontWeight: 700, color: 'var(--c-text-muted)', width: 56 },
  td: { padding: '9px 16px', color: 'var(--c-text-primary)' },
  tdSection: { padding: '9px 16px', color: 'var(--c-text-secondary)', fontSize: 12, maxWidth: 160 },
  tdFormula: { padding: '9px 16px' },
  tdAction: { padding: '9px 16px', width: 100 },
  formulaCode: {
    background: 'var(--c-meta-label-bg)', padding: '2px 8px', borderRadius: 4,
    fontSize: 12, color: 'var(--c-accent-subtle-text)', fontFamily: 'monospace',
  },
  noFormula: { color: 'var(--c-text-muted)' },
  editInput: {
    width: '100%', padding: '4px 8px', border: '1px solid #93c5fd',
    borderRadius: 4, fontSize: 13, outline: 'none',
    background: 'var(--c-input-bg)', color: 'var(--c-text-primary)',
  },
  editSelect: {
    padding: '4px 8px', border: '1px solid #93c5fd',
    borderRadius: 4, fontSize: 13,
    background: 'var(--c-input-bg)', color: 'var(--c-text-primary)',
  },
  editBtn: {
    padding: '4px 12px', background: 'var(--c-meta-label-bg)', border: '1px solid var(--c-card-border)',
    borderRadius: 4, cursor: 'pointer', fontSize: 12, color: 'var(--c-text-primary)',
  },
  applyBtn: {
    padding: '4px 10px', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 4,
  },
  cancelBtn: {
    padding: '4px 10px', background: 'var(--c-card-bg)', color: 'var(--c-text-secondary)',
    border: '1px solid var(--c-card-border)', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
}
