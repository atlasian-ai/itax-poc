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
| Deployment | Azure Container Apps (backend) · Azure Static Web Apps (frontend) |

All services use free tiers only. Estimated Azure cost: ~$1–10/month for PoC.

---

## Core Features

### 1. PDF Upload & AI Extraction (SSE Streaming)
- Admin uploads an NTS tax form PDF (PDF only — no Excel required)
- Upload endpoint returns a Server-Sent Events stream with per-page progress events:
  - `{"type":"detecting"}` — Claude identifies distinct forms and instruction pages
  - `{"type":"extracting", "page": N, "total_pages": M, "form_name": "..."}` — per-page progress
  - `{"type":"saving"}` — all pages extracted, writing to Supabase
  - `{"type":"done", "results": [...]}` — completed with created form templates
  - `{"type":"error", "message": "..."}` — failure
- Claude pipeline:
  1. **Detection pass**: identify distinct forms + instruction pages in the PDF (`_DETECT_PROMPT`)
     - Returns `form_type: "flat" | "tabular"` per form
     - Returns `page_start` (0-indexed first page of each form in the PDF)
  2. **Extraction pass**: for each form page, extract all numbered fields as JSONL (`_FIELDS_PROMPT`)
     - Instruction pages sent as additional context documents for formula derivation
     - Output format: one JSON object per line (JSONL) — avoids array truncation
     - Field object: `{id, label, type, section, formula, allow_negative}`
  3. **Migration map**: if a previous version exists, Claude diffs old vs new fields
- `_extract_field_objects()`: character-by-character balanced-brace parser — handles truncated Claude output gracefully
- PDF stored in Supabase Storage under `forms/{uuid}.pdf`
- Duplicate detection via `pdf_hash` (SHA-256) — skip re-extraction if same PDF re-uploaded
- Bulk upload endpoint (`POST /forms/bulk-upload`) — up to 10 concurrent Claude calls via `asyncio.Semaphore(10)`
- After upload completes, admin is taken to **BboxAnnotator** to mark field positions on the PDF

### 2. Manual Bbox Annotation (BboxAnnotator)
- Launched automatically after single-form upload; cycles through all forms for multi-form uploads
- Fullscreen tool: PDF page image on left, field list on right
- Admin clicks a field in the list to select it, then drags a rectangle on the PDF to mark its position
- **Multiple bboxes per field** — NTS forms have two-panel layout; the same field number appears in both panels; admin can draw multiple boxes for one field
- Each drawn box is labelled with the field ID on the PDF; individual boxes have a red ✕ to delete
- Page navigation (‹/›) for multi-page PDFs; starts on `template.page_start`
- "건너뜀" skips annotation; "저장 및 완료" saves via `PATCH /forms/{id}/fields`
- `bbox` is stored as `FieldBbox[]` (array) — normalised 0–1 fractions of PDF page dimensions

### 3. Form Entry — Flat Forms
- User selects a company, expands a fiscal year, clicks a form to open it
- Inputs numeric values per field; calculated fields auto-compute from formulas in real time
- Can save as draft or finalise
- Negative numbers supported: raw string tracked during typing, formatted on blur
- Entries stored in `form_entries.field_values` as `{ [fieldId]: number | null }`

### 4. Form Entry — Tabular Forms
- NTS forms with repeating row structure (e.g. 선박표준이익 산출명세서) use `form_type: "tabular"`
- Rendered as a spreadsheet-style table (`TabularRenderer`):
  - Column headers from `template.fields`
  - Editable input rows; "+ 행 추가" adds a row; ✕ removes a row
  - Calculated columns (e.g. ⑥=②×③×④×⑤) evaluated per row in real time
  - Totals row shows column sums for calculated fields
- Entries stored in `form_entries.field_values` as `{ _rows: [{ fieldId: value, ... }, ...] }`

### 5. Formula Calculation
- Client-side, using `useFormCalculation` hook (flat) and `evalRowFormula` (tabular)
- Formula syntax: field IDs as operands, e.g. `01+02-03` or `02*03*04*05`
- Unicode operators normalised before evaluation: `×` → `*`, `÷` → `/`
- Evaluated via `Function()` constructor with field values substituted
- Two-pass evaluation to handle chained calculated fields

### 6. Formula Editor (Admin)
- Accessible from sidebar under 관리: "[Form name] 수식 편집"
- Shows all fields in a filterable table (all / input / calculated)
- Admin can inline-edit: label, section, type (input↔calculated), formula
- Saves via `PATCH /api/forms/{id}/fields`
- Top bar shows amber "수식 편집" chip when in editor mode

### 7. NTS Form Versioning
- Each uploaded PDF creates a new `form_templates` row with `is_current=True`
- Previous current version (matched by `form_name`) is set `is_current=False`, `effective_to` stamped
- **Canonical identifier is `form_name`** — `form_code` alone is not unique across NTS forms
- `upsert` on `(form_name, version_tag)` — re-uploading same version is idempotent
- Forms in the same upload batch cannot mark each other as non-current (tracked via `created_ids` set)
- Claude generates a `migration_map` JSONB diff between versions

### 8. Print / Export View
- Accessible via "인쇄 미리보기" button; two tabs:
  - **원본 서식**: renders PDF page as PNG (`page_start` page), overlays field values at annotated bbox positions; for tabular forms shows blank form image with a note to use 표형식
  - **표 형식**: structured table grouped by section (flat) or row table (tabular); always available
