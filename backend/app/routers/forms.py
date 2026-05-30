from __future__ import annotations
import asyncio
import hashlib
import logging
import re
import traceback
import uuid
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, Form
import json as _json
from fastapi.responses import Response, StreamingResponse
from app.services.supabase_service import get_supabase
from app.services.claude_service import extract_all_forms_from_pdf, stream_extract_forms, generate_migration_map
from app.services.excel_service import extract_bbox_from_excel, fill_excel_with_values, excel_to_html

# Max simultaneous Claude calls for bulk upload
_BULK_SEMAPHORE = asyncio.Semaphore(10)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/forms", tags=["forms"])


def _normalize_form_code(code: str) -> str:
    """Strip spaces and normalise form code so '별지 제3호서식' == '별지제3호서식'."""
    import re
    return re.sub(r'\s+', '', code).strip()


@router.post("/upload")
async def upload_form(
    pdf: UploadFile = File(...),
    effective_from: str = Form(...),
    form_code_hint: str = Form(None),
    excel: Optional[UploadFile] = File(None),
):
    """SSE streaming upload: streams per-page extraction progress, then saves."""
    if pdf.content_type != "application/pdf":
        raise HTTPException(400, "Only PDF files are accepted")

    pdf_bytes = await pdf.read()
    filename = pdf.filename or "upload.pdf"
    excel_bytes = await excel.read() if excel else None

    async def generate():
        extracted_results = []
        try:
            async for event in stream_extract_forms(pdf_bytes):
                if event.get("type") == "done":
                    extracted_results.extend(event.get("results", []))
                else:
                    yield f"data: {_json.dumps(event)}\n\n"

            yield f"data: {_json.dumps({'type': 'saving'})}\n\n"
            saved = await _save_forms(extracted_results, pdf_bytes, effective_from, form_code_hint, filename, excel_bytes)
            yield f"data: {_json.dumps({'type': 'done', 'results': saved})}\n\n"

        except Exception as e:
            logger.error("upload error: %s\n%s", e, traceback.format_exc())
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/bulk-upload")
async def bulk_upload_forms(
    pdfs: List[UploadFile] = File(...),
    effective_from: str = Form(...),
):
    """Upload multiple NTS tax form PDFs concurrently (up to 10 parallel Claude calls)."""
    async def process_one(pdf: UploadFile) -> dict:
        async with _BULK_SEMAPHORE:
            try:
                pdf_bytes = await pdf.read()
                results = await _process_pdf(pdf_bytes, effective_from, None, pdf.filename or "upload.pdf")
                return {"filename": pdf.filename, "status": "ok", "forms_created": len(results), "result": results}
            except Exception as e:
                logger.error("Bulk upload failed for %s: %s", pdf.filename, e)
                return {"filename": pdf.filename, "status": "error", "error": str(e)}

    results = await asyncio.gather(*[process_one(p) for p in pdfs])
    return list(results)


async def _process_pdf(pdf_bytes: bytes, effective_from: str, form_code_hint: Optional[str], filename: str) -> list[dict]:
    """Hash-check → extract → save. Returns list of created templates."""
    sb = get_supabase()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    existing = sb.table("form_templates").select("*").eq("pdf_hash", pdf_hash).execute()
    if existing.data:
        logger.info("PDF hash cache hit for %s (%d form(s))", filename, len(existing.data))
        return existing.data

    all_extracted = await extract_all_forms_from_pdf(pdf_bytes)
    return await _save_forms(all_extracted, pdf_bytes, effective_from, form_code_hint, filename)


