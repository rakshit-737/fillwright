# Fillwright

**Import your resume once. Fill job applications from a profile that never leaves your device.**

Fillwright is a privacy-first Chrome extension (Manifest V3) that reads your
resume locally, builds a structured profile you can edit, and fills application
forms after showing you exactly what it is about to write.

It never submits an application. That click is always yours.

---

## What it does

- **Reads your resume on-device** — PDF, DOCX, TXT, drag-and-drop or pasted text.
- **Builds a structured profile** — contact details, education, experience,
  projects, skills, certifications, achievements, languages — with a confidence
  score and a plain-English reason attached to every value.
- **Detects application fields** across Greenhouse, Lever, Workday, Ashby,
  SmartRecruiters, iCIMS, Taleo, Workable, LinkedIn and ordinary career pages,
  using a generic engine rather than per-site scrapers.
- **Shows you a preview** before touching the form, with what changes and why.
- **Fills repeated sections correctly** — "Education #1" and "Education #2" draw
  from different entries, never the same one twice.
- **Drives custom dropdowns** (React Select, Downshift, ARIA comboboxes) by
  opening them and picking the matching option, and refuses when two options fit.
- **Verifies every write** and reports what did not take, with a one-click retry.
- **Learns from your corrections.** Tell it what an unrecognised field means and
  it remembers, for that site, on this device only.
- **Explains itself.** Every row in the review list has a "Why?" that says what
  matched and where.
- **Encrypts what it stores**, optionally, with a passphrase only you hold.
- **Refuses to guess** work authorisation, visa status, demographics, salary or
  criminal history. Those come only from answers you set yourself.
- **Undoes a fill** in one click.

---

## Install (unpacked)

```bash
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`dist/`** folder

Pin Fillwright to the toolbar. First launch opens the onboarding page.

To produce a Web Store zip: `npm run package` (runs every check first, writes
`release/fillwright-<version>.zip`).

---

## Using it

1. **Options → Resume** — drop in your resume. Everything is parsed on your
   machine; the file is never uploaded.
2. **Review what was read.** Nothing is saved until you confirm.
3. **Options → Profile** — correct anything. An edited field is permanently
   protected: a later resume import will never overwrite it.
4. **Options → Application preferences** — set work authorisation, relocation
   and (optionally) demographics and salary. All off and unanswered by default.
5. **On an application**, click the Fillwright toolbar button or press
   `Alt+Shift+F`. A panel appears with what it found.
6. **Review, then Fill.** Every row shows what will change, how confident
   Fillwright is, and — behind "Why?" — what it matched on.
7. **Correct anything it got wrong.** "Set what this is" teaches Fillwright the
   field for that site; it is remembered next time. Review everything under
   Options → What Fillwright learned.
8. Check the form, then submit it yourself.

---

## Testing it

```bash
npm test          # 238 unit and integration tests (jsdom)
npm run test:e2e  # 49 end-to-end tests in real Chrome
npm run check     # typecheck → lint → test → build → verify
```

### The end-to-end suite

`npm run test:e2e` builds the extension, loads it into Chrome for Testing, and
drives it exactly as a user would — real service worker, real shadow DOM, real
CSP enforcement, real input events. It covers the surfaces jsdom cannot reach:
the panel rendering on a page, filling React-controlled inputs, undo, custom
dropdowns, repeated blocks, and a check that the extension genuinely cannot make
an outbound network request.

This matters more than the test count suggests. The first time it ran it found a
field-mapping bug that 173 jsdom tests had missed, on the most common form layout
there is (see `tests/context-isolation.test.ts`). A later report from real use
found another: importing a **PDF** hung on save, because pdf.js detaches the
buffer it is handed and every test until then had used plain text. Both are now
covered here.

Stable Chrome 137 and later refuse to load unpacked extensions from the command
line, so the suite uses Chrome for Testing, which puppeteer downloads. Set
`CHROME_PATH` to override. `HEADED=1 npm run test:e2e` runs it visibly.

Local test forms are in `test-pages/`. Serve them over HTTP (extensions cannot
be injected into `file://` URLs without permissions Fillwright deliberately does
not request):

```bash
npx serve test-pages     # then open http://localhost:3000
```

| Page | What it exercises |
|---|---|
| `greenhouse.html` | Labelled inputs, autocomplete attributes, file upload, custom questions |
| `workday.html` | No `<label>` elements at all, `aria-labelledby`, ids with colons and brackets, a collapsed section |
| `react-form.html` | Controlled inputs that revert any write not made through the native setter |
| `edge-cases.html` | Prefilled fields, referee details, credentials, demographics, two-country work authorisation, shadow DOM, dynamically added fields, prompt injection |
| `hard-mode.html` | The regression playground: 50+ controls, repeated education and experience blocks, three custom dropdowns (including one in a portal and one deliberately ambiguous), a field that rejects writes, aria-only labels |

