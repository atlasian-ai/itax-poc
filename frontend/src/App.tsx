import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { Sidebar } from './components/Sidebar'
import { FormRenderer } from './components/FormRenderer'
import { FormulaEditor } from './components/FormulaEditor'
import { UploadModal } from './components/UploadModal'
import { BulkUploadModal } from './components/BulkUploadModal'
import { CompanyModal } from './components/CompanyModal'
import { TaxYearModal } from './components/TaxYearModal'
import { api } from './services/api'
import type { Company, FormTemplate, FormEntry } from './types'

type MainView = 'empty' | 'pick-forms' | 'form' | 'editor'
export type Theme = 'light' | 'dark' | 'professional'
export const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: 'light', toggleTheme: () => {},
})
export function useTheme() { return useContext(ThemeContext) }

const THEME_CYCLE: Theme[] = ['light', 'dark', 'professional']
const THEME_LABEL: Record<Theme, string> = { light: '☀', dark: '🌙', professional: '★' }

export default function App() {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('itax_theme') as Theme) ?? 'light'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('itax_theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((t) => THEME_CYCLE[(THEME_CYCLE.indexOf(t) + 1) % THEME_CYCLE.length])
  }
  const [companies, setCompanies] = useState<Company[]>([])
  const [forms, setForms] = useState<FormTemplate[]>([])
  const [entries, setEntries] = useState<FormEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<FormEntry | null>(null)
  const [activeTemplate, setActiveTemplate] = useState<FormTemplate | null>(null)
  const [activeCompany, setActiveCompany] = useState<Company | null>(null)
  const [activeFiscalYear, setActiveFiscalYear] = useState<{ from: string; to: string } | null>(null)
  const [view, setView] = useState<MainView>('empty')
  const [showUpload, setShowUpload] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [companyModal, setCompanyModal] = useState<{ company?: Company; isNew?: boolean } | null>(null)
  const [taxYearModal, setTaxYearModal] = useState<Company | null>(null)
  const [pendingYears, setPendingYears] = useState<Array<{ companyId: string; from: string; to: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('itax_pending_years') ?? '[]') } catch { return [] }
  })
  const [loading, setLoading] = useState(true)

  // Keep localStorage in sync with pendingYears
  useEffect(() => {
    localStorage.setItem('itax_pending_years', JSON.stringify(pendingYears))
  }, [pendingYears])

  const refresh = useCallback(async () => {
    const [c, f, e] = await Promise.all([api.listCompanies(), api.listForms(), api.listEntries()])
    setCompanies(c)
    setForms(f)
    setEntries(e)
  }, [])

  useEffect(() => { refresh().finally(() => setLoading(false)) }, [refresh])

  async function handleSelectEntry(id: string) {
    const entry = await api.getEntry(id)
    const tmpl = await api.getForm(entry.template_id)
    setActiveTemplate(tmpl)
    setSelectedEntry(entry)
    setActiveCompany(companies.find((c) => c.id === entry.company_id) ?? null)
    setActiveFiscalYear(
      entry.fiscal_year_from ? { from: entry.fiscal_year_from, to: entry.fiscal_year_to ?? '' } : null
    )
    setView('form')
  }

  async function handleNewEntry(templateId: string, companyId: string, fiscalYearFrom: string, fiscalYearTo: string) {
    try {
      const tmpl = await api.getForm(templateId)
      setActiveTemplate(tmpl)
      setActiveCompany(companies.find((c) => c.id === companyId) ?? null)
      setActiveFiscalYear({ from: fiscalYearFrom, to: fiscalYearTo })
      setSelectedEntry(null)
      setView('form')
    } catch (e: any) {
      alert('서식을 불러오는 데 실패했습니다: ' + e.message)
    }
  }

  async function handleEditFormulas(template: FormTemplate) {
    try {
      const full = await api.getForm(template.id)
      setActiveTemplate(full)
      setSelectedEntry(null)
      setView('editor')
    } catch (e: any) {
      alert('서식을 불러오는 데 실패했습니다: ' + e.message)
    }
  }

  function handleCompanySaved(company: Company, isNew: boolean) {
    refresh()
    if (isNew) {
      // Immediately prompt for 사업연도 after creating a new company
      setTaxYearModal(company)
    }
  }

  function handleTaxYearConfirm(from: string, to: string) {
    if (!taxYearModal) return
    const company = taxYearModal
    setActiveCompany(company)
    setActiveFiscalYear({ from, to })
    setActiveTemplate(null)
    setSelectedEntry(null)
    setPendingYears((prev) => {
      const key = `${company.id}:${from}:${to}`
      return prev.some((y) => `${y.companyId}:${y.from}:${y.to}` === key)
        ? prev
        : [...prev, { companyId: company.id, from, to }]
    })
    setTaxYearModal(null)
    // Go to form-picker so user can see and select which forms to file
    setView('pick-forms')
  }

  function handleSaved(entry: FormEntry) {
    setSelectedEntry(entry)
    if (entry.company_id && entry.fiscal_year_from) {
      setPendingYears((prev) =>
        prev.filter(
          (y) => !(y.companyId === entry.company_id && y.from === entry.fiscal_year_from && y.to === (entry.fiscal_year_to ?? ''))
        )
      )
    }
    refresh()
  }

  const currentForms = forms.filter((f) => f.is_current)

  if (loading) {
    return (
      <div style={s.loadingScreen}>
        <div style={s.loadingSpinner} className="spinner">⟳</div>
        <p style={s.loadingText}>iTax 로딩 중...</p>
      </div>
    )
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
    <div style={s.app}>
      <Sidebar
        companies={companies}
        forms={forms}
        entries={entries}
        pendingYears={pendingYears}
        selectedEntryId={selectedEntry?.id ?? null}
        onSelectEntry={handleSelectEntry}
        onNewEntry={handleNewEntry}
        onUploadForm={() => setShowUpload(true)}
        onEditFormulas={handleEditFormulas}
        onAddCompany={() => setCompanyModal({ isNew: true })}
        onEditCompany={(c) => setCompanyModal({ company: c })}
        onAddTaxYear={(company) => setTaxYearModal(company)}
      />

      <div style={s.mainWrapper}>
        <header style={s.topBar}>
          <div style={s.topBarLeft}>
            {activeCompany && <span style={s.companyChip}>{activeCompany.name}</span>}
            {activeFiscalYear && view !== 'empty' && (
              <span style={s.yearChip}>{activeFiscalYear.from} ~ {activeFiscalYear.to}</span>
            )}
            {view === 'pick-forms' && <h1 style={s.pageTitle}>신고 서식 선택</h1>}
            {(view === 'form' || view === 'editor') && activeTemplate && (
              <>
                <h1 style={s.pageTitle}>{activeTemplate.form_name}</h1>
                <span style={s.versionChip}>{activeTemplate.form_code} · v{activeTemplate.version_tag}</span>
                {view === 'editor' && <span style={s.editorChip}>수식 편집</span>}
              </>
            )}
            {view === 'empty' && <h1 style={s.pageTitle}>신고서</h1>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn-accent" style={s.uploadBtn} onClick={() => setShowUpload(true)}>+ 서식 업로드</button>
            <button style={{ ...s.uploadBtn, background: 'var(--c-sidebar-bg)' }} onClick={() => setShowBulkUpload(true)}>일괄 업로드</button>
            <button style={s.themeBtn} onClick={toggleTheme} title={`현재: ${theme} → 다음 테마`}>
              {THEME_LABEL[theme]}
            </button>
          </div>
        </header>

        <main style={s.main}>
          {view === 'editor' && activeTemplate ? (
            <FormulaEditor
              template={activeTemplate}
              onSaved={(updated) => { setActiveTemplate(updated); refresh() }}
            />
          ) : view === 'form' && activeTemplate ? (
            <FormRenderer
              template={activeTemplate}
              entry={selectedEntry}
              company={activeCompany}
              fiscalYearFrom={activeFiscalYear?.from ?? ''}
              fiscalYearTo={activeFiscalYear?.to ?? ''}
              onSaved={handleSaved}
            />
          ) : view === 'pick-forms' && activeCompany && activeFiscalYear ? (
            <FormPickerView
              forms={currentForms}
              company={activeCompany}
              fiscalYear={activeFiscalYear}
              entries={entries}
              onPickForm={(templateId) => handleNewEntry(templateId, activeCompany.id, activeFiscalYear.from, activeFiscalYear.to)}
            />
          ) : (
            <EmptyState
              hasCompanies={companies.length > 0}
              hasForms={currentForms.length > 0}
              onAddCompany={() => setCompanyModal({ isNew: true })}
              onUpload={() => setShowUpload(true)}
            />
          )}
        </main>
      </div>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); refresh() }} />
      )}
      {showBulkUpload && (
        <BulkUploadModal onClose={() => setShowBulkUpload(false)} onDone={() => refresh()} />
      )}

      {companyModal !== null && (
        <CompanyModal
          company={companyModal.company}
          onClose={() => setCompanyModal(null)}
          onSaved={(company) => handleCompanySaved(company, !companyModal?.company)}
        />
      )}

      {taxYearModal !== null && (
        <TaxYearModal
          companyName={taxYearModal.name}
          onClose={() => setTaxYearModal(null)}
          onConfirm={handleTaxYearConfirm}
        />
      )}
    </div>
    </ThemeContext.Provider>
  )
}

