import type { FormTemplate, FormEntry, Company } from '../types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }
  return res.json()
}

export const api = {
  // Forms
  listForms: () => request<FormTemplate[]>('/forms'),
  getForm: (id: string) => request<FormTemplate>(`/forms/${id}`),
  getVersions: (formCode: string) =>
    request<FormTemplate[]>(`/forms/${formCode}/versions`),
  uploadForm: (file: File, effectiveFrom: string, formCodeHint?: string) => {
    const fd = new FormData()
    fd.append('pdf', file)
    fd.append('effective_from', effectiveFrom)
    if (formCodeHint) fd.append('form_code_hint', formCodeHint)
    return fetch(`${BASE}/forms/upload`, { method: 'POST', body: fd }).then(
      (r) => r.json()
    )
  },

  // Companies
  listCompanies: () => request<Company[]>('/companies'),
  createCompany: (body: { name: string; business_reg_no: string }) =>
    request<Company>('/companies', { method: 'POST', body: JSON.stringify(body) }),
  updateCompany: (id: string, body: { name: string; business_reg_no: string }) =>
    request<Company>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Entries
  listEntries: (params?: { formCode?: string; companyId?: string }) => {
    const q = new URLSearchParams()
    if (params?.formCode) q.set('form_code', params.formCode)
    if (params?.companyId) q.set('company_id', params.companyId)
    const qs = q.toString()
    return request<FormEntry[]>(`/entries${qs ? `?${qs}` : ''}`)
  },
  getEntry: (id: string) => request<FormEntry>(`/entries/${id}`),
  createEntry: (body: Omit<FormEntry, 'id' | 'created_at' | 'updated_at'>) =>
    request<FormEntry>('/entries', { method: 'POST', body: JSON.stringify(body) }),
  updateEntry: (
    id: string,
    body: Omit<FormEntry, 'id' | 'created_at' | 'updated_at'>
  ) =>
    request<FormEntry>(`/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteEntry: (id: string) =>
    request<{ deleted: string }>(`/entries/${id}`, { method: 'DELETE' }),
}
