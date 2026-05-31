import { useState } from 'react'
import type { FormTemplate, FieldDefinition } from '../types'

type Row = Record<string, number | string | null>

interface Props {
  template: FormTemplate
  initialRows: Row[]
  onChange: (rows: Row[]) => void
}

/** Evaluate a formula for a single row — mirrors useFormCalculation hook exactly. */
function evalRowFormula(formula: string, row: Row): number | null {
  if (!formula) return null
  try {
    // Normalise Unicode operators Claude sometimes outputs
    const normalised = formula
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
    // Replace all \b\d+\b field IDs with their row values (same pattern as useFormCalculation)
    const expr = normalised.replace(/\b(\d+)\b/g, (_, id) => {
      const v = row[id]
      const num = typeof v === 'number' ? v : (v != null && v !== '' ? Number(v) : 0)
      return String(isNaN(num) ? 0 : num)
    })
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')() as number
    return typeof result === 'number' && isFinite(result) ? result : null
  } catch {
    return null
  }
}

/** Compute all calculated fields for a row (two passes for chained formulas). */
function computeRow(fields: FieldDefinition[], row: Row): Row {
  const computed = { ...row }
  for (let pass = 0; pass < 2; pass++) {
    for (const f of fields) {
      if (f.type === 'calculated' && f.formula) {
        const result = evalRowFormula(f.formula, computed)
        computed[f.id] = result
      }
    }
  }
  return computed
}

function emptyRow(fields: FieldDefinition[]): Row {
  return Object.fromEntries(fields.map((f) => [f.id, null]))
}

