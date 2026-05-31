# iTax PoC

A proof-of-concept tool for managing Korean NTS (국세청) corporate tax forms — upload, annotate, fill, calculate, version, and print them.

---

## Screenshot

<img width="1912" height="907" alt="image" src="https://github.com/user-attachments/assets/ba189f62-cb0f-4b0f-ae01-30fc46f9a3d5" />

---

## What it does

| Feature | Description |
|---|---|
| **Form upload** | Admin uploads an NTS tax form PDF. Claude AI extracts all field definitions, labels, section groupings, formula relationships, and detects whether the form is flat or tabular. |
| **Field annotation** | After upload, admin draws bounding boxes on the PDF to mark each field's position. Same field can have multiple boxes (NTS two-panel layout). Positions used for the original-form print view. |
| **Flat form entry** | Standard NTS forms — numbered fields, calculated fields auto-compute from formulas in real time. |
| **Tabular form entry** | Row-based NTS forms (e.g. 선박표준이익 산출명세서) — spreadsheet-style table with addable rows; per-row formula calculation (e.g. ⑥=②×③×④×⑤); column totals. |
| **Formula engine** | Evaluated client-side via `Function()` constructor. Handles `×`/`÷` Unicode operators from Claude output. Two-pass evaluation for chained formulas. |
| **Form versioning** | Each upload creates a new version. Previous version marked inactive. Claude generates a migration map (added/removed/changed fields). |
| **Company management** | Companies registered with name and business registration number, linked to form entries. |
| **Print preview** | Two tabs: **원본 서식** (PDF image with field values overlaid at annotated positions) and **표 형식** (structured table). Tabular forms default to 표 형식. |
| **Bulk upload** | Multiple PDFs uploaded in one request (up to 10 parallel Claude calls). |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Python 3.9 + FastAPI |
| AI | Anthropic Claude API (`claude-haiku-4-5-20251001`) |
| Database | Supabase (PostgreSQL + Storage) |
| Deployment | Azure Container Apps (backend) + Azure Static Web Apps (frontend) |

---

## Project structure

```
korean-tax-poc/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── routers/
│   │   │   ├── forms.py          # PDF upload, versioning, bbox, page-image endpoints
│   │   │   ├── entries.py        # Form entry CRUD
│   │   │   └── companies.py      # Company CRUD
│   │   └── services/
│   │       ├── claude_service.py # PDF extraction + form_type detection + migration map
│   │       ├── excel_service.py  # Legacy Excel bbox extraction (unused in main flow)
│   │       └── supabase_service.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── Sidebar.tsx           # Form/entry navigation
│       │   ├── FormRenderer.tsx      # Dispatches to flat or tabular entry UI
│       │   ├── TabularRenderer.tsx   # Row-based form entry (spreadsheet table)
│       │   ├── BboxAnnotator.tsx     # Post-upload field position annotation tool
│       │   ├── PrintView.tsx         # 원본 서식 / 표 형식 print preview
│       │   ├── UploadModal.tsx       # PDF upload → BboxAnnotator flow
│       │   └── FormulaEditor.tsx     # Admin field formula editor
│       ├── hooks/
│       │   └── useFormCalculation.ts
│       └── types/index.ts
├── supabase/                         # SQL migration scripts
├── infra/deploy.sh                   # Azure one-time provisioning
└── sample NTS forms/                 # Example NTS PDF + Excel
```

---

## Local setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- A [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com)

### 1. Database

Run the SQL scripts in `supabase/` against your Supabase project in order:

```sql
-- Run supabase/migrations.sql first, then:
ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS pdf_hash text;
ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS form_type text DEFAULT 'flat';
ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS page_start integer DEFAULT 0;
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase URL, service role key, and Anthropic API key
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` to `http://localhost:8000`.

---

## Environment variables

Copy `backend/.env.example` and fill in your own values. **Never commit `.env`.**

```
ANTHROPIC_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
CORS_ORIGINS=http://localhost:5173
```

---

## Deployment

See `infra/deploy.sh` and `.github/workflows/` for Azure Container Apps + Azure Static Web Apps deployment via GitHub Actions.

> **Before deploying:** the CI workflows trigger on branch `main` but the repo uses `master`. Rename the branch or update the workflow files first.

---

## Limitations (PoC scope)

- Single-tenant (no auth / user accounts)
- Tabular form overlay view not supported — row data shown in 표 형식 only
- Field bbox positions must be annotated manually per form upload
- Formula syntax must use numeric field IDs (e.g. `01`, `02`) as operands
