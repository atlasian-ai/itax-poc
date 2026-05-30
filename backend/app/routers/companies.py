from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.supabase_service import get_supabase

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyCreate(BaseModel):
    name: str
    business_reg_no: str = ""


@router.get("")
async def list_companies():
    sb = get_supabase()
    result = sb.table("companies").select("*").order("name").execute()
    return result.data


@router.post("")
async def create_company(body: CompanyCreate):
    sb = get_supabase()
    result = sb.table("companies").insert(body.model_dump()).execute()
    return result.data[0]


@router.patch("/{company_id}")
async def update_company(company_id: str, body: CompanyCreate):
    sb = get_supabase()
    result = (
        sb.table("companies")
        .update(body.model_dump())
        .eq("id", company_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Company not found")
    return result.data[0]
