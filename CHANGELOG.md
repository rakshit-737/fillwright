# Changelog

Notable changes, newest first. Versions follow semantic versioning.

## 0.6.0 — 2026-09-20

### Security

- **Work-authorisation answers no longer go to the wrong country.** The
  pronoun "us" ("let us know", "tell us", "work for us") was read as the
  United States, so a saved US answer could be proposed for an India, UK or
  Canada question. Countries now come from one table (also used for dropdown
  aliases) where "US", "U.S." and "USA" match only case-sensitively as whole
  tokens. A question naming several countries, or none, is never answered and
  says what it found ("this question mentions the United States and Canada").
  The table grew from ten countries to about fifty.
- **Switching encryption can no longer lose data.** Enabling, disabling and
  changing the passphrase used to write each record in its own transaction and
  save the salt last; an interruption (for example running out of disk space
  on a large resume) left ciphertext under a salt that was never stored, and a
  retry failed too. All records and the meta record are now computed first and
  written in one transaction, so a failure changes nothing. Free space is
  checked beforehand (`EQUOTA`).
- IndexedDB writes now resolve when their transaction completes, not when the
  request succeeds, so a write that aborts at commit is no longer reported as
  saved.
- A store left half-encrypted by an earlier version is detected and the
  Security page explains how to recover, instead of showing "locked" forever.
- **Hidden fields and honeypots are no longer filled.** A field hidden with
  `opacity: 0`, moved off-screen, clipped to 1 px, placed in a zero-size
  container, or inside an `aria-hidden` or `inert` subtree used to count as
  visible, could come back "ready" and be written by "Fill N ready". These are
  now recognised as hidden, never sent for a value, and cannot be ticked. The
  panel says "N hidden fields ignored" and lists why on request.
- **Covered fields are refused at fill time.** Just before writing a ticked
  field, Fillwright checks that the field (or its label) is what is actually at
  its position on the page, so a control hidden under another element is not
  written.
- **Site adapters no longer press page buttons on their own.** The Ashby,
  Workday and SmartRecruiters adapters clicked every collapsed
  `button[aria-expanded="false"]` — dropdowns, menus and navigation included,
  up to 20 per scan — and did so in Smart mode's passive scans, before the user
  had done anything, and again on every form change. Adapters now run only when
  the user opens Fillwright, press only accordions (a real `aria-controls`
  region or a heading disclosure), never anything with `aria-haspopup`, a
  combobox/menu role, or inside `nav`/`header`/menus/toolbars, press each
  element at most once per page, and stop when a press reveals no new fields.
- The content script sees only titles of custom fields and saved answers
  (`content:answer-choices`); the text of one saved answer crosses only after
  the user picks it (`content:saved-answer`).
- `content:save-mapping` now validates the field a page asks to save. It
  previously stored whatever canonical field the message named.
- **Certify / agree / consent / declare checkboxes are never ticked.** They
  are listed as "Needs your answer", even when a saved rule or a strong match
  points at them.
- `content:open-page` now accepts the `profile` route with an optional
  `field`, validated against `FIELD_CATALOG` in both the content script and
  the service worker. It still only opens a page.
- DOCX parts are capped at 8 MB each and 16 MB in total, checked against the
  declared sizes before anything is inflated. fflate never inflates past a
  declared size, so a ZIP bomb is refused quickly and a lying header only
  truncates its entry.
- **The panel can no longer be click-jacked.** A page could cover the panel
  with a see-through, `pointer-events: none` element in the top layer and bait
  a click straight through to "Fill N ready", or dispatch a synthetic click.
  Now: every panel control ignores untrusted events (`isTrusted`); the panel
  is shown as a manual popover so it sits in the top layer, and takes the top
  back (at most three times in ten seconds) when the page opens a dialog,
  popover or fullscreen element; and Fill arms only after the panel has been
  continuously visible and unobscured for about 500 ms, measured with
  IntersectionObserver v2. When something covers the panel, Fill is paused and
  the panel says so. Until armed the button is `aria-disabled`, so keyboard
  focus still lands on it.
