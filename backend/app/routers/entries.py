from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException
from app.models import FormEntryCreate
from app.services.supabase_service import get_supabase

router = APIRouter(prefix="/entries", tags=["entries"])


@router.post("")
async def create_entry(body: FormEntryCreate):
    sb = get_supabase()
    result = sb.table("form_entries").insert(body.model_dump(mode='json')).execute()
    return result.data[0]


@router.get("")
async def list_entries(form_code: Optional[str] = None, company_id: Optional[str] = None):
    sb = get_supabase()
    query = (
        sb.table("form_entries")
        .select("*, form_templates(form_code, form_name, version_tag), companies(name, business_reg_no)")
        .order("created_at", desc=True)
    )
    if form_code:
        query = query.eq("form_templates.form_code", form_code)
    if company_id:
        query = query.eq("company_id", company_id)
    result = query.execute()
    return result.data


@router.get("/{entry_id}")
async def get_entry(entry_id: str):
    sb = get_supabase()
    result = (
        sb.table("form_entries")
        .select("*, form_templates(*)")
        .eq("id", entry_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Entry not found")
    return result.data


@router.put("/{entry_id}")
async def update_entry(entry_id: str, body: FormEntryCreate):
    sb = get_supabase()
    result = (
        sb.table("form_entries")
        .update(body.model_dump(mode='json'))
        .eq("id", entry_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Entry not found")
    return result.data[0]


@router.delete("/{entry_id}")
async def delete_entry(entry_id: str):
    sb = get_supabase()
    sb.table("form_entries").delete().eq("id", entry_id).execute()
    return {"deleted": entry_id}
