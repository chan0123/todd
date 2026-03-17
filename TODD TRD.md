# 🏠 TRD: California TODD Deed Automation App (MVP)

## 1. Project Summary

**Project Name:** TODD Deed AutoFill MVP

**Goal:**  
Build a lightweight app that lets a user:

1. Upload a California grant deed PDF OR manually enter property details  
2. Use OpenAI to extract key deed information into structured data (if PDF provided)  
3. Review/edit the extracted or entered data  
4. Generate a filled Transfer on Death Deed (TODD)  

**MVP Product Shape:**
- One-page web app  
- HTML + CSS + JavaScript frontend  
- Small backend API  
- No user accounts  
- No persistent storage  

---

## 2. Product Scope

### In Scope
- Upload grant deed PDF (optional)  
- Extract relevant fields (if PDF provided)  
- Manual data entry fallback  
- Editable review UI  
- Generate TODD form  
- Download result  

### Out of Scope
- Authentication system  
- Data persistence  
- Multi-document support  
- E-signatures  
- Legal validation  
- County recording  

---

## 3. Core Assumption

This tool assists document preparation only.

Users must:
- Review extracted or manually entered fields  
- Confirm correctness before generating TODD  

---

## 4. User Flow

### Option A — Upload & Extract (Primary Flow)

1. User uploads grant deed PDF  
2. Backend sends file to OpenAI  
3. Model extracts structured data  
4. UI displays editable fields  
5. User edits/approves fields  
6. Click “Generate TODD”  
7. Backend fills template  
8. User downloads result  

---

### Option B — Manual Entry (Fallback Flow)

1. User selects “Enter details manually”  
2. User fills form  
3. User reviews inputs  
4. Click “Generate TODD”  
5. Backend fills template  
6. User downloads result  

---

## 5. Functional Requirements

### 5.1 Input Mode Selection

- Provide two options:
  - Upload PDF  
  - Manual entry  
- Allow switching between modes  
- Preserve entered data when switching (optional)  

---

### 5.2 Upload Deed PDF

- Accept PDF only  
- Max size: ~10MB  
- Drag/drop + file picker  
- Show upload/loading state  

---

### 5.3 OCR + Extraction (OpenAI)

**Input**
- Grant deed PDF  

**Output**
- Structured data object  

**Fields to Extract**
- Grantor  
- Grantee  
- Vesting  
- Property address  
- City / State / ZIP  
- County  
- APN  
- Legal description  
- Recording date  
- Instrument number  
- Book/page (if available)  
- Preparer  
- Mail-to  

**Rules**
- Do not guess missing fields  
- Return empty/null if unsure  
- Preserve legal description exactly  

---

### 5.4 Manual Entry Form (Fallback)

**Required Fields**
- Owner name (grantor)
- County
- APN
- Legal description
- Beneficiary 1 name

**Optional Fields (up to 4 beneficiaries)**
- Beneficiary 2–4 names
- Property address
- City / State / ZIP
- Recording requested by
- Mail-to address
- Vesting
- Witness 1 / Witness 2 names
- Signing date

**UX Requirements**
- Large textarea for legal description  
- Inline validation  
- Clear section grouping  

---

### 5.5 User Review / Edit

- Editable fields (both flows)  
- JSON preview panel (optional display)  
- Highlight uncertain fields (PDF flow)  
- Allow corrections before generation  

---

### 5.6 Data Handling

- Store extracted or entered data in session memory  
- Same structure used for both flows  
- Allow copy/export if needed  

---

### 5.7 TODD Generation

**Input**
- Reviewed data  

**Output**
- HTML or PDF  

**Approach (Recommended)**
- HTML template → print/PDF  

**Output Format**
- Filled PDF using `Revocable_Transfer_on_Death_Deed.pdf` as the base template
- Fields filled via server-side PDF library (e.g. pdf-lib)
- User downloads the completed PDF

**PDF Field Mapping**

