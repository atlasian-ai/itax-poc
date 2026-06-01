import type { FormTemplate, FormEntry, Company } from '../types'

// In production VITE_API_BASE_URL is the full backend URL (no /api suffix).
// In local dev it's empty and the Vite proxy rewrites /api → localhost:8000.
const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

const TOKEN_KEY = 'itax_token'

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
  isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),

  async login(email: string, password: string): Promise<string> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || '로그인에 실패했습니다')
    }
    const data = await res.json()
    auth.setToken(data.token)
    return data.email
  },

  logout() {
    auth.clearToken()
    window.location.reload()
  },
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = auth.getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  })
  if (res.status === 401) {
    auth.clearToken()
    window.location.reload()
    throw new Error('세션이 만료되었습니다')
  }
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
  patchFields: (id: string, fields: unknown[]) =>
    request<FormTemplate>(`/forms/${id}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    }),
  uploadForm: (file: File, effectiveFrom: string, formCodeHint?: string) => {
    const fd = new FormData()
    fd.append('pdf', file)
    fd.append('effective_from', effectiveFrom)
    if (formCodeHint) fd.append('form_code_hint', formCodeHint)
    const token = auth.getToken()
    return fetch(`${BASE}/forms/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    }).then((r) => r.json())
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