- **Smart mode no longer puts values in the page before you open the panel.**
  The plan it prepares in advance now carries counts and statuses only; the
  worker blanks every proposed value and rationale. Opening the pill fetches
  the real plan.
- **Every handler that stores something validates it first.** A malformed
  `ui:save-profile`, `ui:set-settings` or `content:save-mapping` payload is
  rejected with a code (`EBADPROFILE`, `EBADSETTINGS`, `EBADFIELD`) and
  nothing is stored. Settings are type- and enum-checked and clamped; a
  settings page can no longer flip `privacy.encryptionEnabled` directly; a
  page can no longer save a mapping to a field outside the catalog.
- **Assist and Smart no longer need every website.** Choosing either mode now
  requests only the applicant-tracking sites; every https site is a separate,
  explicit step. The popup's "Turn on for this site" requests just the current
  origin. The content script is registered for exactly what Chrome reports as
  granted, and Settings → Permissions lists each granted site with a Revoke
  button that unregisters it at once. No manifest change.
- **Exports can be protected with a passphrase.** The export is sealed with
  the vault's scheme (PBKDF2-SHA256, 600k iterations, AES-256-GCM) in a
  versioned envelope whose header is authenticated too; import recognises it
  and asks for the passphrase. A wrong passphrase or an edited file is refused.
- **Imports are reviewed before anything is saved.** A new review screen lists
  profiles, learned fields by site, and each settings change as old → new, with
  checkboxes. Settings and learned fields start unticked, so a crafted file can
  no longer switch on overwriting or change the autofill mode by itself.
- **Imported learned fields are never pre-ticked.** They carry an "imported"
  chip and are proposed at review confidence until you choose one again on a
  real form. Previously they were treated like fields you taught (0.99
  confidence, pre-ticked) on any site the file named.
- **Application history is encrypted with the vault.** Where you applied was
  stored in plaintext even with encryption on. Records are now encrypted like
  profiles (only the date stays outside, for retention), re-keyed with the
  passphrase, and shown as "locked" rather than empty while locked. A fill that
  finishes while locked is not recorded. Imported history is encrypted too; it
  used to be written straight to the database.
- History has a retention setting (6, 12 or 24 months, or until cleared) and a
  hard cap of 2,000 entries.

### Fixed

- **A click in the drafting panel is no longer swallowed.** The job match and
  the progress of earlier steps are fetched after the plan is shown, and
  applying them rebuilt the whole review list. When that round-trip finished
  while a row's drafting or saved-answer panel was open, the control the user
  was reaching for was replaced underneath them and their click did nothing.
  Late page information now waits for the next redraw whenever a row panel is
  open.
- **Re-importing a resume no longer deletes entries you edited.** "Replace
  with the resume version" swapped whole list sections, so an education,
  experience, project, skill, certification, achievement or language entry you
  had edited by hand was overwritten or dropped, although the screen promised
  it was kept. Lists are now merged entry by entry on a normalised key
  (e.g. company + title + start date for a role): your entries are never
  changed or removed, matched resume entries keep their ids, and entries no
  longer on the resume are kept and flagged.
- **"Keep what I have, fill the gaps" now adds new entries.** A new
  internship on an updated resume used to be ignored once the list had
  anything in it.
- The import review lists each entry as added, updated, kept (yours) or no
  longer on the resume, with a checkbox for every change.
- **"Verified" now means the page holds your value.** A write used to pass
  when the first six characters matched or the page kept only a prefix, so
  one LinkedIn URL "verified" as another and a cut-off email passed. Values
  are now compared by kind (email, URL, phone, number, date, text); only an
  input mask's reformatting is tolerated.
- **Truncation is a failure.** A field that cuts your value reports "this
  field accepts N characters, so your value was cut" and is put back as it
  was. A value longer than a field's `maxlength` is moved to review before
  anything is written.