export function TabularRenderer({ template, initialRows, onChange }: Props) {
  const fields = template.fields
  const inputFields = fields.filter((f) => f.type === 'input')
  const calcFields = fields.filter((f) => f.type === 'calculated')

  const [rows, setRows] = useState<Row[]>(() =>
    initialRows.length > 0 ? initialRows : [emptyRow(fields)]
  )
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({})

  function computedRows(): Row[] {
    return rows.map((r) => computeRow(fields, r))
  }

  function updateRow(rowIdx: number, fieldId: string, raw: string) {
    const key = `${rowIdx}-${fieldId}`
    setRawInputs((prev) => ({ ...prev, [key]: raw }))
    const cleaned = raw.replace(/,/g, '')
    const num = cleaned === '' || cleaned === '-' ? null : Number(cleaned)
    const updated = rows.map((r, i) =>
      i === rowIdx ? { ...r, [fieldId]: isNaN(num as number) ? null : num } : r
    )
    setRows(updated)
    onChange(updated.map((r) => computeRow(fields, r)))
  }

  function blurRow(rowIdx: number, fieldId: string) {
    const key = `${rowIdx}-${fieldId}`
    setRawInputs((prev) => { const n = { ...prev }; delete n[key]; return n })
  }

  function addRow() {
    const updated = [...rows, emptyRow(fields)]
    setRows(updated)
    onChange(updated.map((r) => computeRow(fields, r)))
  }

  function deleteRow(idx: number) {
    if (rows.length <= 1) return
    const updated = rows.filter((_, i) => i !== idx)
    setRows(updated)
    onChange(updated.map((r) => computeRow(fields, r)))
  }

  const computed = computedRows()

  // Column totals for numeric calculated fields
  const totals: Record<string, number> = {}
  for (const f of fields) {
    if (f.type === 'calculated') {
      totals[f.id] = computed.reduce((sum, r) => {
        const v = r[f.id]
        return sum + (typeof v === 'number' ? v : 0)
      }, 0)
    }
  }

  return (
    <div style={s.wrapper}>
      <div style={s.tableScroll}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.thNum}>번호</th>
              {fields.map((f) => (
                <th
                  key={f.id}
                  style={{ ...s.th, ...(f.type === 'calculated' ? s.thCalc : {}) }}
                >
                  <span style={s.thId}>{f.id}</span>
                  <span style={s.thLabel}>{f.label}</span>
                  {f.type === 'calculated' && f.formula && (
                    <span style={s.thFormula}>= {f.formula}</span>
                  )}
                </th>
              ))}
              <th style={s.thAction}></th>
            </tr>
          </thead>
          <tbody>
            {computed.map((row, ri) => (
              <tr key={ri} style={ri % 2 === 0 ? s.rowEven : s.rowOdd}>
                <td style={s.tdNum}>{ri + 1}</td>
                {fields.map((f) => {
                  const rawKey = `${ri}-${f.id}`
                  const isCalc = f.type === 'calculated'
                  const val = row[f.id]
                  return (
                    <td key={f.id} style={isCalc ? s.tdCalc : s.td}>
                      {isCalc ? (
                        <span style={s.calcVal}>
                          {typeof val === 'number' ? val.toLocaleString('ko-KR') : ''}
                        </span>
                      ) : (
                        <input
                          style={s.input}
                          type="text"
                          inputMode="numeric"
                          value={
                            rawInputs[rawKey] !== undefined
                              ? rawInputs[rawKey]
                              : val != null ? (typeof val === 'number' ? val.toLocaleString('ko-KR') : String(val)) : ''
                          }
                          placeholder="0"
                          onChange={(e) => updateRow(ri, f.id, e.target.value)}
                          onBlur={() => blurRow(ri, f.id)}
                        />
                      )}
                    </td>
                  )
                })}
                <td style={s.tdAction}>
                  <button
                    style={s.deleteRowBtn}
                    onClick={() => deleteRow(ri)}
                    disabled={rows.length <= 1}
                    title="행 삭제"
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          {/* Totals row */}
          {calcFields.length > 0 && rows.length > 1 && (
            <tfoot>
              <tr style={s.totalsRow}>
                <td style={s.tdNum} colSpan={inputFields.length + 1}>
                  <strong>합 계</strong>
                </td>
                {calcFields.map((f) => (
                  <td key={f.id} style={s.tdTotalCalc}>
                    <strong>{totals[f.id]?.toLocaleString('ko-KR') ?? ''}</strong>
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <button style={s.addRowBtn} onClick={addRow}>
        + 행 추가
      </button>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: 12 },
  tableScroll: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', background: 'var(--c-card-bg)', border: '1px solid var(--c-card-border)', borderRadius: 8, overflow: 'hidden' },
  thNum: { padding: '8px 10px', background: 'var(--c-meta-label-bg)', border: '1px solid var(--c-divider)', fontSize: 11, color: 'var(--c-text-muted)', width: 40, textAlign: 'center' },
  th: { padding: '6px 10px', background: 'var(--c-meta-label-bg)', border: '1px solid var(--c-divider)', fontSize: 11, color: 'var(--c-text-secondary)', textAlign: 'center', minWidth: 100 },
  thCalc: { background: '#eff6ff' },
  thId: { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--c-accent)', marginBottom: 2 },
  thLabel: { display: 'block', fontSize: 11 },
  thFormula: { display: 'block', fontSize: 9, color: 'var(--c-text-muted)', marginTop: 2, fontFamily: 'monospace' },
  thAction: { width: 32, background: 'var(--c-meta-label-bg)', border: '1px solid var(--c-divider)' },
  rowEven: { background: 'var(--c-card-bg)' },
  rowOdd: { background: 'var(--c-form-bg)' },
  tdNum: { padding: '6px 8px', border: '1px solid var(--c-divider)', fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'center' },
  td: { padding: '4px 6px', border: '1px solid var(--c-divider)' },
  tdCalc: { padding: '6px 10px', border: '1px solid var(--c-divider)', background: '#eff6ff', textAlign: 'right' },
  tdAction: { padding: '4px 6px', border: '1px solid var(--c-divider)', textAlign: 'center' },
  input: {
    width: '100%', padding: '4px 6px', border: '1px solid var(--c-input-border)',
    borderRadius: 4, fontSize: 12, textAlign: 'right', boxSizing: 'border-box',
    background: 'var(--c-input-bg)', color: 'var(--c-text-primary)',
  },
  calcVal: { fontSize: 12, color: '#1d4ed8', fontWeight: 600 },
  deleteRowBtn: {
    width: 22, height: 22, padding: 0, background: 'transparent',
    border: '1px solid var(--c-card-border)', borderRadius: 4,
    cursor: 'pointer', fontSize: 10, color: 'var(--c-text-muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  totalsRow: { background: 'var(--c-accent-subtle-bg)' },
  tdTotalCalc: { padding: '6px 10px', border: '1px solid var(--c-divider)', textAlign: 'right', color: '#1d4ed8', fontSize: 13 },
  addRowBtn: {
    alignSelf: 'flex-start', padding: '7px 16px', background: 'var(--c-card-bg)',
    border: '1px dashed var(--c-accent-subtle-border)', borderRadius: 6,
    cursor: 'pointer', fontSize: 13, color: 'var(--c-accent)',
    fontWeight: 600,
  },
}
