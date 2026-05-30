from __future__ import annotations
from pydantic import BaseModel
from typing import Any, Optional
from datetime import date


class FieldDefinition(BaseModel):
    id: str
    label: str
    type: str  # "input" | "calculated"
    section: str
    formula: Optional[str] = None
    allow_negative: bool = False
    added_in: Optional[str] = None


class MigrationMap(BaseModel):
    from_version: str
    remapped: dict[str, str] = {}
    added: list[str] = []
    removed: list[str] = []
    formula_changed: list[str] = []


class FormTemplateCreate(BaseModel):
    form_code: str
    form_name: str
    version_tag: str
    effective_from: date
    fields: list[FieldDefinition]
    migration_map: Optional[MigrationMap] = None
    pdf_url: str


class FormTemplateResponse(FormTemplateCreate):
    id: str
    is_current: bool
    effective_to: Optional[date] = None


class FormEntryCreate(BaseModel):
    template_id: str
    company_id: Optional[str] = None
    fiscal_year_from: Optional[date] = None
    fiscal_year_to: Optional[date] = None
    field_values: dict[str, Any]
    status: str = "draft"


class FormEntryResponse(FormEntryCreate):
    id: str
    created_at: str
    updated_at: str
    template: Optional[FormTemplateResponse] = None
