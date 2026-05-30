-- Run in Supabase SQL Editor to add company support

create table if not exists companies (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,
    business_reg_no text not null default '',
    created_at      timestamptz not null default now()
);

alter table form_entries
    add column if not exists company_id uuid references companies(id),
    add column if not exists fiscal_year_from date,
    add column if not exists fiscal_year_to   date;

create index if not exists idx_form_entries_company
    on form_entries (company_id);