- **Undo names what it could not restore.** A custom dropdown that had no
  selection before the fill cannot be emptied from outside; undo now lists it
  in the panel instead of silently counting it.
- **"Current CTC" no longer gets your expected salary.** Current pay is now
  its own field (`sensitive.currentSalary`), answered only from the current
  salary you saved in Preferences and only with salary answers switched on.
  "Expected" labels never match it and "current / present / last drawn /
  existing" labels never match the expected figure; a label asking about both
  is left for you. Pay is never converted: if the question asks for lakhs,
  per month or per year and your saved figure says something else (or no
  unit), the field is declined with the reason. Number inputs get the bare
  number, without currency symbols or separators.
- **Labels inside shadow roots.** `aria-labelledby`, `aria-describedby` and
  `label[for]` ids are now resolved in the control's own tree (its shadow root)
  instead of the document, which cannot see in. A document id can no longer
  label a field inside a shadow root. A shadow-DOM control with no label of its
  own falls back to its host element's `aria-label`, `label` attribute or
  `<label for>` — where form-associated custom elements put it.
- **Whole-phrase matching checks every occurrence.** "username or first name"
  now contains "name"; only the first hit used to be tested.
- **Years of experience is no longer inflated.** Overlapping roles are merged
  before summing, the total is whole years completed (never rounded up), and
  under one year goes to review instead of writing an invented "1".
- Two-column (sidebar) PDF resumes are read column by column. A per-page gutter
  is found from a histogram of text extents; the header above the columns is
  read first. Single-column pages, including right-aligned date columns, are
  read exactly as before.
- Profile links that exist only as clickable words are now found: PDF link
  annotations and DOCX hyperlink relationships (`http(s)` only) are passed to
  the link matcher.
- DOCX text boxes are no longer read twice (`mc:Fallback` is skipped).
- Names with non-ASCII letters ("José Álvarez") or initials ("S. R. Jeevan")
  are recognised.
- **Profiles written by an older release load.** Stored records are migrated
  and rebuilt against the current schema on read (ids and provenance kept),
  so a field added later is empty rather than undefined in the editor.
- IndexedDB now has a versioned upgrade path (database version 2 repairs
  missing stores or indexes), tested by upgrading a real v1 database.

### Added

- **"Show me" on every review row** scrolls to the field on the page and
  outlines it for a moment, so you can see which field a row means.
- **Custom fields and saved answers are used.** The "Set what this is"
  picker offers "One of your custom fields…" and "One of your saved
  answers…"; the choice is remembered for that site like any correction.
  Written-question rows offer "Use a saved answer": titles ranked by how well
  they match the question, none pre-selected, and the chosen answer is shown
  for editing before anything is written.
- **Month and year asked separately.** "Start month" / "Start year" selects
  and MM / YYYY inputs (Workday, Greenhouse) are filled for education and
  experience entries. Month options are matched by name, abbreviation or
  number; a stored year with no month leaves the month empty. The bare labels
  only count inside an education or experience block, so a lone "Start Month"
  elsewhere is left alone.
- **Phone country code and national number.** A "Country code" select gets
  "+91" (matched by the dialling code in its options; countries that share a
  code are told apart by your saved country, or not at all) and the phone
  field beside it gets the number without the code. Both are derived only when
  your saved phone is written "+CC …"; otherwise they are left for you.
- **"I currently work here"** is ticked for a current role, and that role's end
  date, month and year are left empty.
- **Location per entry**: "Location" inside an education or experience block
  is that entry's location, not yours.
- **Dependent dropdowns.** After a fill, a select whose options changed — a
  State list that loads once Country is chosen — is read again, and the panel
  offers "N more fields can be filled now". Nothing is filled until you review
  them and press Fill.
