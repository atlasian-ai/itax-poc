# iTax — Intelligent Tax PoC

Korean NTS (National Tax Service) corporate tax form management tool.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.9 · FastAPI · Uvicorn |
| Frontend | React 18 · Vite · TypeScript (no CSS framework) |
| AI | Anthropic Claude API (`claude-haiku-4-5-20251001`, `max_tokens=16000`) |
| Database | Supabase (PostgreSQL + JSONB) |
| Storage | Supabase Storage (PDF files in `tax-forms` bucket) |
| PDF parsing | PyMuPDF (`fitz`) |
| Excel parsing | openpyxl 3.1.5 |
| Deployment | Azure Container Apps (backend) · Azure Static Web Apps (frontend) |

All services use free tiers only. Estimated Azure cost: ~$6–12/month for PoC.

---

## Core Features

### 1. PDF Upload & AI Extraction (SSE Streaming)
- Admin uploads an NTS tax form PDF (optionally with a Hancom-exported Excel file)
- Upload endpoint returns a Server-Sent Events stream with per-page progress events:
  - `{"type":"detecting"}` — Claude identifies distinct forms and instruction pages
  - `{"type":"extracting", "page": N, "total_pages": M, "form_name": "..."}` — per-page progress
  - `{"type":"saving"}` — all pages extracted, writing to Supabase
  - `{"type":"done", "results": [...]}` — completed with created form templates
  - `{"type":"error", "message": "..."}` — failure
- Claude pipeline:
  1. **Detection pass**: identify distinct forms + instruction pages in the PDF (`_DETECT_PROMPT`)
  2. **Extraction pass**: for each form page, extract all numbered fields as JSONL (`_FIELDS_PROMPT`)
     - Instruction pages sent as additional context documents for formula derivation
     - Output format: one JSON object per line (JSONL) — avoids array truncation
     - Field object: `{id, label, type, section, formula, allow_negative}`
  3. **Migration map**: if a previous version exists, Claude diffs old vs new fields
- `_extract_field_objects()`: character-by-character balanced-brace parser — handles truncated Claude output gracefully; extracts all complete `{...}` objects regardless of trailing truncation
- PDF stored in Supabase Storage under `forms/{uuid}.pdf`
- Duplicate detection via `pdf_hash` (SHA-256) — skip re-extraction if same PDF re-uploaded
- Bulk upload endpoint (`POST /forms/bulk-upload`) — up to 10 concurrent Claude calls via `asyncio.Semaphore(10)`

### 2. Excel-Based Overlay Positioning
- If admin uploads a Hancom-exported `.xlsx` alongside the PDF, field cell positions are auto-extracted
- `excel_service.extract_bbox_from_excel()` algorithm:
  1. Compute pixel positions from `column_dimensions` (widths) + `row_dimensions` (heights) accumulated left→right / top→bottom
  2. Detect panel boundary (NTS forms are two-panel: left = 각사업연도소득, right = 과세표준/세액)
  3. Find cells containing bare integers 1–200 — these are NTS field index numbers
  4. For each field number, find its value cell = rightmost merged range in same row within same panel
  5. Normalise bbox to 0–1 fractions of total sheet dimensions
