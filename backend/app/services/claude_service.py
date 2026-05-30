from __future__ import annotations
import anthropic
import asyncio
import base64
import io
import json
import logging
import re
import traceback
from app.config import settings

logger = logging.getLogger(__name__)

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

# ── Prompts ────────────────────────────────────────────────────────────────────

_DETECT_PROMPT = """This PDF may contain one or more Korean NTS tax forms plus instruction/explanation pages (작성요령, 유의사항).

Return ONLY a compact JSON object (no markdown):
{"forms":[{"form_code":"별지제3호서식","form_name":"법인세 과세표준 및 세액조정계산서","version_tag":"2016.3.7","pages":[0]},
          {"form_code":"별지제4호서식","form_name":"과세표준명세서","version_tag":"2013.2.23","pages":[2]}],
 "instruction_pages":[1,3]}

Rules:
- forms[].pages: 0-indexed page numbers with the actual form table for that form (not instructions).
- instruction_pages: pages that are instructions/explanations (작성요령, 유의사항, 작성방법) for any form.
- version_tag: revision date on the form e.g. "2016.3.7". "" if not visible.
- A page belongs in instruction_pages if it primarily contains prose text explaining how to fill the form.
- Return ONLY valid JSON object."""

_FIELDS_PROMPT = """You are given a Korean NTS tax form page (page {page_index}, 0-indexed) AND its instruction pages (작성요령) as separate documents.

Use the instruction pages to understand the formula logic and calculation rules.
Extract ALL numbered fields visible on the FORM page only.

Output one JSON object per line (JSONL). No array brackets, no markdown:
{{"id":"01","label":"결산서상 당기순손익","type":"input","section":"①각사업연도소득계산","formula":null,"allow_negative":true}}
{{"id":"04","label":"차가감소득금액","type":"calculated","section":"①각사업연도소득계산","formula":"01+02-03","allow_negative":false}}

Rules:
- Extract ONLY fields from the FIRST document (the form page). Do NOT extract fields from instruction documents.
- type: "input"=user fills manually, "calculated"=has a formula (check instructions for the exact formula).
- formula: field ids only e.g. "01+02-03". Derive from instructions if the form table shows a formula reference.
- allow_negative: true if instructions mention △ or minus for that field.
- section: nearest section heading (①② etc.) above the field on the form page.
- One JSON object per line. No trailing commas. No wrapping array."""

_DIFF_PROMPT = """Compare two versions of a Korean NTS tax form and return a migration map.

Previous version fields:
{prev_fields}

New version fields:
{new_fields}

Return JSON:
{{
  "from_version": "{prev_version}",
  "remapped": {{"old_id": "new_id"}},
  "added": ["new_field_id"],
  "removed": ["old_field_id"],
  "formula_changed": ["field_id"]
}}

Return ONLY valid JSON."""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _repair_json(text: str) -> str:
    text = re.sub(r',\s*([\]}])', r'\1', text)  # trailing commas
    text = re.sub(r'\bNone\b', 'null', text)
    text = re.sub(r'\bTrue\b', 'true', text)
    text = re.sub(r'\bFalse\b', 'false', text)
    return text


def _parse_robust(candidate: str) -> any:
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        try:
            return json.loads(_repair_json(candidate))
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON parse failed after repair: {e}\nTail: ...{candidate[-300:]}")


def _extract_object(raw: str) -> str:
    start, end = raw.find('{'), raw.rfind('}')
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found. Preview: {raw[:300]}")
    c = raw[start:end + 1]
    if c.count('{') != c.count('}'):
        raise ValueError(f"Truncated JSON object. Tail: ...{raw[-200:]}")
    return c


def _extract_array(raw: str) -> str:
    start, end = raw.find('['), raw.rfind(']')
    if start == -1 or end == -1:
        raise ValueError(f"No JSON array found. Preview: {raw[:300]}")
    c = raw[start:end + 1]
    if c.count('[') != c.count(']'):
        raise ValueError(f"Truncated JSON array. Tail: ...{raw[-200:]}")
    return c


