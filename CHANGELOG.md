# Changelog

Notable changes, newest first. Versions follow semantic versioning.

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