async def _save_forms(
    all_extracted: list[dict],
    pdf_bytes: bytes,
    effective_from: str,
    form_code_hint: Optional[str],
    filename: str,
    excel_bytes: Optional[bytes] = None,
) -> list[dict]:
    """Upload PDF to storage and insert form_template rows. Returns created records."""
    logger.info("_save_forms: %d forms, excel_bytes=%s", len(all_extracted), f"{len(excel_bytes)} bytes" if excel_bytes else "None")
    sb = get_supabase()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

    # Upload PDF to storage once
    storage_path = f"forms/{uuid.uuid4()}.pdf"
    pdf_url = None
    try:
        sb.storage.from_("tax-forms").upload(
            path=storage_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf"},
        )
        pdf_url = sb.storage.from_("tax-forms").get_public_url(storage_path)
    except Exception as e:
        logger.warning("Storage upload failed (%s): %s", filename, e)

    # Upload Excel to storage once (if provided)
    excel_url = None
    if excel_bytes:
        excel_path = f"forms/{uuid.uuid4()}.xlsx"
        try:
            sb.storage.from_("tax-forms").upload(
                path=excel_path,
                file=excel_bytes,
                file_options={"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
            )
            excel_url = sb.storage.from_("tax-forms").get_public_url(excel_path)
            logger.info("Excel stored at %s, url=%s", excel_path, excel_url)
        except Exception as e:
            logger.warning("Excel storage upload failed (%s): %s", filename, e)

    # form_code_hint is only meaningful for single-form PDFs
    apply_hint = len(all_extracted) == 1

    created = []
    created_ids: set[str] = set()  # track IDs inserted in this batch
    for form_index, extracted in enumerate(all_extracted):
        form_code = _normalize_form_code(
            (form_code_hint if apply_hint else None) or extracted.get("form_code", "")
        )
        form_name = extracted.get("form_name", filename)
        version_tag = extracted.get("version_tag") or effective_from
        fields = extracted.get("fields", [])

        if excel_bytes:
            fields = extract_bbox_from_excel(excel_bytes, fields, sheet_index=form_index, pdf_bytes=pdf_bytes)

        migration_map = None
        prev = (
            sb.table("form_templates")
            .select("id, version_tag, fields")
            .eq("form_name", form_name)
            .eq("is_current", True)
            .limit(1)
            .execute()
        )
        if prev.data and prev.data[0]["id"] not in created_ids:
            prev_row = prev.data[0]
            try:
                migration_map = await generate_migration_map(
                    prev_fields=prev_row["fields"],
                    new_fields=fields,
                    prev_version=prev_row["version_tag"],
                )
            except Exception as e:
                logger.warning("Migration map failed for %s: %s", form_name, e)
            sb.table("form_templates").update(
                {"is_current": False, "effective_to": effective_from}
            ).eq("id", prev_row["id"]).execute()

        row = {
            "form_code": form_code,
            "form_name": form_name,
            "version_tag": version_tag,
            "effective_from": effective_from,
            "is_current": True,
            "fields": fields,
            "pdf_url": pdf_url,
            "pdf_hash": pdf_hash,
            "migration_map": migration_map,
            "excel_url": excel_url,
        }
        insert_result = sb.table("form_templates").upsert(row, on_conflict="form_name,version_tag").execute()
        if insert_result.data:
            created.append(insert_result.data[0])
            created_ids.add(insert_result.data[0]["id"])
            logger.info("Created form template: %s (%s)", form_code, version_tag)

    if not created:
        raise HTTPException(500, "No form templates were created")
    return created



@router.get("")
async def list_forms():
    sb = get_supabase()
    result = (
        sb.table("form_templates")
        .select("id, form_code, form_name, version_tag, effective_from, is_current")
        .order("form_name")
        .execute()
    )
    return result.data


@router.get("/{form_id}")
async def get_form(form_id: str):
    sb = get_supabase()
    result = (
        sb.table("form_templates")
        .select("*")
        .eq("id", form_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Form template not found")
    return result.data


@router.get("/{form_id}/filled-view")
async def get_filled_view(form_id: str, entry_id: Optional[str] = None):
    """Return the NTS form as filled HTML (Excel + field values → xlsx2html)."""
    import httpx
    sb = get_supabase()

    tmpl = sb.table("form_templates").select("*").eq("id", form_id).single().execute()
    if not tmpl.data:
        raise HTTPException(404, "Form template not found")
    template = tmpl.data

    excel_url = template.get("excel_url")
    if not excel_url:
        raise HTTPException(404, "No Excel file associated with this form — re-upload with an Excel file to enable this view")

    # Fetch Excel from storage
    async with httpx.AsyncClient() as client:
        resp = await client.get(excel_url, follow_redirects=True)
        if resp.status_code != 200:
            raise HTTPException(502, "Could not fetch Excel from storage")
        excel_bytes = resp.content

    # Get field values from entry if provided
    input_values: dict = {}
    if entry_id:
        entry_res = sb.table("form_entries").select("field_values").eq("id", entry_id).single().execute()
        if entry_res.data:
            input_values = entry_res.data.get("field_values") or {}

    fields = template.get("fields") or []
    filled_bytes = fill_excel_with_values(excel_bytes, fields, input_values, sheet_index=0)
    html = excel_to_html(filled_bytes, sheet_index=0)

    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/{form_id}/page-image")
async def get_page_image(form_id: str, page: int = 0, scale: float = 2.0):
    """Render a PDF page as a PNG image for the overlay print view."""
    import fitz  # pymupdf
    import httpx

    sb = get_supabase()
    result = (
        sb.table("form_templates")
        .select("pdf_url")
        .eq("id", form_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Form template not found")

    pdf_url = result.data["pdf_url"]
    async with httpx.AsyncClient() as client:
        resp = await client.get(pdf_url, follow_redirects=True)
        if resp.status_code != 200:
            raise HTTPException(502, "Could not fetch PDF from storage")
        pdf_bytes = resp.content

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if page >= len(doc):
        raise HTTPException(400, f"Page {page} out of range (doc has {len(doc)} pages)")
    pix = doc[page].get_pixmap(matrix=fitz.Matrix(scale, scale))
    img_bytes = pix.tobytes("png")
    doc.close()
    return Response(content=img_bytes, media_type="image/png")


@router.patch("/{form_id}/fields")
async def patch_fields(form_id: str, payload: dict):
    """Update the fields array for a form template (formula editor saves here)."""
    fields = payload.get("fields")
    if fields is None:
        raise HTTPException(400, "fields required")
    sb = get_supabase()
    result = (
        sb.table("form_templates")
        .update({"fields": fields})
        .eq("id", form_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Form template not found")
    return result.data[0]


@router.get("/{form_name}/versions")
async def list_versions(form_name: str):
    sb = get_supabase()
    result = (
        sb.table("form_templates")
        .select("id, version_tag, effective_from, effective_to, is_current")
        .eq("form_name", form_name)
        .order("effective_from", desc=True)
        .execute()
    )
    return result.data
