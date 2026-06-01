import { useEffect, useState } from 'react'
import type { Company, FormTemplate, FormEntry } from '../types'
import { useFormCalculation } from '../hooks/useFormCalculation'

interface Props {
  template: FormTemplate
  entry: FormEntry
  company: Company | null
  onClose: () => void
}

type Mode = 'original' | 'table'

export function PrintView({ template, entry, company, onClose }: Props) {
  const flatValues = ('_rows' in entry.field_values ? {} : entry.field_values) as Record<string, number | null>
  const computed = useFormCalculation(template.fields, flatValues)
  const sections = [...new Set(template.fields.map((f) => f.section))]
  // Normalise legacy single-bbox object to array
  const normBbox = (f: typeof template.fields[0]) => {
    if (!f.bbox) return []
    return Array.isArray(f.bbox) ? f.bbox : [f.bbox]
  }
  const hasBbox = template.fields.some((f) => normBbox(f).length > 0)
  const isTabular = template.form_type === 'tabular'
  // Tabular forms default to table — overlay can't render multi-row data
  const [mode, setMode] = useState<Mode>(!isTabular && hasBbox ? 'original' : 'table')
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [imgLoading, setImgLoading] = useState(false)
  const [imgError, setImgError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Load PDF page image when in original mode
  useEffect(() => {
    if (mode !== 'original') return
    setImgLoading(true)
    setImgError(null)
    let objUrl: string | null = null
    fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}/forms/${template.id}/page-image?page=${template.page_start ?? 0}&scale=2`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('itax_token') ?? ''}` },
      })
      .then((r) => {
        if (!r.ok) throw new Error('image fetch failed')
        return r.blob()
      })
      .then((blob) => {
        objUrl = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
          setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
          setImgUrl(objUrl)
          setImgLoading(false)
        }
        img.src = objUrl!
      })
      .catch((e: Error) => {
        setImgLoading(false)
        setImgError(e.message || '서식 이미지를 불러올 수 없습니다')
      })
    return () => { if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [mode, template.id])

  return (
    <div style={s.overlay}>
      {/* Toolbar */}
      <div style={s.toolbar} className="no-print">
        <span style={s.toolbarTitle}>인쇄 미리보기</span>
        <div style={s.toolbarCenter}>
          <button
            style={{ ...s.modeBtn, ...(mode === 'original' ? s.modeBtnActive : {}) }}
            onClick={() => setMode('original')}
          >
            원본 서식{!hasBbox && <span style={s.noBboxBadge}>위치 없음</span>}
          </button>
          <button
            style={{ ...s.modeBtn, ...(mode === 'table' ? s.modeBtnActive : {}) }}
            onClick={() => setMode('table')}
          >
            표 형식
          </button>
        </div>
        <div style={s.toolbarActions}>
          <button style={s.printBtn} onClick={() => window.print()}>🖨 인쇄</button>
          <button style={s.closeBtn} onClick={onClose}>닫기</button>
        </div>
      </div>

      {/* Content */}
      {mode === 'original' ? (
        <OverlayView
          template={template}
          computed={computed}
          imgUrl={imgUrl}
          imgSize={imgSize}
          loading={imgLoading}
          hasBbox={hasBbox}
          isTabular={isTabular}
          imgError={imgError}
          normBbox={normBbox}
          onSwitchToTable={() => setMode('table')}
        />
      ) : (
        <TableView
          template={template}
          entry={entry}
          company={company}
          computed={computed}
          sections={sections}
        />
      )}

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

/* ── Overlay view ── */
function OverlayView({
  template, computed, imgUrl, imgSize, loading, hasBbox, isTabular, imgError, normBbox, onSwitchToTable,
}: {
  template: FormTemplate
  computed: Record<string, number | null>
  imgUrl: string | null
  imgSize: { w: number; h: number } | null
  loading: boolean
  hasBbox: boolean
  isTabular: boolean
  imgError: string | null
  normBbox: (f: FormTemplate['fields'][0]) => import('../types').FieldBbox[]
  onSwitchToTable: () => void
}) {
  if (loading) {
    return (
      <div style={s.centered}>
        <div style={s.loadingText}>서식 이미지 로딩 중...</div>
      </div>
    )
  }
  if (imgError) {
    return (
      <div style={s.centered}>
        <p style={s.msgText}>
          서식 이미지 로드 실패:<br />
          <code style={{ fontSize: 11, color: '#dc2626' }}>{imgError}</code>
        </p>
      </div>
    )
  }
  if (!imgUrl || !imgSize) {
    return (
      <div style={s.centered}>
        <div style={s.loadingText}>서식 이미지 준비 중...</div>
      </div>
    )
  }

  // Tabular forms: show blank form image with a note — row data can't be overlaid
  if (isTabular && imgUrl && imgSize) {
    const displayW = Math.min(900, imgSize.w / 2)
    const displayH = imgSize.h * (displayW / imgSize.w)
    return (
      <div style={s.overlayScroll}>
        <div style={{ ...s.noBboxBox, margin: '16px auto', maxWidth: 'none', width: displayW, padding: '10px 0 0', textAlign: 'left' }}>
          <div style={{ padding: '6px 16px 12px', background: '#fef9c3', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#92400e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>행별 데이터는 원본 서식에 오버레이할 수 없습니다. 데이터 확인은 <strong>표 형식</strong> 탭을 사용하세요.</span>
            <button style={s.switchBtn} onClick={onSwitchToTable}>표 형식으로 보기 →</button>
          </div>
          <img src={imgUrl} style={{ width: displayW, height: displayH, display: 'block' }} alt="form" />
        </div>
      </div>
    )
  }

  if (!hasBbox) {
    return (
      <div style={s.centered}>
        <div style={s.noBboxBox}>
          <div style={s.noBboxTitle}>필드 위치 정보 없음</div>
          <p style={s.noBboxMsg}>
            이 서식은 필드 위치가 설정되지 않았습니다.<br />
            서식을 다시 업로드하거나 수식 편집기에서 위치를 설정하세요.
          </p>
          <button style={s.switchBtn} onClick={onSwitchToTable}>
            표 형식으로 보기 →
          </button>
        </div>
      </div>
    )
  }

  const displayW = Math.min(900, imgSize.w / 2) // divide by 2 because scale=2
  const scale = displayW / imgSize.w
  const displayH = imgSize.h * scale

  return (
    <div style={s.overlayScroll} id="print-area">
      <div style={{ position: 'relative', width: displayW, height: displayH, margin: '24px auto' }}>
        <img src={imgUrl} style={{ width: displayW, height: displayH, display: 'block' }} alt="form" />
        {template.fields.flatMap((f) => {
          const val = computed[f.id]
          if (val == null) return []
          return normBbox(f)
            .filter((bbox) => bbox.page === (template.page_start ?? 0))
            .map((bbox, bi) => (
              <div
                key={`${f.id}-${bi}`}
                style={{
                  position: 'absolute',
                  left: bbox.x * displayW,
                  top: bbox.y * displayH,
                  width: bbox.w * displayW,
                  height: bbox.h * displayH,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: 4,
                  fontSize: Math.max(8, bbox.h * displayH * 0.6),
                  color: f.type === 'calculated' ? '#1d4ed8' : '#0f172a',
                  fontWeight: f.type === 'calculated' ? 700 : 400,
                  fontFamily: "'Malgun Gothic', monospace",
                  pointerEvents: 'none',
                  overflow: 'hidden',
                  lineHeight: 1,
                }}
              >
                {val.toLocaleString('ko-KR')}
              </div>
            ))
        })}
      </div>
    </div>
  )
}

/* ── Table view ── */
function TableView({
  template, entry, company, computed, sections,
}: {
  template: FormTemplate
  entry: FormEntry
  company: Company | null
  computed: Record<string, number | null>
  sections: string[]
}) {
  return (
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
        {/* Tabular form print */}
        {template.form_type === 'tabular' && (() => {
          const fv = entry.field_values
          const rows: Array<Record<string, number | string | null>> =
            (fv && '_rows' in fv ? fv._rows : []) as Array<Record<string, number | string | null>>
          return (
            <div style={s.section}>
              <table style={{ ...s.fieldTable, tableLayout: 'auto' }}>
                <thead>
                  <tr style={{ background: '#1e3a5f' }}>
                    <th style={{ ...s.cellNum, color: '#fff' }}>번호</th>
                    {template.fields.map((f) => (
                      <th key={f.id} style={{ padding: '4px 8px', color: '#fff', fontSize: 10, fontWeight: 700, border: '1px solid #334155', textAlign: 'center' }}>
                        {f.id} {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} style={ri % 2 === 0 ? s.rowEven : s.rowOdd}>
                      <td style={s.cellNum}>{ri + 1}</td>
                      {template.fields.map((f) => {
                        const v = row[f.id]
                        return (
                          <td key={f.id} style={f.type === 'calculated' ? s.cellCalcValue : s.cellValue}>
                            {typeof v === 'number' ? v.toLocaleString('ko-KR') : (v ?? '')}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}

        {/* Flat form print */}
        {template.form_type !== 'tabular' && sections.map((section) => {
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
  toolbarTitle: { fontSize: 14, fontWeight: 600, minWidth: 120 },
  toolbarCenter: { display: 'flex', gap: 4, background: '#0f172a', borderRadius: 6, padding: 3 },
  modeBtn: {
    padding: '5px 14px', background: 'transparent', color: '#94a3b8',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  },
  modeBtnActive: { background: '#1d4ed8', color: '#fff' },
  toolbarActions: { display: 'flex', gap: 8, minWidth: 120, justifyContent: 'flex-end' },
  printBtn: {
    padding: '6px 16px', background: '#1d4ed8', color: '#fff',
    border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  },
  closeBtn: {
    padding: '6px 16px', background: 'transparent', color: '#94a3b8',
    border: '1px solid #475569', borderRadius: 5, cursor: 'pointer', fontSize: 13,
  },
  centered: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  loadingText: { color: '#64748b', fontSize: 14 },
  msgText: { color: '#64748b', fontSize: 13, textAlign: 'center' as const, lineHeight: 1.8 },
  noBboxBox: {
    background: '#fff', borderRadius: 10, padding: '32px 40px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)', textAlign: 'center' as const, maxWidth: 400,
  },
  noBboxTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 12 },
  noBboxMsg: { fontSize: 13, color: '#64748b', lineHeight: 1.8, margin: '0 0 20px' },
  noBboxBadge: {
    marginLeft: 6, fontSize: 9, fontWeight: 700, background: '#f59e0b',
    color: '#fff', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle',
  },
  switchBtn: {
    padding: '8px 20px', background: '#1d4ed8', color: '#fff',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
  overlayScroll: { flex: 1, overflowY: 'auto' },
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