- All of the above are in the "What is this field?" picker.
- **Forms in German, French, Spanish, Portuguese, Dutch and Italian.** Locale
  vocabulary packs (`src/field-detection/locales.ts`) are merged into the
  field rules under the English rules' negative discipline: every locale rule
  inherits the English `not` list for its field. The control's `lang`
  attribute (nearest ancestor) picks the pack; with no supported language,
  every pack applies except words that are also English ("Note", "Handy",
  "Via"), which need the page to declare the language.
- **Safety vocabulary in every language, whatever the page declares.** Each
  sensitive category (gender, ethnicity, disability, veteran, criminal record,
  work authorisation, sponsorship, visa/nationality, clearance, relocation,
  travel, drug test, background check), date of birth and salary are
  recognised in all six languages even on a page that says it is English. The
  third-party words (referee, emergency contact, manager…) and company words
  are recognised in every language too, as are "confirm your email" boxes.
- Yes/No options in each language (Ja/Nein, Oui/Non, Sí/No, Sim/Não, Ja/Nee,
  Sì/No), and localised month and country names for dropdown matching.
- `test-pages/i18n/<lang>.html` per pack, with a Chrome test each, and
  `tests/i18n.test.ts` with the phrasings that must and must not match.
- **History is a tracker.** Each entry takes a status (applied, assessment,
  interview, offer, rejected, withdrawn), notes, a follow-up date and the
  profile used. A posting link is kept only when ticked for that entry, as
  origin + path with no query string.
- **CSV export** of history, saved locally, with formula-injection protection.
- **On-device drafting no longer dead-ends at "needs a download".** Writing
  assistance has a "Download the on-device model" button with progress, and a
  separate "downloading" state.
- **Drafts stream** into the panel, can be cancelled at any time, stop after
  60 seconds, and are held to the field's character limit while streaming.
- **Optional context:** an excerpt of the job posting (fenced as untrusted page
  text) and your saved answers can be ticked, both off by default.
- Sessions declare expected input and output languages (English), following
  the current Prompt API. `npm run probe:ai` reports the state the options page
  would show.

### Changed

- **Every switch in Settings now does something.** The on-page panel follows
  the Theme and Reduce motion settings (motion is reduced when either the
  setting or the system asks). "Show the on-page prompt in Assist and Smart"
  now has a control. Removed with a settings migration to version 3, because
  nothing read them: "Fill empty fields only" (the overwrite switch is what
  decides), "Show a preview before filling" (the panel always previews),
  `ai.assistFieldMapping` and `privacy.encryptionEnabled`.
- **Learned fields count their uses.** After a fill, the content script sends
  the ids of remembered rules it wrote — ids only — and the worker counts only
  active rules saved for that site.
- `npm run check` runs `scripts/check-settings.mjs`, which fails on a default
  setting that nothing outside `src/types` and `src/options` reads.
- **The review list keeps your place.** Ticking a box, opening "Why?" or
  "Change" no longer sends focus to the Fill button and the list back to the
  top: rows are keyed by field, and focus and scroll position survive every
  redraw.
- **Edit for this form.** A proposed value can be changed in its row. The
  value is marked "your edit", is used for this fill only, and lives only in
  the tab — your profile is not changed.
- **"Add it in your profile"** on rows whose value is missing opens the
  profile editor focused on that field.
- Rows are grouped by section, each with select all / none, and the list can
  be filtered by status.
- "Graduation year" is no longer rewritten to "graduation date", so a year
  field gets "2026" rather than "May 2026".
- A field with `autocomplete="tel-national"` now gets the number without its
  country code (it used to get the whole stored phone).
- The form-change signature now counts dropdown options, and an added
  `<option>` counts as a possible form change.
- **Unicode-aware label normalisation.** Labels are NFKD-folded and
  diacritics stripped, keeping every letter and digit: "Prénom" is now
  "prenom" (it was "pr nom"), "Straße" is "strasse", and non-Latin labels
  are no longer erased. Dropdown option text is folded the same way.
  A mapping you taught Fillwright on a label with accents is keyed on the
  new form, so it may need teaching once more.

