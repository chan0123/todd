# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # production
npm run dev      # development with auto-restart (node --watch)
```

No test suite or linter configured.

## Architecture

Single-file frontend served by an Express backend. No build step.

```
server.js          ← Express API + static file server
public/index.html  ← entire frontend (HTML + Tailwind CDN + vanilla JS)
uploads/           ← temp PDF storage (auto-deleted after each request)
Revocable_Transfer_on_Death_Deed.pdf  ← fillable PDF template (17 AcroForm text fields)
```

### Request flow

1. **Upload flow**: `POST /extract` — multer saves file to `uploads/`, text PDFs are parsed with `pdf-parse`, scanned PDFs and images are sent to GPT-4o vision as base64, GPT-4o returns structured JSON, temp file deleted in `finally`.
2. **Manual flow**: client skips `/extract`, goes straight to review form (full form or step-by-step questionnaire).
3. **Both flows**: `POST /generate-todd` — `pdf-lib` loads the template PDF, fills one TODD per owner, merges all into a single PDF, sets `NeedAppearances: true`, returns filled PDF for inline preview and download.

### PDF field mapping

The template has 17 `Tx` fields. Key mappings in `server.js`:

| App field | PDF field name |
|---|---|
| `owners[]` (one TODD per owner) | `Typed or Printed Name of Grantor` |
| `beneficiary1–4` (joined `\n`) | `Beneficiary(ies)` |
| `apn` | `Assessor Parcel Number` |
| `legalDescription` | `Property Description` (or Exhibit A) |
| `witness1 / witness2` | `Typed or Printed Name of Witness #1 / #2` |

Notary acknowledgment fields (`STATE OF`, `COUNTY OF`, `Name and title of the officer`, `Name of person signing`, `Date #2`) are intentionally **not filled** — the notary may be from a different state/county and must complete these themselves.

### Frontend state machine

Five views rendered in a single HTML file: `viewModeSelect → viewUpload → viewReview → viewQuestionnaire → viewSuccess`. View transitions and step indicator updates are managed by `showView(id)`. No framework — pure DOM manipulation.

### Required fields

Server and client both enforce: `owners` (at least one), `apn`, `legalDescription`, `beneficiary1`, `witness1`, `witness2`.

### Environment

Requires `OPENAI_API_KEY` in `.env`. Copy `.env.example` to get started. Uses `gpt-4o` with `response_format: { type: 'json_object' }` and `temperature: 0` for deterministic extraction.
