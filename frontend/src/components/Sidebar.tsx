import { useState } from 'react'
import type { Company, FormTemplate, FormEntry } from '../types'

interface YearGroup {
  from: string
  to: string
  entries: FormEntry[]
}

function getYearGroups(entries: FormEntry[], companyId: string): YearGroup[] {
  const map = new Map<string, YearGroup>()
  entries
    .filter((e) => e.company_id === companyId)
    .forEach((e) => {
      const key = `${e.fiscal_year_from}:${e.fiscal_year_to}`
      if (!map.has(key)) {
        map.set(key, { from: e.fiscal_year_from ?? '', to: e.fiscal_year_to ?? '', entries: [] })
      }
      map.get(key)!.entries.push(e)
    })
  return [...map.values()].sort((a, b) => b.from.localeCompare(a.from))
}

function yearLabel(from: string, to: string): string {
  if (!from) return '(사업연도 미설정)'
  const fromYear = from.slice(0, 4)
  const toYear = to?.slice(0, 4)
  const label = fromYear === toYear ? `${fromYear}년` : `${fromYear}~${toYear}년`
  return `${label} (${from} ~ ${to ?? ''})`
}

interface Props {
  companies: Company[]
  forms: FormTemplate[]
  entries: FormEntry[]
  pendingYears: Array<{ companyId: string; from: string; to: string }>
  selectedEntryId: string | null
  onSelectEntry: (id: string) => void
  onNewEntry: (templateId: string, companyId: string, fiscalYearFrom: string, fiscalYearTo: string) => void
  onUploadForm: () => void
  onEditFormulas: (template: FormTemplate) => void
  onAddCompany: () => void
  onEditCompany: (company: Company) => void
  onAddTaxYear: (company: Company) => void
}