### Docs

- PRIVACY.md names the current version; CONTRIBUTING.md lists the audit and
  settings steps of `npm run check`; README's known limitations are numbered
  in order; the ESLint `fetch` message no longer points at a file that does
  not exist.

### Testing

- **Accuracy is measured, not guessed.** `npm run eval` scores the field
  classifier on 372 labelled fields and the resume parser on 27 invented
  resumes across seven layouts, printing per-field precision, recall and a
  confusion list. CI fails when any number drops below the committed
  `tests/corpus/baseline.json`. Starting point: 90.3% classifier accuracy;
  the weakest areas are start/end dates inside repeated blocks, postal codes
  named only in attributes, and parser recall for names and employers on
  surname-first, Europass and no-heading layouts.
- Coverage thresholds (`npm run test:coverage`, `@vitest/coverage-v8`) for
  `src/autofill`, `src/field-detection`, `src/security` and `src/parser`, run
  in CI.
- fast-check property tests: `validateScan`, `conformProfile`,
  `normalizeLabel` and `matchOption` never throw and return bounded output.
- New dev-only dependencies: `@vitest/coverage-v8`, `fast-check`. Nothing
  shipped changes.
- New hostile fixture `test-pages/clickjack.html` and Chrome case: a synthetic
  click and a click through a pointer-events:none overlay both leave the form
  untouched; a normal click after the arming delay fills it.
- The end-to-end harness now drives the panel with real (trusted) input
  (`trustedClick`), since `element.click()` from page script is ignored.

### Release and CI

- The content-script size budget (`npm run perf`) is raised from 100 KB to
  128 KB. The 0.6.0 features that run on the page (six locale packs, the
  country table, the click-jacking guard, saved answers, the review list's
  groups, filter and editor) bring the minified script to about 121 KB.
  Injection and scan timings are unchanged and within budget.
- **Reproducible store package.** `scripts/package.mjs` now sorts zip entries,
  stamps every entry with one timestamp from `SOURCE_DATE_EPOCH` or the last
  commit (in UTC, never the wall clock), uses fixed deflate settings, prints
  the SHA-256 and writes `SHA256SUMS`. Two builds of one commit are identical.
- **Releases are built by CI.** `release.yml` runs on a `v*` tag: `npm ci`,
  check, end-to-end, packages twice and fails unless the hashes match, then
  publishes the zip, `SHA256SUMS` and a build provenance attestation.
- **Tighter CI.** Read-only token permissions, actions pinned by commit SHA, a
  concurrency group, a Windows job running `npm run check`, Dependabot for npm
  and GitHub Actions, and CodeQL for JavaScript/TypeScript.
- README: "Verify the store package yourself".


## 0.5.0

From feature-complete to shippable: verified in a real browser against
real-world ATS layouts, with error recovery, accessibility, performance
budgets and Web Store material.

### Security

- **Disguised controls are never pressed.** A page could mark a real submit
  button or link as a dropdown (`role="combobox"`), an option or a radio, and
  Fillwright would press it. Every press now goes through one guard that
  refuses links, submit/reset/image inputs, `formaction` and form-submitting
  `<button>`s, whatever role they claim. The dropdown case existed in 0.4.0.
- **Searchable dropdowns see a short prefix, not your value.** The whole
  profile value used to be typed into the site's search box. Now nothing is
  typed when options are already listed, and otherwise 3–6 characters, cleared
  again if nothing matched.
- **Thrown errors no longer reach the user or the logs verbatim.**
- A plan read while the vault was open is no longer written after it locks.
- The unused optional `tabs` permission is gone, and the content script no
  longer has a message listener (nothing sent it anything).
- `npm run audit` gates `npm run check` and CI; the dev toolchain moved to
  Vite 8, Vitest 5 and Puppeteer 25 to clear high/critical advisories (all in
  tooling, none shipped).

