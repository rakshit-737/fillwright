# Changelog

Notable changes, newest first. Versions follow semantic versioning.

## Unreleased

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

### Fixed

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