- Default tab: 원본 서식 for flat forms with bbox data; 표 형식 for tabular forms or forms without bbox
- Overlay rendering: PDF page fetched from `GET /api/forms/{id}/page-image?page={page_start}&scale=2`

### 9. Company & Tax Year Management
- Companies stored in `companies` table
- Fiscal years are client-side state (stored in `localStorage` as `pendingYears`) until first entry is saved
- Sidebar groups entries by company → fiscal year → form

### 10. Three-Theme UI
- Themes: `light` | `dark` | `professional` (EY-style dark with yellow accent)
- Cycled via ★/☀/🌙 button in top bar; persisted in `localStorage`
- Implemented via CSS custom properties (`var(--c-*)`) on `[data-theme]` attribute on `<html>`

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
form_type      text              -- "flat" | "tabular" (default "flat")
page_start     integer           -- 0-indexed first page of this form in the PDF (default 0)
fields         jsonb             -- FieldDefinition[]
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
field_values      jsonb   -- flat: { [fieldId]: number | null }
                          -- tabular: { _rows: [{ fieldId: value, ... }, ...] }
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
id             string         -- NTS field number e.g. "01", "02"
label          string         -- Korean field name
type           "input" | "calculated"
section        string         -- nearest section heading (①② etc.)
formula        string | null  -- e.g. "01+02-03" or "02*03*04*05"
allow_negative boolean
bbox           FieldBbox[] | null  -- array; normalised 0–1; set via BboxAnnotator
```

### FieldBbox
```
page  integer  -- 0-indexed page number in the PDF
x     float    -- left edge (0–1 fraction of page width)
y     float    -- top edge (0–1 fraction of page height)
w     float    -- width fraction
h     float    -- height fraction
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/forms/upload` | SSE streaming: upload PDF, extract via Claude, store |
| POST | `/forms/bulk-upload` | Upload multiple PDFs concurrently (up to 10 parallel Claude calls) |
| GET | `/forms` | List all form templates |
| GET | `/forms/{id}` | Get single template with full fields |
| PATCH | `/forms/{id}/fields` | Update fields array (formula editor + BboxAnnotator) |
| GET | `/forms/{id}/page-image` | Render PDF page as PNG (PyMuPDF, `?page=N&scale=2`) |
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
2. Open HWP in Hancom Office → **File → 다른 이름으로 저장 → PDF**
3. In iTax, click "+ 서식 업로드", select the PDF, set 적용 시작일, click 업로드
4. AI extracts fields, formulas, and detects form type (flat/tabular)
5. **BboxAnnotator** launches automatically — admin draws rectangles on each field in the PDF
   - Same field can have multiple boxes (NTS two-panel layout)
   - Click "건너뜀" to skip; click "저장 및 완료" to save positions
6. Form is ready for data entry

---

## Supabase SQL Migrations (run in order)

```sql
-- 1. Core tables
-- (see supabase/migrations.sql)

-- 2. Add companies table
-- (see supabase/add_companies.sql)

-- 3. Add pdf_hash for duplicate detection
ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS pdf_hash text;

-- 4. Add form_type and page_start for multi-form PDFs
ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS form_type text DEFAULT 'flat';
ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS page_start integer DEFAULT 0;
```

---

## Known Constraints & Gotchas

- **Python 3.9**: use `Optional[X]` not `X | None` even with `from __future__ import annotations` (Pydantic v2 limitation)
- **`maybe_single().execute()`**: returns `None` when 0 rows match in supabase-py v2 — guard with `if prev and prev.data:`
- **Korean filenames**: Supabase Storage rejects non-ASCII keys — always use UUID-based storage paths
- **`ANTHROPIC_API_KEY` env**: if set empty in shell, it overrides `.env` — run `unset ANTHROPIC_API_KEY` before starting uvicorn
- **No RLS**: Supabase tables have no Row Level Security (single admin PoC — acceptable)
- **Claude model**: `claude-haiku-4-5-20251001` used for cost efficiency; `max_tokens=16000` required for forms with many fields
- **JSONL output**: Claude fields extraction uses JSONL not JSON array — avoids output truncation on large forms
- **form_code not unique**: NTS reuses form codes across tax regimes — `form_name` is the canonical key
- **formula operators**: Claude sometimes outputs `×` / `÷` — normalised to `*` / `/` before evaluation
- **Tabular overlay**: row data cannot be overlaid on the original form image; 표형식 tab used for tabular form data
- **Vite proxy**: frontend proxies `/api` → `http://localhost:8000`
- **Port conflicts on Windows**: use `python -m uvicorn` (not `uvicorn.exe`) from backend directory
- **Supabase free tier**: project pauses after 1 week inactivity — unpause manually in Supabase dashboard

---

## Deployment (Azure Free Tier)

| Service | Tier | Notes |
|---|---|---|
| Azure Container Apps | Consumption | Scales to zero; 180,000 vCPU-sec + 360,000 GB-sec free/month |
| Azure Static Web Apps | Free | React frontend, custom domain supported |
| GitHub Container Registry | Free (public repo) | Avoids ~$5/month Azure Container Registry |
| Supabase | Free | 500 MB DB, 1 GB storage; project pauses after 1 week inactivity |

Estimated total: **~$1–10/month** (Claude API charges on PDF uploads only).

CI/CD via `.github/workflows/backend.yml` — builds Docker image to `ghcr.io`, deploys to Azure Container Apps on push to `main`.
One-time provisioning: `infra/deploy.sh`.

**Note**: workflows trigger on branch `main` — rename branch from `master` before first deploy.