### Fixed

- Application history was never recorded, even when switched on.
- Wrappers repeated once per field (Greenhouse `div.field`, Lever
  `li.application-question`) were read as numbered blocks, so "Degree" came
  from education entry 2 and "Current company" from entry 5.
- Generated ids like `school-7` were read as block positions.
- "How many years of experience do you have with Python?" was answered with
  total years of experience.
- Dropdown matching used raw substrings: "Indiana" matched "India".
- Lever's labels (sibling divs) were not read; a lone "Name" on an email form
  stayed in review; "Preferred work setting" was not recognised.
- Button-based radio groups (Ashby) were invisible.
- A same-origin iframe form showed an extra empty panel; a cross-origin one
  said "no fields" instead of explaining.
- A form that rejected every value listed each failure and offered a retry
  that could not work.
- 43 options/popup paths ignored failures, showed raw errors or could spin
  forever.
- The popup on `chrome://`, the Web Store, `file://` or a PDF only failed after
  a click.
- The shortcut-free passive modes only registered for https, so localhost forms
  could not use them.
- Dark and light secondary text failed WCAG contrast; the resume file input was
  unlabelled; the panel re-announced its tally on every redraw; reduced motion
  only slowed spinners; Tab could leave the open panel.
- `content.js` had grown to 106 KB; the MutationObserver callback took ~10 ms on
  a large DOM burst.
- Onboarding always restarted at step 1.

### Added

- **Real-browser coverage** for Assist/Smart, add-another, one-off and
  remembered corrections, mapping management, SPA navigation, panel dragging and
  focus, import/export, multi-fill undo, drafting (fact picker first, no contact
  or sensitive facts), error recovery, ATS layouts, hostile markup,
  accessibility (axe-core, light and dark), onboarding and the editor.
  96 end-to-end tests, 326 unit tests.
- **ATS fixtures** for Greenhouse, Lever, Workday, Ashby, iCIMS/SmartRecruiters
  and LinkedIn Easy Apply.
- **Dropdowns:** async lists that load while typing, virtualised lists,
  multi-select (additive only), and aliases for countries, degrees and months.
- **Error recovery:** one error vocabulary (`src/utils/errors.ts`), each message
  with one next step; worker retry; quota and frame messages.
- **Performance budget** (`npm run perf`): bundle 92.4 → 82 KB, injection 32 →
  22 ms, observer callback 9.8 → < 0.01 ms (Chrome for Testing 131).
- **Onboarding:** five resumable steps with inline import, a practice form
  filled by the real engine, and privacy facts read from the running extension.
- **Profile editor:** inline email/URL/phone checks, a leave guard for failed
  saves, Alt+↑/↓ reordering, bulk skill paste, "What autofill will see", and
  "last used" (history on only).
- **Web Store:** `store/` listing, permission justifications, privacy-practices
  declaration, screenshots and checklist; `npm run presubmit` and
  `npm run screenshots`.
- `npm run probe:ai`: Chrome for Testing 153 exposes `LanguageModel` in the
  worker and extension pages (not web pages); 131 exposes nothing.

## 0.4.0

A product pass over the on-page experience, plus three security fixes.

### Security

- **The on-page panel now uses a closed shadow root.** With an open root, any
  script on the application page could read the preview — proposed values and
  sensitive answers — before the user approved anything. The release verifier
  now fails on an open root.
- **Content scripts can no longer call profile-level messages.** The router
  accepted `ui:export-data`, `ui:get-profile` and friends from any sender. They
  are now limited to Fillwright's own pages.
- **The Workday adapter no longer presses "Add" on every scan.** Each rescan
  created another empty entry block.

### Fixed

- **`Alt+Shift+F` did nothing.** The shortcut handler messaged the service
  worker from inside the service worker, which Chrome never delivers.
- A field that disappeared between scan and fill (a new step) is now reported,
  not silently "filled".

