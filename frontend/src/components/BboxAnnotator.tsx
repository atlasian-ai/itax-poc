import { useState, useRef, useEffect } from 'react'
import type { FormTemplate, FieldBbox } from '../types'
import { api } from '../services/api'

interface Props {
  template: FormTemplate
  formIndex?: number
  totalForms?: number
  onDone: () => void
}

// Normalise legacy single-bbox to array
function normaliseBbox(raw: unknown): FieldBbox[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as FieldBbox[]
  return [raw as FieldBbox]
}

export function BboxAnnotator({ template, formIndex = 0, totalForms = 1, onDone }: Props) {
  const [page, setPage] = useState(template.page_start ?? 0)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgLoading, setImgLoading] = useState(true)
  const [hasNextPage, setHasNextPage] = useState(false)

  // bboxMap: fieldId → array of bboxes (one field can have multiple boxes)
  const [bboxMap, setBboxMap] = useState<Record<string, FieldBbox[]>>(() => {
    const map: Record<string, FieldBbox[]> = {}
    for (const f of template.fields) {
      const boxes = normaliseBbox(f.bbox)
      if (boxes.length > 0) map[f.id] = boxes
    }
    return map
  })

  const [activeFieldId, setActiveFieldId] = useState<string | null>(() => {
    const first = template.fields.find((f) => !f.bbox || normaliseBbox(f.bbox).length === 0)
    return first?.id ?? template.fields[0]?.id ?? null
  })

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const imgContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setImgUrl(null)
    setImgLoading(true)
    setHasNextPage(false)

    fetch(`/api/forms/${template.id}/page-image?page=${page}&scale=2`)
      .then((r) => { if (!r.ok) throw new Error(); return r.blob() })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setImgUrl(url)
        setImgLoading(false)
        fetch(`/api/forms/${template.id}/page-image?page=${page + 1}&scale=1`)
          .then((r) => { if (!cancelled) setHasNextPage(r.ok) })
          .catch(() => {})
      })
      .catch(() => { if (!cancelled) setImgLoading(false) })

    return () => { cancelled = true }
  }, [template.id, page])

  function getNormPos(e: React.MouseEvent): { x: number; y: number } | null {
    const el = imgContainerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (!activeFieldId) return
    e.preventDefault()
    const pos = getNormPos(e)
    if (pos) { setDragStart(pos); setDragCurrent(pos) }
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragStart) return
    e.preventDefault()
    const pos = getNormPos(e)
    if (pos) setDragCurrent(pos)
  }
  function handleMouseUp(e: React.MouseEvent) {
    if (!dragStart || !dragCurrent || !activeFieldId) return
    const x = Math.min(dragStart.x, dragCurrent.x)
    const y = Math.min(dragStart.y, dragCurrent.y)
    const w = Math.abs(dragCurrent.x - dragStart.x)
    const h = Math.abs(dragCurrent.y - dragStart.y)

    if (w > 0.005 && h > 0.003) {
      const newBox: FieldBbox = { page, x, y, w, h }
      setBboxMap((prev) => ({
        ...prev,
        // APPEND — don't replace; same field can have multiple boxes
        [activeFieldId]: [...(prev[activeFieldId] ?? []), newBox],
      }))

      // Auto-advance only to fields that have zero boxes yet
      const idx = template.fields.findIndex((f) => f.id === activeFieldId)
      const next = template.fields.slice(idx + 1).find(
        (f) => !bboxMap[f.id] || bboxMap[f.id].length === 0
      )
      if (next) setActiveFieldId(next.id)
    }
    setDragStart(null)
    setDragCurrent(null)
  }

  function deleteBox(fieldId: string, boxIndex: number) {
    setBboxMap((prev) => {
      const updated = (prev[fieldId] ?? []).filter((_, i) => i !== boxIndex)
      if (updated.length === 0) {
        const next = { ...prev }
        delete next[fieldId]
        return next
      }
      return { ...prev, [fieldId]: updated }
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updatedFields = template.fields.map((f) => ({
        ...f,
        bbox: bboxMap[f.id] ?? null,
      }))
      await api.patchFields(template.id, updatedFields)
    } catch (err) {
      console.error('Failed to save bboxes', err)
    } finally {
      setSaving(false)
      onDone()
    }
  }

  const annotatedCount = Object.keys(bboxMap).length
  const totalFields = template.fields.length

  const dragRect = dragStart && dragCurrent ? {
    left: `${Math.min(dragStart.x, dragCurrent.x) * 100}%`,
    top: `${Math.min(dragStart.y, dragCurrent.y) * 100}%`,
    width: `${Math.abs(dragCurrent.x - dragStart.x) * 100}%`,
    height: `${Math.abs(dragCurrent.y - dragStart.y) * 100}%`,
  } : null

  const activeField = template.fields.find((f) => f.id === activeFieldId)

  return (
    <div style={s.overlay}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={s.toolbarLeft}>
          <span style={s.toolbarTitle}>서식 영역 표시</span>
          {totalForms > 1 && (
            <span style={s.formIndexChip}>{formIndex + 1} / {totalForms}</span>
          )}
          <span style={s.toolbarSub}>{template.form_name}</span>
        </div>
        <div style={s.toolbarCenter}>
          <span style={s.progressChip}>{annotatedCount} / {totalFields} 완료</span>
          <div style={s.pageNav}>
            <button style={s.pageBtn} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
            <span style={s.pageLabel}>페이지 {page + 1}</span>
            <button style={s.pageBtn} disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>›</button>
          </div>
        </div>
        <div style={s.toolbarRight}>
          <button style={s.skipBtn} onClick={onDone}>건너뜀</button>
          <button
            style={{ ...s.saveBtn, opacity: annotatedCount === 0 || saving ? 0.6 : 1 }}
            disabled={annotatedCount === 0 || saving}
            onClick={handleSave}
          >
            {saving ? '저장 중...' : '저장 및 완료'}
          </button>
        </div>
      </div>

      {/* Instruction */}
      <div style={s.hint}>
        {activeField ? (
          <>
            필드 <strong style={{ color: '#3b82f6' }}>{activeField.id} · {activeField.label}</strong>의 위치를 드래그하여 선택하세요
            {(bboxMap[activeField.id]?.length ?? 0) > 0 && (
              <span style={s.hintExtra}> — 이미 {bboxMap[activeField.id].length}개 선택됨. 추가 박스를 그릴 수 있습니다</span>
            )}
          </>
        ) : (
          <span style={{ color: '#94a3b8' }}>좌측 목록에서 필드를 선택하거나, 저장 및 완료를 누르세요</span>
        )}
      </div>

      <div style={s.body}>
        {/* PDF panel */}
        <div style={s.pdfPanel}>
          <div
            ref={imgContainerRef}
            style={{ ...s.imgContainer, cursor: activeFieldId ? 'crosshair' : 'default' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setDragStart(null); setDragCurrent(null) }}
          >
            {imgLoading && <div style={s.imgPlaceholder}>PDF 로딩 중...</div>}
            {imgUrl && <img src={imgUrl} alt="form" draggable={false} style={s.img} />}

            {/* All existing boxes */}
            {Object.entries(bboxMap).map(([fid, boxes]) =>
              boxes.map((bbox, bi) => {
                if (bbox.page !== page) return null
                const isActive = fid === activeFieldId
                return (
                  <div
                    key={`${fid}-${bi}`}
                    style={{
                      position: 'absolute',
                      left: `${bbox.x * 100}%`,
                      top: `${bbox.y * 100}%`,
                      width: `${bbox.w * 100}%`,
                      height: `${bbox.h * 100}%`,
                      border: `2px solid ${isActive ? '#3b82f6' : '#22c55e'}`,
                      background: isActive ? 'rgba(59,130,246,0.18)' : 'rgba(34,197,94,0.1)',
                      boxSizing: 'border-box',
                      pointerEvents: 'none',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: -16, left: 0,
                      fontSize: 9, fontWeight: 700,
                      background: isActive ? '#3b82f6' : '#22c55e',
                      color: '#fff', padding: '1px 4px', borderRadius: 2, whiteSpace: 'nowrap', lineHeight: 1.4,
                    }}>
                      {fid}{boxes.length > 1 ? ` (${bi + 1})` : ''}
                    </span>
                    {/* Delete button — pointer-events on so user can click it */}
                    <span
                      style={{
                        position: 'absolute', top: -16, right: 0,
                        fontSize: 9, background: '#ef4444', color: '#fff',
                        padding: '1px 4px', borderRadius: 2, cursor: 'pointer',
                        lineHeight: 1.4, pointerEvents: 'all',
                      }}
                      onMouseDown={(e) => { e.stopPropagation() }}
                      onClick={(e) => { e.stopPropagation(); deleteBox(fid, bi) }}
                    >✕</span>
                  </div>
                )
              })
            )}

            {/* Live drag rect */}
            {dragRect && (
              <div style={{
                position: 'absolute', ...dragRect,
                border: '2px dashed #3b82f6',
                background: 'rgba(59,130,246,0.2)',
                boxSizing: 'border-box', pointerEvents: 'none',
              }} />
            )}
          </div>
        </div>

        {/* Field list */}
        <div style={s.fieldPanel}>
          <div style={s.fieldPanelHeader}>
            필드 목록
            <span style={s.fieldPanelCount}>{annotatedCount}/{totalFields}</span>
          </div>
          <div style={s.fieldList}>
            {template.fields.map((f) => {
              const boxes = bboxMap[f.id] ?? []
              const hasBbox = boxes.length > 0
              const isActive = f.id === activeFieldId
              return (
                <div
                  key={f.id}
                  style={{
                    ...s.fieldRow,
                    ...(isActive ? s.fieldRowActive : {}),
                    ...(hasBbox && !isActive ? s.fieldRowDone : {}),
                  }}
                  onClick={() => setActiveFieldId(f.id)}
                >
                  <span style={{ ...s.fieldCheck, color: hasBbox ? '#22c55e' : '#64748b' }}>
                    {hasBbox ? '✓' : '○'}
                  </span>
                  <span style={s.fieldId}>{f.id}</span>
                  <span style={s.fieldLabel}>{f.label}</span>
                  {boxes.length > 1 && (
                    <span style={s.boxCountBadge}>×{boxes.length}</span>
                  )}
                  {hasBbox && (
                    <button
                      style={s.fieldDeleteBtn}
                      title="모든 박스 삭제"
                      onClick={(e) => {
                        e.stopPropagation()
                        setBboxMap((prev) => { const n = { ...prev }; delete n[f.id]; return n })
                      }}
                    >✕</button>
                  )}
                </div>
              )
            })}
          </div>
          <div style={s.fieldPanelFooter}>
            <button style={s.selectAllBtn} onClick={() => {
              setBboxMap({})
              setActiveFieldId(template.fields[0]?.id ?? null)
            }}>
              전체 초기화
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: '#0f172a',
    zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: '#1e293b', borderBottom: '1px solid #334155',
    flexShrink: 0, gap: 16,
  },
  toolbarLeft: { display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 },
  toolbarTitle: { fontSize: 14, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap' },
  formIndexChip: { fontSize: 11, background: '#475569', color: '#cbd5e1', padding: '2px 8px', borderRadius: 10, flexShrink: 0 },
  toolbarSub: { fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  toolbarCenter: { display: 'flex', alignItems: 'center', gap: 16 },
  progressChip: { fontSize: 12, fontWeight: 600, background: '#1d4ed8', color: '#fff', padding: '3px 10px', borderRadius: 12 },
  pageNav: { display: 'flex', alignItems: 'center', gap: 6 },
  pageBtn: { padding: '2px 10px', background: '#334155', color: '#cbd5e1', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  pageLabel: { fontSize: 12, color: '#94a3b8', minWidth: 60, textAlign: 'center' },
  toolbarRight: { display: 'flex', gap: 8, flexShrink: 0 },
  skipBtn: { padding: '7px 16px', background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  saveBtn: { padding: '7px 18px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  hint: { padding: '7px 20px', background: '#1e293b', borderBottom: '1px solid #334155', fontSize: 13, color: '#cbd5e1', flexShrink: 0 },
  hintExtra: { color: '#94a3b8', fontSize: 12 },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  pdfPanel: { flex: 1, overflowY: 'auto', overflowX: 'auto', background: '#334155', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24 },
  imgContainer: { position: 'relative', userSelect: 'none', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' },
  imgPlaceholder: { width: 600, height: 800, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 14 },
  img: { display: 'block', maxWidth: '100%', height: 'auto' },
  fieldPanel: { width: 280, flexShrink: 0, background: '#1e293b', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  fieldPanelHeader: { padding: '12px 16px', fontSize: 12, fontWeight: 700, color: '#94a3b8', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em' },
  fieldPanelCount: { fontSize: 11, background: '#334155', color: '#94a3b8', padding: '2px 8px', borderRadius: 10 },
  fieldList: { flex: 1, overflowY: 'auto' },
  fieldRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer', borderBottom: '1px solid #0f172a' },
  fieldRowActive: { background: '#1d3461', borderLeft: '3px solid #3b82f6' },
  fieldRowDone: { opacity: 0.6 },
  fieldCheck: { fontSize: 13, width: 14, flexShrink: 0 },
  fieldId: { fontSize: 11, fontWeight: 700, color: '#64748b', width: 24, flexShrink: 0 },
  fieldLabel: { fontSize: 12, color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  boxCountBadge: { fontSize: 10, background: '#1d4ed8', color: '#fff', padding: '1px 5px', borderRadius: 8, flexShrink: 0 },
  fieldDeleteBtn: { fontSize: 10, color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 4px', flexShrink: 0, lineHeight: 1 },
  fieldPanelFooter: { padding: '10px 14px', borderTop: '1px solid #334155', flexShrink: 0 },
  selectAllBtn: { width: '100%', padding: '6px', background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
}