- Matched by field ID (Claude's `"01"` → integer `1` → Excel row marker `1`)
- `bbox` stored in each `FieldDefinition`: `{page, x, y, w, h}` (all normalised 0–1)
- If no Excel provided, overlay view disabled; table view used instead

### 3. Form Entry (Data Input)
- User selects a company, expands a fiscal year, clicks a form to open it
- Inputs numeric values per field; calculated fields auto-compute from formulas in real time
- Can save as draft or finalise
- Negative numbers supported: raw string tracked during typing, formatted on blur
- Entries stored in `form_entries` table referencing `template_id` (specific version UUID)
- Sidebar entry matching uses `template_id === form.id` (not `form_code`) to support multiple forms with same form code

### 4. Formula Calculation
- Client-side only, using `useFormCalculation` hook
- Formula syntax: field IDs as operands, e.g. `01 + 02 - 03`
- Evaluated via `Function()` constructor with field values substituted

### 5. Formula Editor (Admin)
- Accessible from sidebar under 관리: "[Form name] 수식 편집"
- Shows all fields in a filterable table (all / input / calculated)
- Admin can inline-edit: label, section, type (input↔calculated), formula
- Saves via `PATCH /api/forms/{id}/fields`
- Top bar shows amber "수식 편집" chip when in editor mode

### 6. NTS Form Versioning
- Each uploaded PDF creates a new `form_templates` row with `is_current=True`
- Previous current version (matched by `form_name`) is set `is_current=False`, `effective_to` stamped
- **Canonical identifier is `form_name`** — `form_code` alone is not unique across NTS forms
  (e.g. `별지제3호서식` is reused across different tax regimes)
- `upsert` on `(form_name, version_tag)` — re-uploading same version is idempotent
- Forms in the same upload batch cannot mark each other as non-current (tracked via `created_ids` set)
- Claude generates a `migration_map` JSONB diff between versions:
  - `remapped`: field ID changes (old → new)
  - `added`: new field IDs
  - `removed`: deleted field IDs
  - `formula_changed`: fields whose formula changed
- Old entries always render correctly because they reference their specific `template_id`

### 7. Print / Export View
- Accessible via "인쇄 미리보기" button in FormRenderer
- Two modes:
  - **원본 서식 (overlay)**: renders PDF page as PNG image, overlays field values at bbox positions; only available when `bbox` data exists (i.e. Excel was uploaded)
  - **표 형식 (table)**: structured table grouped by section; always available; used for audit/review
- Overlay rendering: PDF page fetched from `GET /api/forms/{id}/page-image?page=0&scale=2`, rendered via PyMuPDF at 2× scale for sharpness

### 8. Company & Tax Year Management
- Companies stored in `companies` table
- Fiscal years are client-side state (stored in `localStorage` as `pendingYears`) until first entry is saved
- After saving an entry, the fiscal year is promoted from pending to active (derived from entries)
- Sidebar groups entries by company → fiscal year → form

### 9. Three-Theme UI
- Themes: `light` | `dark` | `professional` (EY-style dark with yellow accent)
- Cycled via ★/☀/🌙 button in top bar; persisted in `localStorage`
- Implemented via CSS custom properties (`var(--c-*)`) on `[data-theme]` attribute on `<html>`
- Professional theme: dark background (`#12121a`), yellow accent (`#ffe600`), EY gradient left-border on `.btn-accent` buttons (magenta → blue → teal → yellow via `::before` pseudo-element)

---

## Data Model

### `form_templates`
```
id             uuid PK
form_code      text              -- e.g. "별지제3호서식" (display only, NOT unique)
form_name      text              -- canonical identifier, e.g. "법인세 과세표준 및 세액조정계산서"
version_tag    text              -- e.g. "2016.3.7"
effective_from date
effective_to   date nullable
is_current     boolean
fields         jsonb             -- FieldDefinition[] (includes bbox if Excel was uploaded)
migration_map  jsonb nullable    -- { from_version, remapped, added, removed, formula_changed }
pdf_url        text
pdf_hash       text              -- SHA-256 for duplicate detection
```
Unique constraint: `(form_name, version_tag)`

### `form_entries`
```
id                uuid PK
template_id       uuid FK → form_templates.id
company_id        uuid FK → companies.id nullable
fiscal_year_from  date nullable
fiscal_year_to    date nullable
field_values      jsonb   -- { [fieldId]: number | null }
status            text    -- "draft" | "final"
created_at        timestamptz
updated_at        timestamptz
```

### `companies`
```
id               uuid PK
name             text
business_reg_no  text
created_at       timestamptz
```

### FieldDefinition (JSONB schema inside `form_templates.fields`)
```
id             string   -- NTS field number e.g. "01", "02"
label          string   -- Korean field name
type           "input" | "calculated"
section        string   -- nearest section heading (①② etc.)
formula        string | null  -- e.g. "01+02-03"
allow_negative boolean
bbox           { page, x, y, w, h } | null  -- normalised 0–1, only if Excel uploaded
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/forms/upload` | SSE streaming: upload PDF + optional Excel, extract via Claude, store |
| POST | `/forms/bulk-upload` | Upload multiple PDFs concurrently (up to 10 parallel Claude calls) |
| GET | `/forms` | List all form templates |
| GET | `/forms/{id}` | Get single template with full fields |
| PATCH | `/forms/{id}/fields` | Update fields array (formula editor) |
| GET | `/forms/{id}/page-image` | Render PDF page as PNG (PyMuPDF, `?page=0&scale=2`) |
| GET | `/forms/{form_name}/versions` | List all versions for a form name |
| GET | `/entries` | List all entries (with joined `form_templates` and `companies`) |
| GET | `/entries/{id}` | Get single entry |
| POST | `/entries` | Create new entry |
| PUT | `/entries/{id}` | Update entry |
| GET | `/companies` | List companies |
| POST | `/companies` | Create company |
| PUT | `/companies/{id}` | Update company |
| GET | `/health` | Health check with diagnostics |

Frontend proxies `/api/*` → backend via Vite proxy (`vite.config.ts`), stripping `/api` prefix. Backend runs on port 8000.

---

## NTS Form Upload Workflow (Admin)

1. Download NTS tax form as HWP from www.nts.go.kr → 국세정보 → 서식자료실
2. Open HWP in Hancom Office → **File → 다른 이름으로 저장 → PDF** (for the display image)
3. Open HWP in Hancom Office → **File → 다른 이름으로 저장 → Excel (.xlsx)** (for bbox extraction)
4. In iTax, click "+ 서식 업로드"
5. Upload PDF + Excel together; set 적용 시작일
6. AI extracts fields and formulas; overlay positions auto-detected from Excel

If only PDF is uploaded (no Excel), the overlay view is disabled and table view is used for printing.

---

## Known Constraints & Gotchas

- **Python 3.9**: use `Optional[X]` not `X | None` even with `from __future__ import annotations` (Pydantic v2 limitation)
- **`maybe_single().execute()`**: returns `None` (not `APIResponse`) when 0 rows match in supabase-py v2 — always guard with `if prev and prev.data:`
- **Korean filenames**: Supabase Storage rejects non-ASCII keys — sanitise storage paths
- **`ANTHROPIC_API_KEY` env**: if set empty in shell, it overrides `.env` — run `unset ANTHROPIC_API_KEY` before starting uvicorn
- **No RLS**: Supabase tables have no Row Level Security (single admin PoC — acceptable)
- **Claude model**: `claude-haiku-4-5-20251001` used for cost efficiency; `max_tokens=16000` required for forms with many fields
- **JSONL output**: Claude fields extraction uses JSONL (one object per line) not JSON array — avoids output truncation on large forms
- **`_extract_field_objects()`**: character-level balanced-brace parser ensures partial Claude output never causes total extraction failure
- **form_code not unique**: NTS reuses form codes (e.g. `별지제3호서식`) across tax regimes — `form_name` is the canonical key
- **Excel bbox normalisation**: bbox coordinates are normalised relative to Excel sheet total dimensions; assumes PDF and Excel have matching aspect ratio (both A4)
- **Vite proxy**: frontend proxies `/api` → `http://localhost:8000`; if multiple uvicorn instances exist on different ports, ensure Vite targets the correct one
- **Port conflicts**: on Windows, zombie processes can hold ports; use `python -m uvicorn` (not `uvicorn.exe`) from the backend directory to ensure correct working directory

---

## Deployment (Azure Free Tier)

| Service | Tier | Notes |
|---|---|---|
| Azure Container Apps | Consumption | Scales to zero; 180,000 vCPU-sec + 360,000 GB-sec free/month |
| Azure Static Web Apps | Free | React frontend, custom domain supported |
| GitHub Container Registry | Free (public repo) | Avoids ~$5/month Azure Container Registry |
| Supabase | Free | 500 MB DB, 1 GB storage; project pauses after 1 week inactivity |

Estimated total: **~$6–12/month** (mainly compute during active use).
LibreOffice is NOT required on the server — HWP → PDF/Excel conversion is done manually by admin on their local machine using Hancom Office.

CI/CD via `.github/workflows/backend.yml` — builds to `ghcr.io`, deploys to Azure Container Apps.
One-time provisioning: `infra/deploy.sh`.