`edge-cases.html` and `hard-mode.html` state the expected behaviour above each
section; anything else is a bug.

---

## Architecture

```
src/
  types/            Profile, settings, field and message schemas
  parser/           Resume text extraction + structured parsing
    extract/        PDF (pdf.js), DOCX (fflate + WordprocessingML), TXT
  profile/          Factory, merge, completeness scoring
  field-detection/  harvest.ts (DOM → signals) · classify.ts (signals → field)
                    groups.ts (repeated Education #1 / #2 blocks)
  autofill/         resolve.ts (field → value) · plan.ts (safety rules) · fill.ts (writing)
                    combobox.ts (custom dropdowns driven like a person would)
  adapters/         Per-site DOM preparation, tightly constrained
  storage/          IndexedDB wrapper + repositories
  security/         Input validation, scan guard, sensitive-data enforcement
                    crypto.ts + vault.ts (optional encryption at rest)
  ai/               Optional on-device assistance, off by default
  background/       Service worker — sole owner of all persisted data
  content/          Injected script + shadow-root panel
  popup/ options/   React UI
```

### How resume parsing works

Text is extracted per format, then repaired (soft hyphens, line-break
hyphenation, non-breaking spaces). The document is split into sections by a
heading vocabulary, and each section gets a dedicated parser. Every value
carries a confidence score and a reason.

Two rules hold throughout: **nothing is invented** (an unknown field stays
empty), and **nothing sensitive is inferred** — never from a name, a university,
or a location.

For PDFs, pdf.js returns positioned glyph runs rather than lines, so Fillwright
reconstructs lines from baseline positions and re-inserts spacing from the gaps.
Tabs are preserved through parsing because they are the only surviving trace of
a two-column layout.

### How field detection works

`harvest.ts` reads the DOM into plain data; `classify.ts` is a **pure function**
over that data — no DOM, no network, no model. Signals are weighted by
authority:

```
autocomplete (1.00)  →  <label> (0.97)  →  aria-label (0.93)
  →  name (0.86)  →  id / placeholder (0.80)  →  nearby text (0.62)
```

Independent agreement between signals raises confidence; a close runner-up
lowers it and the field is offered for review instead of filled. Negative rules
matter as much as positive ones — they are what stop "Company Name" being read
as a person's name, or "Confirm Email" as your email address.

Below the confidence threshold (70% by default, adjustable), Fillwright suggests
rather than fills.

### How privacy is achieved

Summarised here; the full threat model is in [SECURITY.md](./SECURITY.md).

- The manifest's CSP pins `connect-src 'self'`, so the extension **cannot**
  make an outbound request. "Nothing leaves your device" is enforced by the
  runtime, not promised in a policy.
- No `<all_urls>`, no declarative content script. Fillwright has no presence on
  a page until you activate it there.
- No analytics, no telemetry, no remote code, no tracking of where you apply.
- The build fails if any of the above stops being true — see
  `scripts/verify-build.mjs`.

---

## Known limitations

1. **Heuristics are heuristics.** Unusual resume layouts and unusual forms will
   sometimes be read wrong. Everything is previewed and editable for this reason,
   and every write is verified afterwards rather than assumed to have worked.
2. **Image-only PDFs cannot be read** — there is no OCR. Paste the text instead.
3. **Files cannot be attached.** Browsers forbid an extension from populating a
   file input. Fillwright flags it and you pick the file.
4. **Closed shadow roots and cross-origin iframes are invisible.** Same-origin
   frames work via per-frame injection.
5. **Repeated blocks are matched by heuristic.** Fillwright reads an index from
   the field name (`education[1].school`), a numbered heading ("Education #2"),
   or repeated DOM structure. An unusual layout may still put everything in the
   first block — the preview shows which block each value came from, and a block
   with no matching profile entry is left empty rather than duplicated.
6. **Local device access defeats the storage protections.** See SECURITY.md §3.5.
7. **AI assistance is on-device only.** Hosted models would require relaxing the
   CSP, which would undermine the central guarantee.

---

## Future work

- Answer drafting wired into the on-page panel — the provider and the safety
  copy exist, the in-panel flow does not yet.
- Job-description matching ("your profile mentions 3 of the 4 listed skills").
- "Add another entry" support, for forms with fewer blocks than your profile has
  entries.
- Firefox support (MV3 there differs meaningfully).

---

## Development

```bash
npm run dev         # rebuild on change
npm run typecheck
npm run lint
npm test
npm run icons       # regenerate the PNG icons
npm run check       # everything, in order
```

After a rebuild, press the reload button on `chrome://extensions`.

---

## Licence

MIT. See [SECURITY.md](./SECURITY.md) for the threat model and reporting policy.
