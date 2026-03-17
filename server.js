require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, PDFName, PDFBool, PDFDict, StandardFonts, rgb } = require('pdf-lib');
const { createCanvas } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
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

const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/heic',
  'image/heif',
]);

const upload = multer({
  dest: UPLOADS_DIR,
  fileFilter: (req, file, cb) => {
    if (ACCEPTED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF or image files (JPEG, PNG, WEBP, TIFF, HEIC) are accepted'));
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

FIELD NOTES:
- granteeNames: Array of personal names ONLY — strip all vesting/title language.
  Example: "John A. Smith and Mary B. Smith, Husband and Wife as Community Property with Right of Survivorship"
  → ["John A. Smith", "Mary B. Smith"]
  Keep professional titles/suffixes attached to the name (e.g. "John Smith, Trustee" → ["John Smith, Trustee"]).
- granteeLineRaw: The full verbatim grantee line exactly as written, including vesting language.
- legalDescriptionFull: Preserve EXACTLY as written — every word, abbreviation, and line break.

Return exactly this JSON structure (null for any missing field):
{
  "granteeNames": [],
  "granteeLineRaw": null,
  "vesting": null,
  "propertyAddress": null,
  "city": null,
  "state": null,
  "zip": null,
  "county": null,
  "apn": null,
  "legalDescriptionFull": null,
  "recordingDate": null,
  "instrumentNumber": null,
  "preparer": null,
  "mailingAddressOnly": null,
  "recordingRequestedBy": null
}

Deed text:
`;

// ─── Exhibit A helpers ────────────────────────────────────────────────────────

// Returns true if the text fits in a single line of the Property Description field
async function fitsOnOneLine(pdfDoc, form, text) {
  if (text.includes('\n')) return false;
  try {
    const field = form.getTextField('Property Description');
    const widgets = field.acroField.Widgets();
    if (widgets.length) {
      const { width } = widgets[0].getRectangle();
      if (width > 0) {
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        return font.widthOfTextAtSize(text, 10) <= width;
      }
    }
  } catch {
    // fall through to character-count heuristic
  }
  // Fallback: ~80 chars fits comfortably on one line in most PDF fields
  return text.length <= 80;
}

async function addExhibitA(pdfDoc, legalDescription) {
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const MARGIN      = 72;   // 1 inch
  const FONT_TITLE  = 14;
  const FONT_BODY   = 10;
  const LINE_HEIGHT = FONT_BODY * 1.5;

  // Word-wrap a single paragraph into lines that fit contentWidth
  function wrapText(text, font, size, maxWidth) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      if (paragraph.trim() === '') { lines.push(''); continue; }
      const words = paragraph.split(' ');
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  // Match the size of the first page of the TODD deed
  const firstPage = pdfDoc.getPage(0);
  const { width: PAGE_WIDTH, height: PAGE_HEIGHT } = firstPage.getSize();

  let insertIndex = 1; // insert right after page 0

  function newPage() {
    const page = pdfDoc.insertPage(insertIndex++, [PAGE_WIDTH, PAGE_HEIGHT]);
    return { page, width: PAGE_WIDTH, height: PAGE_HEIGHT, contentWidth: PAGE_WIDTH - MARGIN * 2 };
  }

  let { page, width, height, contentWidth } = newPage();
  let y = height - MARGIN;

  // Title block
  page.drawText('EXHIBIT A', {
    x: MARGIN, y, size: FONT_TITLE, font: bold, color: rgb(0, 0, 0),
  });
  y -= FONT_TITLE + 6;

  page.drawText('LEGAL DESCRIPTION', {
    x: MARGIN, y, size: FONT_BODY + 1, font: bold, color: rgb(0, 0, 0),
  });
  y -= (FONT_BODY + 1) + 8;

  // Divider
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: width - MARGIN, y },
    thickness: 0.75, color: rgb(0, 0, 0),
  });
  y -= 16;

  // Body text
  const lines = wrapText(legalDescription, regular, FONT_BODY, contentWidth);
  for (const line of lines) {
    if (y < MARGIN + LINE_HEIGHT) {
      ({ page, width, height, contentWidth } = newPage());
      y = height - MARGIN;
    }
    if (line !== '') {
      page.drawText(line, { x: MARGIN, y, size: FONT_BODY, font: regular, color: rgb(0, 0, 0) });
    }
    y -= LINE_HEIGHT;
  }
}

// ─── PDF → PNG (for scanned PDFs) ────────────────────────────────────────────

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset({ canvas }, width, height) {
    canvas.width = width;
    canvas.height = height;
  }
  destroy({ canvas }) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function pdfFirstPageToPng(pdfBuffer) {
  const canvasFactory = new NodeCanvasFactory();
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    canvasFactory,
  }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 }); // 2× for legibility
  const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toBuffer('image/png');
}

// ─── POST /extract ────────────────────────────────────────────────────────────

app.post('/extract', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  try {
    let messages;

    const buffer = fs.readFileSync(filePath);

    if (mimeType === 'application/pdf') {
      // PDF: try text extraction first; fall back to vision for scanned PDFs
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const { text } = await pdfParse(buffer);

      if (text && text.trim().length >= 80) {
        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT + text.substring(0, 8000) },
        ];
      } else {
        // Scanned PDF — render first page to PNG and send to GPT-4o vision
        const pngBuffer = await pdfFirstPageToPng(buffer);
        const base64 = pngBuffer.toString('base64');
        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: USER_PROMPT },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
            ],
          },
        ];
      }
    } else {
      // Image: send directly to GPT-4o vision as base64
      const base64 = buffer.toString('base64');

      messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ];
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 2000,
    });

    const extracted = JSON.parse(completion.choices[0].message.content);
    console.log('[/extract] LLM result:', JSON.stringify(extracted, null, 2));

    // Flag required fields that are null for UI highlighting
    const warnings = ['granteeLineRaw', 'apn', 'legalDescriptionFull'].filter(
      (f) => {
        const val = extracted[f];
        return !val || (Array.isArray(val) && val.length === 0);
      }
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
  const owners = Array.isArray(d.owners) && d.owners.length ? d.owners : d.owner ? [d.owner] : [];
  if (!owners.length) missing.push('Owner Name');
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
    const templateBytes = fs.readFileSync(templatePath);

    // Fill one TODD per owner, then merge all into a single PDF
    const filledDocs = await Promise.all(owners.map(async (ownerName) => {
      const pdfDoc = await PDFDocument.load(templateBytes);
      const form = pdfDoc.getForm();

      const set = (name, value) => {
        if (!value) return;
        try {
          form.getTextField(name).setText(String(value).trim());
        } catch {
          // field not found in this template version — skip silently
        }
      };

      const setMultiline = (name, value) => {
        if (!value) return;
        try {
          const field = form.getTextField(name);
          field.enableMultiline();
          field.acroField.setDefaultAppearance('/Helv 12 Tf 0 g');
          field.setText(String(value).trim());
        } catch {
          // field not found — skip silently
        }
      };

      const beneficiaries = [d.beneficiary1, d.beneficiary2, d.beneficiary3, d.beneficiary4]
        .filter(Boolean)
        .join('\n');

      const cityStateZip = [d.city, d.state || 'California', d.zip]
        .filter(Boolean)
        .join(', ');

      set('Typed or Printed Name of Grantor', ownerName);
      set('Assessor Parcel Number', d.apn);
      set('Street Address', d.propertyAddress);
      set('City, State & Zip Code', cityStateZip);
      setMultiline('Beneficiary(ies)', beneficiaries);

      // Legal description: inline if fits one line, otherwise Exhibit A
      if (d.legalDescription) {
        const desc = d.legalDescription.trim();
        if (await fitsOnOneLine(pdfDoc, form, desc)) {
          setMultiline('Property Description', desc);
        } else {
          setMultiline('Property Description', 'See Exhibit A attached hereto and incorporated herein by this reference.');
          await addExhibitA(pdfDoc, desc);
        }
      }

      set('Recording Requested By', d.recordingRequestedBy);
      set('Name', d.recordingRequestedBy);
      set('Street Address #2', d.mailTo);
      set('Typed or Printed Name of Witness #1', d.witness1);
      set('Typed or Printed Name of Witness #2', d.witness2);
      set('Date', d.signingDate);

      const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
      if (acroForm) acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);

      return pdfDoc;
    }));

    // Merge all filled TODDs into one PDF
    const merged = await PDFDocument.create();
    for (const doc of filledDocs) {
      const pageIndices = doc.getPageIndices();
      const pages = await merged.copyPages(doc, pageIndices);
      pages.forEach((p) => merged.addPage(p));
    }

    const filled = await merged.save();

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