/* ── Form picker view ── */
function FormPickerView({
  forms, company, fiscalYear, entries, onPickForm,
}: {
  forms: FormTemplate[]
  company: Company
  fiscalYear: { from: string; to: string }
  entries: FormEntry[]
  onPickForm: (templateId: string) => void
}) {
  return (
    <div style={fp.container}>
      <div style={fp.header}>
        <div style={fp.headerTitle}>신고 서식 선택</div>
        <div style={fp.headerSub}>
          {company.name} &nbsp;·&nbsp; {fiscalYear.from} ~ {fiscalYear.to}
        </div>
        <p style={fp.headerDesc}>이 사업연도에 신고할 서식을 선택하세요. 여러 서식을 추가할 수 있습니다.</p>
      </div>

      {forms.length === 0 ? (
        <div style={fp.empty}>업로드된 서식이 없습니다. 먼저 NTS 서식 PDF를 업로드하세요.</div>
      ) : (
        <div style={fp.grid}>
          {forms.map((form) => {
            const existing = entries.find(
              (e) => e.company_id === company.id &&
                e.fiscal_year_from === fiscalYear.from &&
                e.fiscal_year_to === fiscalYear.to &&
                e.form_templates?.form_code === form.form_code
            )
            return (
              <div key={form.id} style={fp.card}>
                <div style={fp.cardCode}>{form.form_code}</div>
                <div style={fp.cardName}>{form.form_name}</div>
                <div style={fp.cardMeta}>v{form.version_tag}</div>
                {existing ? (
                  <button style={fp.btnExisting} onClick={() => onPickForm(form.id)}>
                    {existing.status === 'final' ? '✓ 확정됨 · 열기' : '● 작성 중 · 계속 작성'}
                  </button>
                ) : (
                  <button className="btn-accent" style={fp.btnNew} onClick={() => onPickForm(form.id)}>
                    + 이 서식 작성 시작
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Empty state ── */
function EmptyState({ hasCompanies, hasForms, onAddCompany, onUpload }: {
  hasCompanies: boolean
  hasForms: boolean
  onAddCompany: () => void
  onUpload: () => void
}) {
  // Step-by-step onboarding guide
  const steps = [
    { done: hasCompanies, label: '법인 추가', action: onAddCompany, btnLabel: '+ 법인 추가' },
    { done: hasForms, label: 'NTS 서식 업로드', action: onUpload, btnLabel: '+ 서식 업로드' },
    { done: false, label: '사업연도 추가 후 신고서 작성', action: null, btnLabel: null },
  ]
  const nextStep = steps.find((s) => !s.done)

  return (
    <div style={s.empty}>
      <div style={s.emptyIcon}>📋</div>
      <h2 style={s.emptyTitle}>iTax 시작하기</h2>
      <div style={s.stepList}>
        {steps.map((step, i) => (
          <div key={i} style={{ ...s.stepRow, opacity: step.done ? 0.5 : 1 }}>
            <span style={{ ...s.stepDot, background: step.done ? 'var(--c-success)' : 'var(--c-text-muted)' }}>
              {step.done ? '✓' : i + 1}
            </span>
            <span style={s.stepLabel}>{step.label}</span>
            {step.done && <span style={s.stepDone}>완료</span>}
          </div>
        ))}
      </div>
      {nextStep?.action && (
        <button className="btn-accent" style={s.emptyBtn} onClick={nextStep.action}>
          {nextStep.btnLabel}
        </button>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  app: { display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--c-app-bg)' },
  mainWrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 28px', height: 56, background: 'var(--c-topbar-bg)',
    borderBottom: '1px solid var(--c-topbar-border)', flexShrink: 0,
  },
  topBarLeft: { display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' },
  companyChip: {
    fontSize: 12, color: 'var(--c-accent-subtle-text)', background: 'var(--c-accent-subtle-bg)',
    padding: '2px 10px', borderRadius: 10, border: '1px solid var(--c-accent-subtle-border)', fontWeight: 600, flexShrink: 0,
  },
  yearChip: {
    fontSize: 11, color: 'var(--c-text-secondary)', background: 'var(--c-meta-label-bg)',
    padding: '2px 8px', borderRadius: 10, border: '1px solid var(--c-card-border)', flexShrink: 0,
  },
  pageTitle: { fontSize: 16, fontWeight: 700, color: 'var(--c-text-primary)', margin: 0, whiteSpace: 'nowrap' },
  versionChip: {
    fontSize: 11, color: 'var(--c-text-muted)', background: 'var(--c-meta-label-bg)',
    padding: '2px 8px', borderRadius: 10, border: '1px solid var(--c-card-border)', flexShrink: 0,
  },
  editorChip: {
    fontSize: 11, color: '#92400e', background: '#fef3c7',
    padding: '2px 8px', borderRadius: 10, border: '1px solid #fde68a', fontWeight: 600, flexShrink: 0,
  },
  uploadBtn: {
    padding: '7px 16px', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, flexShrink: 0,
  },
  themeBtn: {
    padding: '6px 10px', background: 'var(--c-meta-label-bg)', color: 'var(--c-text-primary)',
    border: '1px solid var(--c-card-border)', borderRadius: 6, cursor: 'pointer', fontSize: 15, lineHeight: 1,
  },
  main: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  loadingScreen: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--c-text-muted)',
    background: 'var(--c-app-bg)',
  },
  loadingSpinner: { fontSize: 32, color: 'var(--c-accent)' },
  loadingText: { fontSize: 14 },
  empty: {
    height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--c-text-muted)', padding: 40,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 20, fontWeight: 700, color: 'var(--c-text-primary)', margin: 0 },
  stepList: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4, width: 300 },
  stepRow: { display: 'flex', alignItems: 'center', gap: 12 },
  stepDot: {
    width: 26, height: 26, borderRadius: '50%', color: '#fff',
    fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepLabel: { flex: 1, fontSize: 14, color: 'var(--c-text-secondary)' },
  stepDone: { fontSize: 11, color: 'var(--c-success)', fontWeight: 600 },
  emptyBtn: {
    marginTop: 4, padding: '10px 28px', background: 'var(--c-accent)',
    color: 'var(--c-accent-fg)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
}

const fp: Record<string, React.CSSProperties> = {
  container: { height: '100%', overflowY: 'auto', padding: '32px 40px', background: 'var(--c-form-bg)' },
  header: { marginBottom: 32 },
  headerTitle: { fontSize: 22, fontWeight: 800, color: 'var(--c-text-primary)', marginBottom: 6 },
  headerSub: { fontSize: 13, color: 'var(--c-accent-subtle-text)', fontWeight: 600, marginBottom: 8 },
  headerDesc: { fontSize: 13, color: 'var(--c-text-muted)', margin: 0 },
  empty: { marginTop: 60, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 },
  card: {
    background: 'var(--c-card-bg)', borderRadius: 12, padding: '20px 24px',
    border: '1px solid var(--c-card-border)', boxShadow: '0 1px 4px rgba(0,0,0,.06)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  cardCode: { fontSize: 11, color: 'var(--c-text-muted)', fontWeight: 600 },
  cardName: { fontSize: 15, fontWeight: 700, color: 'var(--c-text-primary)', lineHeight: 1.4 },
  cardMeta: { fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 8 },
  btnNew: {
    padding: '9px 0', background: 'var(--c-accent)', color: 'var(--c-accent-fg)',
    border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  },
  btnExisting: {
    padding: '9px 0', background: 'var(--c-accent-subtle-bg)', color: 'var(--c-accent-subtle-text)',
    border: '1px solid var(--c-accent-subtle-border)', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  },
}
