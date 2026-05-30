-- Run in Supabase SQL Editor
-- Makes legacy columns nullable now that company/fiscal year live in new columns

alter table form_entries
    alter column fiscal_year     drop not null,
    alter column company_name    drop not null,
    alter column business_reg_no drop not null;

-- Set sensible defaults for existing rows that have nulls after this
update form_entries
set
    fiscal_year     = coalesce(fiscal_year, ''),
    company_name    = coalesce(company_name, ''),
    business_reg_no = coalesce(business_reg_no, '')
where fiscal_year is null or company_name is null or business_reg_no is null;
