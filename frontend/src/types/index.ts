export interface FieldBbox {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface FieldDefinition {
  id: string
  label: string
  type: 'input' | 'calculated'
  section: string
  formula: string | null
  allow_negative: boolean
  added_in: string | null
  bbox?: FieldBbox | null
}

export interface MigrationMap {
  from_version: string
  remapped: Record<string, string>
  added: string[]
  removed: string[]
  formula_changed: string[]
}

export interface FormTemplate {
  id: string
  form_code: string
  form_name: string
  version_tag: string
  effective_from: string
  effective_to: string | null
  is_current: boolean
  fields: FieldDefinition[]
  migration_map: MigrationMap | null
  pdf_url: string
  excel_url: string | null
}

export interface Company {
  id: string
  name: string
  business_reg_no: string
  created_at: string
}

export interface FormEntry {
  id: string
  template_id: string
  company_id: string | null
  fiscal_year_from: string | null
  fiscal_year_to: string | null
  field_values: Record<string, number | null>
  status: 'draft' | 'final'
  created_at: string
  updated_at: string
  form_templates?: Pick<FormTemplate, 'form_code' | 'form_name' | 'version_tag'>
  companies?: Pick<Company, 'name' | 'business_reg_no'>
}
