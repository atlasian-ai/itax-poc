-- Run in Supabase SQL Editor
-- Adds SHA-256 hash column to deduplicate PDF uploads (skip Claude if already extracted)

alter table form_templates
    add column if not exists pdf_hash text;

create index if not exists idx_form_templates_pdf_hash
    on form_templates (pdf_hash);