export function Sidebar({
  companies,
  forms,
  entries,
  pendingYears,
  selectedEntryId,
  onSelectEntry,
  onNewEntry,
  onUploadForm,
  onEditFormulas,
  onAddCompany,
  onEditCompany,
  onAddTaxYear,
}: Props) {
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null)
  const [expandedYear, setExpandedYear] = useState<string | null>(null)
  const [addFormYear, setAddFormYear] = useState<string | null>(null)
  const currentForms = forms.filter((f) => f.is_current)

  return (
    <aside style={s.sidebar}>
      <div style={s.logoArea}>
        <div style={s.logoIcon}><TaxIcon /></div>
        <div>
          <div style={s.logoName}>iTax<span style={s.logoBadge}>PoC</span></div>
          <div style={s.logoSub}>Intelligent Tax</div>
        </div>
      </div>

      <nav style={s.nav}>
        {/* Companies */}
        <div style={s.navGroup}>
          <div style={s.navGroupHeader}>
            <span style={s.navGroupLabel}>법인</span>
            <button style={s.addBtn} onClick={onAddCompany} title="새 법인 추가">+</button>
          </div>
          {companies.length === 0 && (
            <div style={s.emptyHint}>법인을 먼저 추가하세요</div>
          )}
          {companies.map((company) => {
            const isCoExpanded = expandedCompany === company.id
            const yearGroups = (() => {
              const groups = getYearGroups(entries, company.id)
              // Merge pending years that have no entries yet
              for (const py of pendingYears) {
                if (py.companyId !== company.id) continue
                const exists = groups.some((g) => g.from === py.from && g.to === py.to)
                if (!exists) groups.push({ from: py.from, to: py.to, entries: [] })
              }
              return groups.sort((a, b) => b.from.localeCompare(a.from))
            })()

            return (
              <div key={company.id}>
                {/* Company row */}
                <button
                  style={s.companyItem}
                  onClick={() => setExpandedCompany(isCoExpanded ? null : company.id)}
                >
                  <span style={s.navIcon}><BuildingIcon /></span>
                  <span style={s.navLabel}>{company.name}</span>
                  <span style={s.navChevron}>{isCoExpanded ? '▾' : '▸'}</span>
                </button>

                {isCoExpanded && (
                  <div style={s.companyBody}>
                    {/* Edit company + add year */}
                    <div style={s.companyActions}>
                      <button style={s.microBtn} onClick={() => onEditCompany(company)}>
                        법인 수정
                      </button>
                      <button style={s.microBtnPrimary} onClick={() => onAddTaxYear(company)}>
                        + 사업연도
                      </button>
                    </div>

                    {yearGroups.length === 0 && (
                      <div style={s.emptyHint2}>사업연도를 추가하세요</div>
                    )}

                    {yearGroups.map((year) => {
                      const yearKey = `${company.id}:${year.from}:${year.to}`
                      const isYearExpanded = expandedYear === yearKey

                      return (
                        <div key={yearKey}>
                          {/* Year row */}
                          <button
                            style={s.yearItem}
                            onClick={() => setExpandedYear(isYearExpanded ? null : yearKey)}
                          >
                            <span style={s.yearIcon}><CalIcon /></span>
                            <span style={s.navLabel}>{yearLabel(year.from, year.to)}</span>
                            <span style={s.navChevron}>{isYearExpanded ? '▾' : '▸'}</span>
                          </button>

                          {isYearExpanded && (
                            <div style={s.yearBody}>
                              {/* Forms with existing entries — click to open directly */}
                              {currentForms.map((form) => {
                                const entry = year.entries.find(
                                  (e) => e.template_id === form.id
                                )
                                if (!entry) return null
                                const isActive = selectedEntryId === entry.id
                                return (
                                  <button
                                    key={form.form_code}
                                    style={{ ...s.formItem, ...(isActive ? s.formItemActive : {}) }}
                                    onClick={() => onSelectEntry(entry.id)}
                                  >
                                    <span style={s.navIcon}><DocIcon /></span>
                                    <span style={s.navLabel}>{form.form_name}</span>
                                    <span style={statusBadgeStyle(entry.status)}>
                                      {entry.status === 'final' ? '확정' : '임시'}
                                    </span>
                                  </button>
                                )
                              })}

                              {/* + 서식 추가 button */}
                              {(() => {
                                const unusedForms = currentForms.filter(
                                  (form) => !year.entries.some(
                                    (e) => e.template_id === form.id
                                  )
                                )
                                if (unusedForms.length === 0) return null
                                const isOpen = addFormYear === yearKey
                                return (
                                  <div>
                                    <button
                                      style={s.addFormToggle}
                                      onClick={() => setAddFormYear(isOpen ? null : yearKey)}
                                    >
                                      <span>{isOpen ? '▾' : '▸'}</span>
                                      <span>+ 서식 추가</span>
                                    </button>
                                    {isOpen && (
                                      <div style={s.formPicker}>
                                        {unusedForms.map((form) => (
                                          <button
                                            key={form.form_code}
                                            style={s.formPickerItem}
                                            onClick={() => {
                                              setAddFormYear(null)
                                              onNewEntry(form.id, company.id, year.from, year.to)
                                            }}
                                          >
                                            <span style={s.navIcon}><DocIcon /></span>
                                            <span style={s.navLabel}>{form.form_name}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Admin */}
        <div style={s.navGroup}>
          <div style={s.navGroupHeader}>
            <span style={s.navGroupLabel}>관리</span>
          </div>
          <button style={s.navItem} onClick={onUploadForm}>
            <span style={s.navIcon}><UploadIcon /></span>
            <span style={s.navLabel}>서식 업로드</span>
          </button>
          {currentForms.map((form) => (
            <button key={form.id} style={s.navItem} onClick={() => onEditFormulas(form)}>
              <span style={s.navIcon}><EditIcon /></span>
              <span style={s.navLabel}>{form.form_name} 수식 편집</span>
            </button>
          ))}
        </div>
      </nav>

      <div style={s.footer}>
        <div style={s.footerAvatar}>관</div>
        <div>
          <div style={s.footerName}>관리자</div>
          <div style={s.footerRole}>Admin</div>
        </div>
      </div>
    </aside>
  )
}

/* ── Icons ── */
function TaxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="15" y2="17"/>
    </svg>
  )
}
function BuildingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18M9 21V9"/>
    </svg>
  )
}
function CalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function DocIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}
function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  )
}

const statusBadgeStyle = (status: string): React.CSSProperties => ({
  fontSize: 10, padding: '1px 5px', borderRadius: 10,
  background: status === 'final' ? '#16a34a' : '#64748b',
  color: '#fff', flexShrink: 0,
})

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 260, minWidth: 260, height: '100vh',
    background: 'var(--c-sidebar-bg)', color: 'var(--c-sidebar-text)',
    display: 'flex', flexDirection: 'column',
    borderRight: '1px solid var(--c-sidebar-border)',
  },
  logoArea: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '18px 16px 14px', borderBottom: '1px solid var(--c-sidebar-border)',
  },
  logoIcon: {
    width: 36, height: 36, borderRadius: 8,
    background: 'var(--c-accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--c-accent-fg)', flexShrink: 0,
  },
  logoName: { fontSize: 17, fontWeight: 800, color: 'var(--c-sidebar-logo)', letterSpacing: '-0.3px' },
  logoBadge: {
    marginLeft: 5, fontSize: 9, fontWeight: 700,
    background: 'var(--c-sidebar-active-bg)', color: 'var(--c-sidebar-active-text)',
    padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle',
  },
  logoSub: { fontSize: 10, color: 'var(--c-sidebar-muted)', marginTop: 1 },
  nav: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  navGroup: { marginBottom: 4 },
  navGroupHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px 4px',
  },
  navGroupLabel: {
    fontSize: 10, fontWeight: 700, color: 'var(--c-sidebar-muted)', letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  addBtn: {
    width: 20, height: 20, borderRadius: 4, background: 'var(--c-sidebar-add-btn-bg)',
    border: '1px solid var(--c-sidebar-add-btn-border)', color: 'var(--c-sidebar-muted)', cursor: 'pointer',
    fontSize: 14, lineHeight: 1, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  emptyHint: { fontSize: 11, color: 'var(--c-sidebar-muted)', padding: '4px 16px 8px' },
  emptyHint2: { fontSize: 11, color: 'var(--c-sidebar-muted)', padding: '4px 12px 8px' },
  navItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
    padding: '7px 16px', background: 'none', border: 'none',
    color: 'var(--c-sidebar-item)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
  },
  navIcon: { color: 'var(--c-sidebar-icon)', display: 'flex', flexShrink: 0 },
  navLabel: { flex: 1, lineHeight: 1.35, textAlign: 'left' },
  navChevron: { fontSize: 10, color: 'var(--c-sidebar-muted)', flexShrink: 0 },
  /* Company */
  companyItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
    padding: '7px 16px', background: 'none', border: 'none',
    color: 'var(--c-sidebar-company)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
    fontWeight: 600,
  },
  companyBody: {
    borderLeft: '2px solid var(--c-sidebar-indent)', marginLeft: 22, paddingLeft: 8,
  },
  companyActions: {
    display: 'flex', gap: 6, padding: '4px 4px 8px',
  },
  microBtn: {
    padding: '3px 8px', background: 'none', border: '1px solid var(--c-sidebar-add-btn-border)',
    borderRadius: 4, color: 'var(--c-sidebar-muted)', cursor: 'pointer', fontSize: 10,
  },
  microBtnPrimary: {
    padding: '3px 8px', background: 'var(--c-sidebar-active-bg)', border: '1px solid var(--c-accent)',
    borderRadius: 4, color: 'var(--c-sidebar-active-text)', cursor: 'pointer', fontSize: 10, fontWeight: 600,
  },
  /* Year */
  yearItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 6px', background: 'none', border: 'none',
    color: 'var(--c-sidebar-item)', cursor: 'pointer', fontSize: 11, textAlign: 'left',
  },
  yearIcon: { color: 'var(--c-sidebar-muted)', display: 'flex', flexShrink: 0 },
  yearBody: {
    borderLeft: '1px solid var(--c-sidebar-border)', marginLeft: 10, paddingLeft: 6,
  },
  /* Form under year */
  formItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 7,
    padding: '5px 6px', background: 'none', border: 'none',
    color: 'var(--c-sidebar-item)', cursor: 'pointer', fontSize: 11, textAlign: 'left',
    borderRadius: 4,
  },
  formItemActive: { background: 'var(--c-sidebar-active-bg)', color: 'var(--c-sidebar-active-text)' },
  addFormToggle: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 6px', background: 'none', border: 'none',
    color: 'var(--c-sidebar-muted)', cursor: 'pointer', fontSize: 10, textAlign: 'left',
    marginTop: 2,
  },
  formPicker: {
    borderLeft: '1px dashed var(--c-sidebar-indent)', marginLeft: 8, paddingLeft: 4, marginBottom: 4,
  },
  formPickerItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 7,
    padding: '4px 6px', background: 'none', border: 'none',
    color: 'var(--c-sidebar-icon)', cursor: 'pointer', fontSize: 11, textAlign: 'left',
    borderRadius: 4,
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 16px', borderTop: '1px solid var(--c-sidebar-border)',
  },
  footerAvatar: {
    width: 30, height: 30, borderRadius: '50%',
    background: 'var(--c-accent)', color: 'var(--c-accent-fg)', fontSize: 12, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  footerName: { fontSize: 12, fontWeight: 600, color: 'var(--c-sidebar-company)' },
  footerRole: { fontSize: 10, color: 'var(--c-sidebar-muted)' },
}
