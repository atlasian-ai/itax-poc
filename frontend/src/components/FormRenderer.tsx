import { useState } from 'react'
import type { Company, FormTemplate, FormEntry } from '../types'
import { useFormCalculation } from '../hooks/useFormCalculation'
import { PrintView } from './PrintView'
import { TabularRenderer } from './TabularRenderer'
import { api } from '../services/api'

interface Props {
  template: FormTemplate
  entry: FormEntry | null
  company: Company | null
  fiscalYearFrom: string
  fiscalYearTo: string
  onSaved: (entry: FormEntry) => void
}

export function FormRenderer({ template, entry, company, fiscalYearFrom, fiscalYearTo, onSaved }: Props) {
  const isTabular = template.form_type === 'tabular'

  // ── Flat form state ──────────────────────────────────────────
  const [values, setValues] = useState<Record<string, number | null>>(() => {
    if (isTabular) return {}
    const fv = entry?.field_values
    return (fv && !('_rows' in fv) ? fv : {}) as Record<string, number | null>
  })
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({})

  // ── Tabular form state ───────────────────────────────────────
  type Row = Record<string, number | string | null>
  const [tabularRows, setTabularRows] = useState<Row[]>(() => {
    if (!isTabular) return []
    const fv = entry?.field_values
    return (fv && '_rows' in fv ? fv._rows : []) as Row[]
  })

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showPrint, setShowPrint] = useState(false)

  const computed = useFormCalculation(template.fields, values)
  const sections = [...new Set(template.fields.map((f) => f.section))]

  function handleInput(id: string, raw: string) {
    setRawInputs((prev) => ({ ...prev, [id]: raw }))
    const cleaned = raw.replace(/,/g, '')
    if (cleaned === '' || cleaned === '-') return
    const n = Number(cleaned)
    if (!isNaN(n)) setValues((prev) => ({ ...prev, [id]: n }))
  }

  function handleBlur(id: string) {
    setRawInputs((prev) => { const next = { ...prev }; delete next[id]; return next })
  }

  async function handleSave(status: 'draft' | 'final') {
    setSaving(true)
    setSaveError(null)
    try {
      const body = {
        template_id: template.id,
        company_id: company?.id ?? null,
        fiscal_year_from: fiscalYearFrom || null,
        fiscal_year_to: fiscalYearTo || null,
        field_values: isTabular ? { _rows: tabularRows } : computed,
        status,
      }
      const saved = entry
        ? await api.updateEntry(entry.id, body)
        : await api.createEntry(body)
      onSaved(saved)
    } catch (e: any) {
      setSaveError(e.message ?? '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const printFieldValues = isTabular ? { _rows: tabularRows } : computed
  const printEntry: FormEntry = {
    ...(entry ?? {
      id: '',
      template_id: template.id,
      company_id: company?.id ?? null,
      fiscal_year_from: fiscalYearFrom || null,
      fiscal_year_to: fiscalYearTo || null,
      field_values: printFieldValues,
      status: 'draft' as const,
      created_at: '',
      updated_at: '',
    }),
    field_values: printFieldValues,
    fiscal_year_from: fiscalYearFrom || null,
    fiscal_year_to: fiscalYearTo || null,
  }

  return (
    <div style={styles.container}>
      {/* Action bar */}
      <div style={styles.actionBar}>
        <div style={styles.actionBarLeft}>
          <span style={entry?.status === 'final' ? styles.statusFinal : styles.statusDraft}>
            {entry?.status === 'final' ? '✓ 확정됨' : '● 임시저장'}
          </span>
          {entry?.updated_at && (
            <span style={styles.lastSaved}>
              마지막 저장: {formatSavedAt(entry.updated_at)}
            </span>
          )}
        </div>
        {saveError && <span style={styles.saveError}>⚠ {saveError}</span>}
        <div style={styles.actions}>
          {entry && (
            <button style={styles.btnPrint} onClick={() => setShowPrint(true)}>
              🖨 인쇄 미리보기
            </button>
          )}
          <button style={styles.btnSecondary} onClick={() => handleSave('draft')} disabled={saving}>
            임시저장
          </button>
          <button className="btn-accent" style={styles.btnPrimary} onClick={() => handleSave('final')} disabled={saving}>
            확정
          </button>
        </div>
      </div>

      {/* Meta: company info (read-only) + fiscal year range */}
      <div style={styles.meta}>
        <div style={styles.metaField}>
          <span>법인명</span>
          <span style={styles.metaReadonly}>{company?.name ?? '—'}</span>
        </div>
        <div style={styles.metaField}>
          <span>사업자등록번호</span>
          <span style={styles.metaReadonly}>{company?.business_reg_no || '—'}</span>
        </div>
        <div style={styles.metaField}>
          <span>사업연도 시작일</span>
          <span style={styles.metaReadonly}>{fiscalYearFrom || '—'}</span>
        </div>
        <div style={styles.metaField}>
          <span>사업연도 종료일</span>
          <span style={styles.metaReadonly}>{fiscalYearTo || '—'}</span>
        </div>
      </div>

      {/* Tabular form */}
      {isTabular && (
        <div style={{ padding: '0 28px 28px' }}>
          <TabularRenderer
            template={template}
            initialRows={tabularRows}
            onChange={setTabularRows}
          />
        </div>
      )}

      {/* Flat form: fields grouped by section */}
      {!isTabular && sections.map((section) => {
        const sectionFields = template.fields.filter((f) => f.section === section)
        return (
          <div key={section} style={styles.section}>
            <h2 style={styles.sectionTitle}>{section}</h2>
            <table style={styles.table}>
              <tbody>
                {sectionFields.map((field) => {
                  const isCalc = field.type === 'calculated'
                  const val = computed[field.id]
                  const isNew = template.migration_map?.added.includes(field.id)
                  const formulaChanged = template.migration_map?.formula_changed.includes(field.id)

                  return (
                    <tr key={field.id} style={isCalc ? styles.rowCalc : {}}>
                      <td style={styles.cellNum}>{field.id}</td>
                      <td style={styles.cellLabel}>
                        {field.label}
                        {isNew && <span style={styles.badgeNew}>신규</span>}
                        {formulaChanged && <span style={styles.badgeChanged}>수식변경</span>}
                      </td>
                      <td style={styles.cellInput}>
                        {isCalc ? (
                          <span style={styles.calcValue}>
                            {val != null ? val.toLocaleString('ko-KR') : '—'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            inputMode="numeric"
                            style={styles.input}
                            value={
                              rawInputs[field.id] !== undefined
                                ? rawInputs[field.id]
                                : val != null ? val.toLocaleString('ko-KR') : ''
                            }
                            onChange={(e) => handleInput(field.id, e.target.value)}
                            onBlur={() => handleBlur(field.id)}
                            placeholder="0"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}

      {showPrint && (
        <PrintView
          template={template}
          entry={printEntry}
          company={company}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  )
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}시간 전`
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const styles: Record<string, any> = {
  container: {
    flex: 1, overflowY: 'auto', padding: '0 0 40px',
    background: 'var(--c-form-bg)',
    fontFamily: "'Noto Sans KR', 'Malgun Gothic', sans-serif",
  },
  actionBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 28px', background: 'var(--c-topbar-bg)',
    borderBottom: '1px solid var(--c-divider)', marginBottom: 20,
    position: 'sticky' as const, top: 0, zIndex: 10,
  },
  actionBarLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  statusDraft: { fontSize: 12, color: 'var(--c-text-muted)' },
  statusFinal: { fontSize: 12, color: 'var(--c-success)', fontWeight: 600 },
  lastSaved: { fontSize: 11, color: 'var(--c-text-muted)' },
  saveError: { fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca' },
  actions: { display: 'flex', gap: 8 },
  btnPrimary: {
    padding: '8px 20px', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnPrint: {
    padding: '8px 16px', background: 'var(--c-card-bg)', color: 'var(--c-accent-subtle-text)',
    border: '1px solid var(--c-accent-subtle-border)', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
  },
  btnSecondary: {
    padding: '8px 20px', background: 'var(--c-card-bg)', color: 'var(--c-text-secondary)',
    border: '1px solid var(--c-input-border)', borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
  meta: {
    display: 'flex', gap: 16, marginBottom: 24, padding: '14px 28px',
    background: 'var(--c-topbar-bg)', borderBottom: '1px solid var(--c-divider)',
  },
  metaField: {
    display: 'flex', flexDirection: 'column', gap: 4,
    fontSize: 12, color: 'var(--c-text-secondary)', flex: 1,
  },
  metaReadonly: { fontSize: 14, color: 'var(--c-text-primary)', padding: '6px 0' },
  metaInput: {
    padding: '6px 10px', border: '1px solid var(--c-input-border)',
    borderRadius: 4, fontSize: 14, background: 'var(--c-input-bg)', color: 'var(--c-text-primary)',
  },
  section: { marginBottom: 28, padding: '0 28px' },
  sectionTitle: {
    fontSize: 12, fontWeight: 700, color: 'var(--c-accent)',
    margin: '0 0 8px', paddingBottom: 6, borderBottom: '2px solid var(--c-accent-subtle-border)',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  },
  table: {
    width: '100%', borderCollapse: 'collapse' as const, background: 'var(--c-card-bg)',
    borderRadius: 8, overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: '1px solid var(--c-card-border)',
  },
  rowCalc: { background: 'var(--c-row-active)' },
  cellNum: {
    width: 48, padding: '8px 12px', color: 'var(--c-text-muted)',
    fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--c-divider)',
  },
  cellLabel: { padding: '8px 12px', fontSize: 13, color: 'var(--c-text-secondary)', borderBottom: '1px solid var(--c-divider)' },
  cellInput: { width: 180, padding: '6px 12px', borderBottom: '1px solid var(--c-divider)', textAlign: 'right' },
  input: {
    width: '100%', padding: '5px 8px', border: '1px solid var(--c-input-border)',
    borderRadius: 4, fontSize: 13, textAlign: 'right', boxSizing: 'border-box',
    background: 'var(--c-input-bg)', color: 'var(--c-text-primary)',
  },
  calcValue: { fontSize: 13, color: 'var(--c-accent)', fontWeight: 600 },
  badgeNew: { marginLeft: 6, fontSize: 10, padding: '1px 5px', background: 'var(--c-accent-subtle-bg)', color: 'var(--c-success)', borderRadius: 8 },
  badgeChanged: { marginLeft: 6, fontSize: 10, padding: '1px 5px', background: '#fef9c3', color: '#a16207', borderRadius: 8 },
}
