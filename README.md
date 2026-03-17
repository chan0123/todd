# TODD AutoFill

A web app that auto-fills a California **Revocable Transfer on Death Deed (TODD)** from an uploaded grant deed PDF or manual entry.

---

## What it does

1. **Upload mode** — User uploads an existing grant deed PDF. The text is extracted and sent to GPT-4o, which returns structured property data as JSON. Fields are pre-populated in a review form.
2. **Manual mode** — User skips the upload and fills in the form directly.
3. **Generate** — The server fills a fillable PDF template (AcroForm) with the reviewed data and returns the completed TODD for preview and download in the browser.

> **Legal notice:** This tool is for document preparation assistance only and does not constitute legal advice. All completed deeds must be reviewed by a qualified California attorney before signing or recording.

---

## Getting started

### Prerequisites

- Node.js 18+
- An OpenAI API key (GPT-4o access required)

### Setup

```bash
git clone <repo>
cd todd
npm install
cp .env.example .env   # then add your OPENAI_API_KEY
```

### Running

```bash
npm run dev    # development — auto-restarts on file changes
npm start      # production
```

Open [http://localhost:3000](http://localhost:3000).

---

## Project structure

```
server.js                              ← Express API + static file server
public/index.html                      ← Entire frontend (HTML + Tailwind CDN + vanilla JS)
Revocable_Transfer_on_Death_Deed.pdf   ← Fillable PDF template (AcroForm)
uploads/                               ← Temp PDF storage (auto-deleted after each request)
.env.example                           ← Environment variable template
```

No build step. No framework. No database.

---

## API endpoints

### `POST /extract`

Accepts a PDF upload, extracts text with `pdf-parse`, and calls GPT-4o to return structured property data.

**Request:** `multipart/form-data` with field `pdf` (PDF file, max 10MB)

**Response:**
```json
{
  "data": { ...extracted fields... },
  "warnings": ["grantor", "apn"]
}
```
`warnings` lists required fields that GPT-4o could not confidently extract (highlighted in the UI for the user to complete).

---

### `POST /generate-todd`

Fills the PDF template with the provided data and returns the completed deed.

**Request body (JSON):**
```json
{
  "grantor": "John A. Smith",
  "propertyAddress": "123 Maple Street",
  "city": "Los Angeles",
  "state": "California",
  "zip": "90001",
  "apn": "1234-567-890",
  "legalDescription": "LOT 42 OF TRACT NO. 1234...",
  "recordingRequestedBy": "John A. Smith",
  "mailTo": "123 Maple Street, Los Angeles, CA 90001",
  "beneficiary1": "Jane B. Smith",
  "beneficiary2": "",
  "beneficiary3": "",
  "beneficiary4": "",
  "witness1": "Robert C. Jones",
  "witness2": "Mary D. Williams",
  "signingDate": "March 17, 2026"
}
```

Required fields: `grantor`, `apn`, `legalDescription`, `beneficiary1`, `witness1`, `witness2`.

**Response:** `application/pdf` — the filled TODD PDF.

---

## GPT-4o extraction schema

When a grant deed is uploaded, the following JSON schema is sent to GPT-4o. Fields marked `null` are returned as `null` if the model cannot confidently identify them (never guessed or inferred).

```json
{
  "grantor": null,
  "vesting": null,
  "propertyAddress": null,
  "city": null,
  "state": null,
  "zip": null,
  "county": null,
  "apn": null,
  "legalDescription": null,
  "recordingDate": null,
  "instrumentNumber": null,
  "bookPage": null,
  "preparer": null,
  "mailTo": null,
  "recordingRequestedBy": null
}
```

| Field | Description |
|---|---|
| `grantor` | Full legal name of the current property owner |
| `vesting` | How title is held (e.g. "as community property") |
| `propertyAddress` | Street address of the property |
| `city` / `state` / `zip` | City, state, ZIP of the property |
| `county` | County where the property is located |
| `apn` | Assessor's Parcel Number |
| `legalDescription` | Full legal description, preserved exactly as written |
| `recordingDate` | Date the original deed was recorded |
| `instrumentNumber` | County recorder document number |
| `bookPage` | Book and page reference (older recorded documents) |
| `preparer` | Name of the person or firm who prepared the deed |
| `mailTo` | Mail-to address from the deed header |
| `recordingRequestedBy` | Entity that requested recording |

> Note: only fields that map to the TODD PDF template are carried forward to `/generate-todd`. The extraction schema intentionally captures more context than is strictly needed for filling, to support potential future use.

---

## PDF field mapping

The template has 17 AcroForm `Tx` fields. The following are filled by the app:

| App field | PDF field name | Notes |
|---|---|---|
| `grantor` | `Typed or Printed Name of Grantor` | |
| `beneficiary1–4` | `Beneficiary(ies)` | Joined with newlines; 12pt font |
| `apn` | `Assessor Parcel Number` | |
| `propertyAddress` | `Street Address` | |
| `city + state + zip` | `City, State & Zip Code` | Comma-joined |
| `legalDescription` | `Property Description` | Inline if fits one line, otherwise Exhibit A (page 2) |
| `recordingRequestedBy` | `Recording Requested By` + `Name` | |
| `mailTo` | `Street Address #2` | |
| `witness1` / `witness2` | `Typed or Printed Name of Witness #1 / #2` | |
| `signingDate` | `Date` | |

**Intentionally not filled** (completed by the notary at signing): `STATE OF`, `COUNTY OF`, `Name and title of the officer`, `Name of person signing`, `Date #2`.

### Exhibit A

If the legal description is longer than one line in the `Property Description` field, the app:
- Sets the field to `"See Exhibit A attached hereto and incorporated herein by this reference."`
- Appends an **Exhibit A** page (inserted as page 2, matching the deed's page size) with the full legal description rendered in 10pt Helvetica with word-wrap and multi-page overflow support.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key with GPT-4o access |
| `PORT` | No | HTTP port (default: `3000`) |
