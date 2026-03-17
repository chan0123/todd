# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

1. **Upload flow**: `POST /extract` — multer saves PDF to `uploads/`, `pdf-parse` extracts text, GPT-4o returns structured JSON, temp file deleted in `finally`.
2. **Manual flow**: client skips `/extract`, goes straight to review form.
3. **Both flows**: `POST /generate-todd` — `pdf-lib` loads the template PDF, sets AcroForm text fields, sets `NeedAppearances: true` so PDF viewers regenerate field appearances, returns filled PDF as a download.

### PDF field mapping

The template has 17 `Tx` fields. Key mappings in `server.js`:

| App field | PDF field name |
|---|---|
| `grantor` | `Typed or Printed Name of Grantor` |
| `beneficiary1–4` (joined `\n`) | `Beneficiary(ies)` |
| `county` | `COUNTY OF` |
| `apn` | `Assessor Parcel Number` |
| `legalDescription` | `Property Description` |
| `witness1 / witness2` | `Typed or Printed Name of Witness #1 / #2` |

Page 2 (notary acknowledgment) fields are intentionally **not filled** — left blank for the notary.

### Frontend state machine

Four views rendered in a single HTML file: `viewModeSelect → viewUpload → viewReview → viewSuccess`. View transitions and step indicator updates are managed by `showView(id)`. No framework — pure DOM manipulation.

### Required fields

Server and client both enforce: `grantor`, `county`, `apn`, `legalDescription`, `beneficiary1`, `witness1`, `witness2`.

### Environment

Requires `OPENAI_API_KEY` in `.env`. Copy `.env.example` to get started. Uses `gpt-4o` with `response_format: { type: 'json_object' }` and `temperature: 0` for deterministic extraction.