def _split_pdf_pages(pdf_bytes: bytes) -> list[bytes]:
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = []
    for i in range(len(doc)):
        writer = fitz.open()
        writer.insert_pdf(doc, from_page=i, to_page=i)
        buf = io.BytesIO()
        writer.save(buf)
        pages.append(buf.getvalue())
        writer.close()
    doc.close()
    return pages


def _make_subpdf(pdf_bytes: bytes, page_indices: list[int]) -> bytes:
    """Build a new PDF containing only the specified pages (in order)."""
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    writer = fitz.open()
    for i in page_indices:
        writer.insert_pdf(doc, from_page=i, to_page=i)
    buf = io.BytesIO()
    writer.save(buf)
    writer.close()
    doc.close()
    return buf.getvalue()


async def _claude(content: list, max_tokens: int = 16000) -> str:
    msg = await _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": content}],
    )
    if msg.stop_reason == "max_tokens":
        raise ValueError(
            "Claude hit the output token limit — this form page has too many fields. "
            "Try splitting the PDF into individual forms before uploading."
        )
    return msg.content[0].text.strip()


def _doc_block(pdf_b64: str) -> dict:
    return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64}}


# ── Public API ────────────────────────────────────────────────────────────────

async def detect_forms_in_pdf(pdf_bytes: bytes) -> dict:
    """Preflight: identify distinct forms and instruction pages in a PDF.
    Returns {"forms": [...], "instruction_pages": [...]}
    """
    b64 = base64.standard_b64encode(pdf_bytes).decode()
    raw = await _claude([_doc_block(b64), {"type": "text", "text": _DETECT_PROMPT}], max_tokens=1024)
    result = _parse_robust(_extract_object(raw))
    forms = result.get("forms", [])
    instruction_pages = result.get("instruction_pages", [])
    logger.info(
        "Detected %d form(s) in PDF: %s | instruction pages: %s",
        len(forms), [f.get("form_code") for f in forms], instruction_pages,
    )
    return result


def _extract_field_objects(raw: str) -> list[dict]:
    """Extract all complete {…} field objects from raw text.

    Works whether Claude outputs a JSON array, JSONL, or a truncated version of
    either — each individual object is parsed independently so a cut-off tail
    never corrupts the fields that came before it.
    """
    fields: list[dict] = []
    depth = 0
    start = -1
    for i, ch in enumerate(raw):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start != -1:
                candidate = raw[start:i + 1]
                obj = None
                try:
                    obj = json.loads(candidate)
                except json.JSONDecodeError:
                    try:
                        obj = json.loads(_repair_json(candidate))
                    except json.JSONDecodeError:
                        pass
                if isinstance(obj, dict) and obj.get('id'):
                    fields.append(obj)
                start = -1
    return fields


async def _extract_fields_for_page(
    page_bytes: bytes,
    page_index: int,
    instruction_page_bytes: list[bytes],
) -> list[dict]:
    """Extract fields from a single form page, using instruction pages as context."""
    prompt = _FIELDS_PROMPT.replace("{page_index}", str(page_index))
    content = [_doc_block(base64.standard_b64encode(page_bytes).decode())]
    for instr_bytes in instruction_page_bytes:
        content.append(_doc_block(base64.standard_b64encode(instr_bytes).decode()))
    content.append({"type": "text", "text": prompt})
    raw = await _claude(content)
    fields = _extract_field_objects(raw)
    if not fields:
        raise ValueError(f"No fields found in Claude output. Raw tail: ...{raw[-200:]}")
    logger.info("Page %d: extracted %d fields", page_index, len(fields))
    return fields


