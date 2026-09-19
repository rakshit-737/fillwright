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
  matched and where. Rows are grouped by section, can be filtered by status,
  and any proposed value can be edited for just this form.
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

Pin Fillwright to the toolbar. First launch opens a five-step setup — import
your resume, check what was read, and fill a practice form — which picks up
where you left off if you close the tab.

To produce a Web Store zip: `npm run presubmit` (runs every check, builds
`release/fillwright-<version>.zip`, then inspects the zip for anything that must
not ship). Listing copy, permission justifications, the privacy-practices
declaration, screenshots and a checklist are in [`store/`](./store).

---

## Using it

1. **Options → Resume** — drop in your resume. Everything is parsed on your
   machine; the file is never uploaded.
2. **Review what was read.** Nothing is saved until you confirm.
3. **Options → Profile** — correct anything. An edited field is permanently
   protected: a later resume import will never overwrite it. Email, phone and
   link fields point out likely typos (and add `https://` to links); each
   section can show **what autofill will see**; entries reorder with
   Alt+↑/↓; skills can be pasted as a list.
4. **Options → Application preferences** — set work authorisation, relocation
   and (optionally) demographics and salary. All off and unanswered by default.
5. **On an application**, click the Fillwright toolbar button or press
   `Alt+Shift+F`. A panel appears: "27 application fields found — 21 ready,
   4 to review, 2 need you". It can be dragged (or moved with the arrow keys on
   its title) and minimised with `Esc`.
   Under **Settings → When Fillwright appears** you can choose Assist (it offers
   help on pages that clearly are applications) or Smart (it also prepares the
   plan in advance). Both need site access, which Chrome asks you for. Neither
   fills or submits anything without you.
6. **Review, then Fill.** Every row shows what will change, how confident
   Fillwright is, and — behind "Why?" — what it matched on.
7. **Correct anything it got wrong.** "Change" (or "Set what this is") lets you
   pick what a field means — for this form only, or remembered for the site.
   Remembered corrections can be changed, paused, inspected or reset under
   Options → What Fillwright learned.
8. **Multi-entry forms.** Each education/experience block is filled from the
   matching profile entry. If the form shows fewer blocks than you have entries
   and has one clear "Add education" button, the panel offers to add them.
9. **Written questions** are marked "You need to write this". With on-device AI
   switched on, "Draft with on-device AI" shows exactly which facts would be
   used, then gives you an editable draft; nothing reaches the form until you
   press "Use this answer".
10. **Job postings.** When the posting is on the page, the panel lists which
    skills it mentions that your profile has, and which it does not. It never
    changes your profile.
11. Check the form, then submit it yourself. Fillwright never submits.

---

## Testing it

```bash
npm test             # 326 unit and integration tests (jsdom)
npm run test:e2e     # 96 end-to-end tests in real Chrome, including axe-core
npm run perf         # performance budget in Chrome for Testing
npm run check        # typecheck → lint → audit → test → build → verify
npm run presubmit    # check + package + inspect the zip
npm run probe:ai     # where Chrome exposes its on-device model
npm run screenshots  # store screenshots, 1280×800
```

`E2E_ONLY=<prefix> node tests/e2e/run.mjs` runs only tests whose names start
with the prefix (after `npm run build:e2e`).

### Performance budget

`npm run perf` builds the test extension and measures it in Chrome for Testing,
failing if any figure is over budget. Measured on Chrome for Testing 131 (median
runs, one Windows 11 laptop), comparing the v0.4.0 tag with this release:

| Measurement | Budget | v0.4.0 | v0.5.0 |
|---|---|---|---|
| `content.js` size | ≤ 100 KB | 92.4 KB | 82.0 KB |
| Inject `content.js`, 50-field form | < 50 ms | 32.4 ms | 21.8 ms |
| Harvest + classify, `hard-mode.html` | < 120 ms | 8.5 ms | 9.5 ms |
| MutationObserver callback, 2,000-node burst | < 2 ms | 9.8 ms | < 0.01 ms |

On Chrome for Testing 153 (after the toolchain upgrade) the same build
measures 81.7 KB, 11.8 ms, 6.4 ms and < 0.01 ms.

Passive checks in Assist/Smart mode run at most once every 1.5 s and never
while the page is scrolling (unit-tested in `tests/observe.test.ts`). Timings
vary by machine; the budgets have wide margins on purpose.

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
line, so the suite uses Chrome for Testing, which puppeteer downloads (153 at
the time of writing; run `npx puppeteer browsers install chrome` if it is
missing). Set
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
| `ats/greenhouse.html` | Greenhouse job board: `job_application[...]` names, React-Select school and degree, EEO section |
| `ats/lever.html` | Lever: labels in sibling divs, `urls[...]` names, a written "Additional information" |
| `ats/workday.html` | Workday: two steps with Save and Continue, "Add" education blocks, a school search that loads after typing |
| `ats/ashby.html` | Ashby: React-controlled inputs, radio groups built from buttons |
| `ats/icims.html` | iCIMS / SmartRecruiters: the form in a same-origin iframe |
| `ats/linkedin.html` | LinkedIn Easy Apply: a modal with Next / Review / Submit that must never be pressed |
| `virtual-list.html` | A 600-entry virtualised dropdown |
| `spa-steps.html`, `add-another.html`, `one-off.html`, `rejecting.html`, `frame-host.html` | Router navigation, adding blocks, one-off corrections, a form that rejects every write, a form in someone else's frame |
| `newsletter.html`, `login.html` | Pages that are *not* applications, where proactive modes must stay silent |
| `hostile-roles.html` | Submit buttons and links disguised as dropdowns, options and radios |

Every fixture states its expected behaviour at the top of the page.

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
   frames work via per-frame injection. When the form is in a frame from
   another site, the panel says so and suggests opening it in its own tab.
5. **Repeated blocks are matched by heuristic.** Fillwright reads an index from
   the field name (`education[1].school`), a numbered heading ("Education #2"),
   or repeated DOM structure. An unusual layout may still put everything in the
   first block — the preview shows which block each value came from, and a block
   with no matching profile entry is left empty rather than duplicated.
6. **Local device access defeats the storage protections.** See SECURITY.md §3.5.
7. **AI assistance is on-device only.** Hosted models would require relaxing the
   CSP, which would undermine the central guarantee. Drafting runs in the
   service worker. Chrome for Testing 153 exposes `LanguageModel` there (and on
   extension pages, never on web pages) but reports it unavailable on machines
   without the model; 131 does not expose it at all. Generation with a real
   on-device model has not been verified — see `npm run probe:ai`.
10. **ATS layouts change.** The `test-pages/ats/` fixtures reproduce each
    system's DOM patterns as of this release; they are not copies of the live
    sites, which change without notice.
11. **Searchable dropdowns see a short prefix.** To find an option in a list
    that loads as you type, Fillwright types up to six characters of the value
    into the site's search box, which the site can observe.
8. **Exports are not encrypted.** The export warns about this before saving.
9. **Step progress is per tab and per session.** It lives in memory-only
   session storage and resets when the browser closes.

---

## Future work

- Passive detection inside same-origin application iframes (explicit
  activation already covers them).
- A per-site mapping editor that can create rules before visiting the site.
- Verifying drafting against a real on-device model once one is available in
  a testable Chrome build.
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