### Added

- Panel rebuilt as an explicit state machine (detected, analysing, ready,
  review, filling, success, partial, error, locked, undo), draggable, keyboard
  movable, `Esc` to minimise, screen-reader announcements.
- Autofill modes: Manual (default), Assist and Smart, with optional site access
  and local "is this an application?" scoring.
- SPA and multi-step awareness: route changes and new fields trigger a quiet
  rescan, never while typing and never under an open review list; per-step
  progress kept in session storage.
- Any mapping can be changed; corrections can apply to this form only.
- Remembered corrections can be retargeted, paused, inspected and reset.
- "Add another entry" offers for forms with fewer blocks than the profile.
- Job-posting skill comparison (present / not in profile).
- On-device answer drafting in the panel: choose facts, generate, edit, use.
- Profile switcher in the popup and the panel.
- History sort; export with optional history and a sensitivity warning;
  validated import.

## 0.3.1

Fixes a bug that made importing a PDF resume appear to hang forever.

### Fixed

- **"Saving to your profile…" never finished when importing a PDF.** pdf.js
  transfers the byte buffer it is given to its worker thread, which detaches the
  caller's `ArrayBuffer`. The import still needed those bytes to store the file,
  so the write failed with a `DataCloneError` — and because the save had no
  error boundary, the rejection vanished and the pane sat on its loading state
  indefinitely. pdf.js is now handed a copy.

  This only affected PDFs, which is why it survived 227 tests and a 47-case
  browser suite: every one of them used plain text or a `.txt` upload. Reported
  from real use.

- **An infinite spinner is no longer a possible outcome.** The save is wrapped
  end to end, and failures are explained in terms the user can act on — a
  detached file, a locked vault, exhausted storage, a restarted background
  service — each with a retry.

- **A failed file copy no longer discards the import.** If the original file
  cannot be stored, the parsed profile is still saved and the pane says the copy
  was not kept, rather than losing both.

- **Messaging can no longer hang.** `send()` now times out after 15 seconds and
  retries once when the background service was asleep. Under MV3 a worker can be
  terminated mid-request, leaving a promise that never settles; that is now a
  reported error instead of a frozen interface.

### Added

- Regression tests for the detached-buffer bug, for messaging timeouts and
  retries, and an end-to-end test that imports a genuine PDF through the Resume
  pane and asserts the file is stored.

## 0.3.0 — unreleased

### Added

- **Encrypted local vault.** Optional AES-256-GCM encryption of your profile and
  stored resume, with the key derived by PBKDF2-SHA256 at 600,000 iterations.
  Enable, unlock, lock now, change passphrase and disable, with re-encryption of
  existing records at each step. Verified end-to-end in a real browser, including
  a check that the raw IndexedDB record no longer contains the email address or
  university.
- **Auto-lock** after 5 / 15 / 30 / 60 minutes of inactivity, or never. Checked
  on access rather than by a background timer, so it needs no extra permission
  and cannot be missed by an evicted service worker.
- **Locked state everywhere.** The popup and the on-page panel show "locked" with
  an unlock action rather than an error, and nothing is filled while locked.
- **Profile readiness**: an actionable checklist replacing the bare percentage.
  Each section says what is missing and links to where it is fixed — work
  authorisation correctly points at Application preferences, not the profile.
- **AI provider abstraction** (`src/ai/provider.ts`) with live capability
  detection across the three shapes Chrome has shipped its on-device model API
  under. Off by default. No hosted provider is offered, and the Writing
  assistance page explains why in terms of the CSP guarantee.
- **Privacy Center data-flow view**: the eight steps your data actually takes,
  with the two that are yours highlighted.
- **Diagnostics mode** (Settings → Advanced): the detection signals behind each
  match, shown inline in the panel. Proposed values are masked; page-derived
  text is not, because that is the thing being diagnosed. Nothing is transmitted.
- `PRIVACY.md`, `CODE_OF_CONDUCT.md`.

