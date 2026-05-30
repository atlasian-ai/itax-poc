-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- form_templates
-- One row per NTS form version.
-- New NTS version = new row; old rows never change.
-- ─────────────────────────────────────────────
create table if not exists form_templates (
    id              uuid primary key default gen_random_uuid(),
    form_code       text        not null,   -- e.g. "별지제3호서식" — stable across versions
    form_name       text        not null,
    version_tag     text        not null,   -- e.g. "2016.3.7"
    effective_from  date        not null,
    effective_to    date,                   -- null = currently active
    is_current      boolean     not null default true,
    fields          jsonb       not null,   -- array of FieldDefinition objects
    migration_map   jsonb,                  -- how fields changed vs. previous version
    pdf_url         text,
    created_at      timestamptz not null default now(),

    unique (form_code, version_tag)
);

-- Index for fast "give me the current version of form X" queries
create index if not exists idx_form_templates_code_current
    on form_templates (form_code, is_current);

-- ─────────────────────────────────────────────
-- form_entries
-- Each saved set of field values for one fiscal year.
-- Always references the exact template version used — never changes.
-- ─────────────────────────────────────────────
create table if not exists form_entries (
    id              uuid primary key default gen_random_uuid(),
    template_id     uuid        not null references form_templates(id),
    fiscal_year     text        not null,   -- e.g. "2024" or "2024-01-01~2024-12-31"
    company_name    text        not null,
    business_reg_no text        not null,
    field_values    jsonb       not null default '{}',  -- {"01": 5000000, "04": 0, ...}
    status          text        not null default 'draft' check (status in ('draft', 'final')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_form_entries_template
    on form_entries (template_id);

create index if not exists idx_form_entries_fiscal_year
    on form_entries (fiscal_year);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists form_entries_updated_at on form_entries;
create trigger form_entries_updated_at
    before update on form_entries
    for each row execute function update_updated_at();

-- ─────────────────────────────────────────────
-- Supabase Storage bucket for PDF files
-- Run separately or via Supabase dashboard:
--   Storage > New bucket > "tax-forms" > Public: true
-- ─────────────────────────────────────────────
-- insert into storage.buckets (id, name, public)
-- values ('tax-forms', 'tax-forms', true)
-- on conflict do nothing;
