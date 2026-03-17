require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, PDFName, PDFBool, PDFDict } = require('pdf-lib');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.warn('\n  ⚠  OPENAI_API_KEY not set. Copy .env.example → .env and add your key.\n');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── Extraction prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a precise California real estate deed parser.

RULES:
1. Return ONLY a valid JSON object. No markdown. No explanation.
2. Use null (not empty string) for any field you cannot confidently identify.
3. Never guess, infer, or hallucinate values.
4. Preserve the legal description EXACTLY as written, using \\n for line breaks.
5. Include full legal names with all titles and suffixes (e.g. "John Smith, Trustee").`;

const USER_PROMPT = `Extract all available fields from this California grant deed.

Return exactly this JSON structure (null for any missing field):
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

Deed text:
`;

// ─── POST /extract ────────────────────────────────────────────────────────────

app.post('/extract', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file provided' });

  const filePath = req.file.path;

  try {
    // pdf-parse required here to avoid its startup file-write quirk
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const buffer = fs.readFileSync(filePath);
    const { text } = await pdfParse(buffer);

    if (!text || text.trim().length < 80) {
      return res.status(422).json({
        error:
          'Could not extract text from this PDF — it may be a scanned image. Please use Manual Entry instead.',
      });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT + text.substring(0, 8000) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 2000,
    });

    const extracted = JSON.parse(completion.choices[0].message.content);

    // Flag required fields that are null for UI highlighting
    const warnings = ['grantor', 'county', 'apn', 'legalDescription'].filter(
      (f) => !extracted[f]
    );

    res.json({ data: extracted, warnings });
  } catch (err) {
    console.error('[/extract]', err.message);
    res.status(500).json({ error: `Extraction failed: ${err.message}` });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

// ─── POST /generate-todd ──────────────────────────────────────────────────────

app.post('/generate-todd', async (req, res) => {
  const d = req.body;

  const missing = [];
  if (!d.grantor) missing.push('Owner Name');
  if (!d.county) missing.push('County');
  if (!d.apn) missing.push('APN');
  if (!d.legalDescription) missing.push('Legal Description');
  if (!d.beneficiary1) missing.push('Beneficiary 1');
  if (!d.witness1) missing.push('Witness 1');
  if (!d.witness2) missing.push('Witness 2');

  if (missing.length) {
    return res
      .status(400)
      .json({ error: `Required fields missing: ${missing.join(', ')}` });
  }

  try {
    const templatePath = path.join(__dirname, 'Revocable_Transfer_on_Death_Deed.pdf');
    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    const set = (name, value) => {
      if (!value) return;
      try {
        form.getTextField(name).setText(String(value).trim());
      } catch {
        // field not found in this template version — skip silently
      }
    };

    const beneficiaries = [d.beneficiary1, d.beneficiary2, d.beneficiary3, d.beneficiary4]
      .filter(Boolean)
      .join('\n');

    const cityStateZip = [d.city, d.state || 'California', d.zip]
      .filter(Boolean)
      .join(', ');

    set('Typed or Printed Name of Grantor', d.grantor);
    set('Beneficiary(ies)', beneficiaries);
    set('COUNTY OF', d.county);
    set('STATE OF', d.state || 'California');
    set('Assessor Parcel Number', d.apn);
    set('Street Address', d.propertyAddress);
    set('City, State & Zip Code', cityStateZip);
    set('Property Description', d.legalDescription);
    set('Recording Requested By', d.recordingRequestedBy);
    set('Street Address #2', d.mailTo);
    set('Typed or Printed Name of Witness #1', d.witness1);
    set('Typed or Printed Name of Witness #2', d.witness2);
    set('Date', d.signingDate);
    // Page 2 (notary acknowledgment) is intentionally left blank for the notary to complete

    // Tell PDF viewers to regenerate field appearances on open
    const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (acroForm) {
      acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);
    }

    const filled = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="TODD_filled.pdf"');
    res.send(Buffer.from(filled));
  } catch (err) {
    console.error('[/generate-todd]', err.message);
    res.status(500).json({ error: `PDF generation failed: ${err.message}` });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  TODD AutoFill → http://localhost:${PORT}\n`);
});