### Security

- Passphrases are used to derive a key and then discarded — never stored, never
  logged, never written to disk in any form.
- A locked vault refuses writes rather than falling back to plaintext, so
  encryption cannot be silently defeated by a background save.
- `ELOCKED` is a typed result rather than a generic error, so no surface
  mistakes an expected state for a fault or logs it as one.

## 0.2.0

Validation moved from "173 jsdom tests" to "jsdom plus the real browser", and
that change immediately paid for itself.

### Added

- **End-to-end suite in real Chrome** (`npm run test:e2e`). Loads the built
  extension into Chrome for Testing and drives it as a user would: service
  worker, shadow DOM, CSP, real input events. 30 tests.
- **Repeated-section filling.** "Education #1" and "Education #2" now draw from
  different profile entries. Indices are read from the field name
  (`education[1].school`), a numbered heading, or repeated DOM structure. A block
  with no matching entry is left empty and says why, instead of duplicating.
- **Custom dropdown support** for React Select, Downshift, Radix and ARIA
  comboboxes, including menus rendered into portals. Fillwright opens the
  control, matches an option, selects it and closes it again.
- **Post-fill verification.** Every write is read back. A value the page rejects
  or rewrites is reverted and reported rather than counted as a success.
- **Partial-fill recovery.** The panel shows filled / did-not-take / left-for-you
  with per-field reasons and a one-click retry of just the failures.
- `hard-mode.html` regression page: 50+ controls, repeated blocks, three custom
  dropdowns, a field that rejects writes, aria-only labels, injected text.
- CI workflow running typecheck, lint, tests, build, verification and the
  browser suite.
- **Teach Fillwright.** When a field cannot be placed, the panel offers
  "Set what this is": pick the meaning, and the correction is stored against
  that site and reapplied on every later visit. Corrections never leave the
  device.
- **"Why?" on every review row** — the plain-English reason a value was chosen,
  plus a confidence figure on the rows that are about to be written.
- **Profiles pane.** Create, rename, duplicate, switch and delete, each card
  showing completion, resume status, entry counts and what is missing.
- **Application history pane** with grouped days, search and one-click clear.
  Still off by default and still metadata only.
- **"What Fillwright learned" pane** listing every remembered correction by
  site, with per-mapping and per-site removal.

### Fixed

- **Field mapping on flat forms.** On any form whose inputs are direct children
  of `<form>` — Greenhouse, Lever, most hand-written forms — the "text near this
  control" signal returned the entire form's text. Negative rules saw it too, so
  one unrelated "University / College" field disqualified `personal.firstName`
  across the whole page: first name, last name and the resume upload all
  collapsed onto the wrong field. Nearby text is now strictly preceding and
  adjacent, and negative rules only see the signals that identify a control.
  Found by the browser suite on its first run.
- A bare bracketed number in a field name (`answers_attributes][3]`) was read as
  a repeat index, sending ordinary Greenhouse questions looking for a fourth
  education entry. An index now only counts next to a section word.
- Selecting an option in a custom dropdown could re-open it, because the click
  bubbles to the control's own toggle. The menu is now closed explicitly.
- The widget host and the injected highlight stylesheet shared one marker
  attribute, so a lookup could land on the wrong element.
- `Location (City)` resolved to a general location rather than the city.
- A skipped field showed a confidence percentage instead of "Already filled in";
  confidence is now shown only where it changes what happens next.
- `optional_host_permissions` was https-only, so Fillwright could not work on
  locally served forms. Loopback origins added; `<all_urls>` still refused.
- Line endings normalised to LF, enforced by `.gitattributes`.

## 0.1.0

First working version: resume import (PDF/DOCX/TXT), structured profile with
provenance and confidence, profile editor, preferences with protected sensitive
branch, privacy centre, permissions page, semantic field detection, autofill with
preview and undo, nine site adapters, build verifier, 167 tests.