async def extract_form_from_pdf(
    pdf_bytes: bytes,
    form_meta: dict | None = None,
    instruction_page_bytes: list[bytes] | None = None,
) -> dict:
    """Extract one form's fields, with optional instruction pages for formula context."""
    pages = _split_pdf_pages(pdf_bytes)

    if form_meta is None:
        form_meta = {"pages": list(range(len(pages)))}

    form_pages = form_meta.get("pages", list(range(len(pages))))
    instr_bytes = instruction_page_bytes or []
    logger.info(
        "Extracting form %s from pages %s (%d instruction page(s) as context)",
        form_meta.get("form_code", "?"), form_pages, len(instr_bytes),
    )

    tasks = [
        asyncio.create_task(_extract_fields_for_page(pages[i], i, instr_bytes))
        for i in form_pages
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_fields: list[dict] = []
    seen_ids: set[str] = set()
    for i, result in zip(form_pages, results):
        if isinstance(result, Exception):
            logger.warning("Page %d field extraction failed: %s", i, result)
            continue
        for field in result:
            fid = field.get("id")
            if fid and fid not in seen_ids:
                all_fields.append(field)
                seen_ids.add(fid)

    return {
        "form_code": form_meta.get("form_code", ""),
        "form_name": form_meta.get("form_name", ""),
        "version_tag": form_meta.get("version_tag", ""),
        "fields": all_fields,
    }


async def extract_all_forms_from_pdf(pdf_bytes: bytes) -> list[dict]:
    """Full pipeline: detect forms + instructions, then extract each form in parallel."""
    results = []
    async for event in stream_extract_forms(pdf_bytes):
        if event.get("type") == "done":
            results = event.get("results", [])
    return results


async def stream_extract_forms(pdf_bytes: bytes):
    """Async generator yielding progress events during extraction.
    Event shapes:
      {"type": "detecting"}
      {"type": "extracting", "page": 1, "total_pages": 4, "form_name": "..."}
      {"type": "done", "results": [...]}
      {"type": "error", "message": "..."}
    """
    import fitz
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        doc.close()
        logger.info("PDF has %d pages — running form detection", page_count)

        yield {"type": "detecting", "total_pages": page_count}

        detection = await detect_forms_in_pdf(pdf_bytes)
        forms_meta = detection.get("forms", [])
        instruction_indices = detection.get("instruction_pages", [])

        all_pages = _split_pdf_pages(pdf_bytes)
        instr_bytes = [all_pages[i] for i in instruction_indices if i < len(all_pages)]

        if not forms_meta:
            logger.warning("No forms detected — falling back to single-form extraction")
            forms_meta = [{"pages": list(range(len(all_pages))), "form_code": "", "form_name": "", "version_tag": ""}]

        total_form_pages = sum(len(m.get("pages", [])) for m in forms_meta)
        pages_done = 0

        # Extract each form; within each form, process pages sequentially for progress reporting
        all_results = []
        for form_meta in forms_meta:
            form_pages = form_meta.get("pages", [])
            form_name = form_meta.get("form_name") or form_meta.get("form_code") or "서식"
            all_fields: list[dict] = []
            seen_ids: set[str] = set()

            for page_idx in form_pages:
                pages_done += 1
                yield {
                    "type": "extracting",
                    "page": pages_done,
                    "total_pages": total_form_pages,
                    "form_name": form_name,
                }
                try:
                    fields = await _extract_fields_for_page(all_pages[page_idx], page_idx, instr_bytes)
                    for field in fields:
                        fid = field.get("id")
                        if fid and fid not in seen_ids:
                            all_fields.append(field)
                            seen_ids.add(fid)
                except Exception as e:
                    logger.warning("Page %d extraction failed: %s", page_idx, e)

            all_results.append({
                "form_code": form_meta.get("form_code", ""),
                "form_name": form_meta.get("form_name", ""),
                "version_tag": form_meta.get("version_tag", ""),
                "fields": all_fields,
            })

        yield {"type": "done", "results": all_results}

    except Exception as e:
        logger.error("stream_extract_forms error: %s\n%s", e, traceback.format_exc())
        yield {"type": "error", "message": str(e)}


async def generate_migration_map(prev_fields: list, new_fields: list, prev_version: str) -> dict:
    prompt = _DIFF_PROMPT.format(
        prev_fields=json.dumps(prev_fields, ensure_ascii=False),
        new_fields=json.dumps(new_fields, ensure_ascii=False),
        prev_version=prev_version,
    )
    raw = await _claude([{"type": "text", "text": prompt}], max_tokens=1024)
    return _parse_robust(_extract_object(raw))