| App Field | PDF Field Name |
|---|---|
| Grantor name | `Typed or Printed Name of Grantor` |
| Beneficiaries (up to 4, newline-separated) | `Beneficiary(ies)` |
| County | `COUNTY OF` |
| State | `STATE OF` |
| APN | `Assessor Parcel Number` |
| Street address | `Street Address` |
| City / State / ZIP | `City, State & Zip Code` |
| Legal description | `Property Description` |
| Recording requested by | `Recording Requested By` |
| Mail-to address | `Street Address #2` |
| Witness 1 | `Typed or Printed Name of Witness #1` |
| Witness 2 | `Typed or Printed Name of Witness #2` |
| Signing date | `Date` |
| Person signing | `Name of person signing` |
| Notary officer name/title | `Name and title of the officer` |
| Notary date | `Date #2` |
| Notary name | `Name` |

---

## 6. Technical Architecture

### 6.1 Frontend

**Stack**
- HTML  
- Tailwind (CDN) or simple CSS  
- Vanilla JavaScript  

**Responsibilities**
- Mode toggle (upload vs manual)  
- Upload UI  
- Manual form UI  
- Editable form rendering  
- API calls  

---

### 6.2 Backend

**Recommended Stack**
- Node.js + Express  

**Responsibilities**
- Handle file upload  
- Call OpenAI API  
- Parse response  
- Return structured data  
- Generate TODD document  

---

## 7. API Design

### POST `/extract`
- Input: PDF file  
- Output: extracted structured data + warnings  

---

### POST `/generate-todd`
- Input: reviewed data  
- Output: HTML or PDF  

---

## 8. Extraction Prompt Design

- Strict structured output  
- No hallucination  
- Preserve legal description exactly  
- Return null if uncertain  

---

## 9. Data Model (Conceptual)

Two logical data types:

**Extracted Deed Data**
- Owner / grantor / grantee  
- County  
- APN  
- Property address  
- Recording info  
- Legal description  
- Confidence indicators  

**TODD Input Data**
- Owner name (grantor)
- Beneficiaries (up to 4; names concatenated into single PDF field)
- County
- APN
- Property address
- City / State / ZIP
- Legal description
- Recording requested by
- Witness 1 name
- Witness 2 name
- Signing date

---

## 10. UI Layout

### Sections
1. Mode selector  
2. Upload panel  
3. Manual form  
4. Editable results  
5. Output panel  

### Buttons
- Upload  
- Extract  
- Generate TODD  
- Download / Print  

---

## 11. Security Requirements

- API key stored server-side only  
- Temporary file storage only  
- Auto-delete files after processing  
- HTTPS required  

---

## 12. Accuracy Requirements

- Target: 85–95% extraction accuracy (PDF flow)  
- Manual flow ensures full user control  
- Mandatory review before output  

---

## 13. Risks & Mitigation

| Risk | Mitigation |
|------|-----------|
| OCR errors | Editable UI |
| Missing PDF | Manual fallback |
| Legal description issues | Large editable field |
| Format variance | Flexible extraction |
| Legal misuse | Disclaimer |

---

## 14. Legal Disclaimer

This tool is for document preparation assistance only and does not provide legal advice. Users should verify all information and consult a qualified attorney before executing or recording documents.

---

## 15. MVP Build Plan

### Phase 1
- Input toggle  
- Manual form  
- Upload + extraction  
- Editable UI  

### Phase 2
- TODD generation  
- Download  

### Phase 3
- Validation  
- Prompt tuning  

---

## 16. Recommended Stack

### Frontend
- HTML  
- Tailwind CDN  
- Vanilla JS  

### Backend
- Node.js + Express
- OpenAI SDK (GPT-4o with vision for PDF extraction)
- pdf-lib (fill PDF form fields server-side)
- multer (file upload handling)

---

## 17. Architecture

User Input (Upload OR Manual)  
→ Frontend (HTML)  
→ Backend (Express)  
→ OpenAI (PDF flow only)  
→ Structured Data  
→ TODD Generator  
→ Download  

---

## 18. Key Insight

Manual fallback:
- Removes dependency on having a deed  
- Improves usability significantly  
- Handles OCR failure cases  
- Makes MVP usable immediately  