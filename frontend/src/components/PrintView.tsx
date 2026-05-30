import { useEffect } from 'react'
import type { Company, FormTemplate, FormEntry } from '../types'
import { useFormCalculation } from '../hooks/useFormCalculation'

interface Props {
  template: FormTemplate
  entry: FormEntry
  company: Company | null
  onClose: () => void
}

export function PrintView({ template, entry, company, onClose }: Props) {
  const computed = useFormCalculation(template.fields, entry.field_values)
  const sections = [...new Set(template.fields.map((f) => f.section))]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div style={s.overlay}>
      <div style={s.toolbar} className="no-print">
        <span style={s.toolbarTitle}>인쇄 미리보기</span>
        <div style={s.toolbarActions}>
          <button style={s.printBtn} onClick={() => window.print()}>🖨 인쇄</button>
          <button style={s.closeBtn} onClick={onClose}>닫기</button>
        </div>
      </div>

      <div style={s.tableScroll}>
        <div style={s.page} id="print-area">
          <div style={s.formHeader}>
            <div style={s.formCodeBox}>
              <span style={s.formCodeLabel}>별지</span>
              <span style={s.formCode}>{template.form_code}</span>
            </div>
            <h1 style={s.formTitle}>{template.form_name}</h1>
            <div style={s.versionBox}>서식버전: {template.version_tag}</div>
          </div>
          <table style={s.metaTable}>
            <tbody>
              <tr>
                <td style={s.metaLabel}>사업연도</td>
                <td style={s.metaValue}>
                  {entry.fiscal_year_from && entry.fiscal_year_to
                    ? `${entry.fiscal_year_from} ~ ${entry.fiscal_year_to}`
                    : entry.fiscal_year_from || '—'}
                </td>
                <td style={s.metaLabel}>법인명</td>
                <td style={s.metaValue}>{company?.name || '—'}</td>
                <td style={s.metaLabel}>사업자등록번호</td>
                <td style={s.metaValue}>{company?.business_reg_no || '—'}</td>
                <td style={s.metaLabel}>신고구분</td>
                <td style={s.metaValue}>{entry.status === 'final' ? '확정' : '임시'}</td>
              </tr>
            </tbody>
          </table>
          {sections.map((section) => {
            const sectionFields = template.fields.filter((f) => f.section === section)
            return (
              <div key={section} style={s.section}>
                <div style={s.sectionHeader}>{section}</div>
                <table style={s.fieldTable}>
                  <tbody>
                    {sectionFields.map((field, i) => {
                      const val = computed[field.id]
                      const isCalc = field.type === 'calculated'
                      return (
                        <tr key={field.id} style={i % 2 === 0 ? s.rowEven : s.rowOdd}>
                          <td style={s.cellNum}>{field.id}</td>
                          <td style={s.cellLabel}>{field.label}</td>
                          <td style={isCalc ? s.cellCalcValue : s.cellValue}>
                            {val != null ? val.toLocaleString('ko-KR') : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
          <div style={s.footer}>
            이 신고서는 「법인세법」에 따라 작성되었습니다. &nbsp;·&nbsp; iTax PoC
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body > * { display: none !important; }
          #print-area { display: block !important; position: static !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: '#e2e8f0',
    zIndex: 100, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 24px', background: '#1e293b', color: '#f1f5f9',
    flexShrink: 0,
  },
  toolbarTitle: { fontSize: 14, fontWeight: 600 },
  toolbarActions: { display: 'flex', gap: 8 },
  printBtn: {
    padding: '6px 16px', background: '#1d4ed8', color: '#fff',
    border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  },
  closeBtn: {
    padding: '6px 16px', background: 'transparent', color: '#94a3b8',
    border: '1px solid #475569', borderRadius: 5, cursor: 'pointer', fontSize: 13,
  },
  tableScroll: { flex: 1, overflowY: 'auto' },
  page: {
    width: 794, margin: '24px auto', background: '#fff',
    padding: '32px 40px', boxShadow: '0 4px 24px rgba(0,0,0,.12)',
    fontFamily: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif", fontSize: 12, color: '#0f172a',
  },
  formHeader: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    borderBottom: '2px solid #0f172a', paddingBottom: 10, marginBottom: 12,
  },
  formCodeBox: {
    border: '1px solid #0f172a', padding: '4px 8px',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    minWidth: 60, flexShrink: 0,
  },
  formCodeLabel: { fontSize: 9, color: '#475569' },
  formCode: { fontSize: 11, fontWeight: 700 },
  formTitle: {
    flex: 1, fontSize: 16, fontWeight: 800, textAlign: 'center', margin: 0, lineHeight: 1.4,
  },
  versionBox: { fontSize: 10, color: '#64748b', alignSelf: 'flex-end', whiteSpace: 'nowrap' },
  metaTable: {
    width: '100%', borderCollapse: 'collapse', marginBottom: 16, border: '1px solid #94a3b8',
  },
  metaLabel: {
    background: '#f1f5f9', padding: '5px 8px', border: '1px solid #94a3b8',
    fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', width: 90,
  },
  metaValue: { padding: '5px 10px', border: '1px solid #94a3b8', fontSize: 12, minWidth: 80 },
  section: { marginBottom: 16 },
  sectionHeader: {
    background: '#1e3a5f', color: '#fff', padding: '4px 10px',
    fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
  },
  fieldTable: { width: '100%', borderCollapse: 'collapse', border: '1px solid #94a3b8' },
  rowEven: { background: '#fff' },
  rowOdd: { background: '#f8fafc' },
  cellNum: {
    width: 40, padding: '4px 8px', borderRight: '1px solid #cbd5e1',
    borderBottom: '1px solid #e2e8f0', color: '#64748b', fontWeight: 700,
    fontSize: 11, textAlign: 'center',
  },
  cellLabel: { padding: '4px 10px', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0' },
  cellValue: {
    width: 160, padding: '4px 12px', textAlign: 'right',
    borderBottom: '1px solid #e2e8f0', fontVariantNumeric: 'tabular-nums',
  },
  cellCalcValue: {
    width: 160, padding: '4px 12px', textAlign: 'right',
    borderBottom: '1px solid #e2e8f0', fontVariantNumeric: 'tabular-nums',
    background: '#eff6ff', color: '#1d4ed8', fontWeight: 700,
  },
  footer: {
    marginTop: 24, paddingTop: 8, borderTop: '1px solid #e2e8f0',
    fontSize: 10, color: '#94a3b8', textAlign: 'center',
  },
}
