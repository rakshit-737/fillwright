# Privacy Policy

**Fillwright does not collect, transmit, store on any server, sell, or share any
personal information.**

That is the entire policy. The rest of this document explains how that is true
architecturally, so you do not have to take it on trust.

_Last updated: 2026-09-19. Applies to Fillwright 0.5.0 and later._

---

## 1. What Fillwright stores, and where

Everything is stored locally in your own browser profile, using two standard
browser storage mechanisms:

| What | Where | Contains |
|---|---|---|
| Your profile(s) | IndexedDB (`fillwright`) | Everything from your resume: name, contact details, education, experience, projects, skills, plus any preferences you set |
| Your resume file | IndexedDB (`fillwright`) | The original file bytes and its extracted text |
| Remembered field mappings | IndexedDB (`fillwright`) | "On this site, the field labelled X means Y" — corrections you made |
| Application history | IndexedDB (`fillwright`) | **Off by default.** Company, role, site, date, and how many fields were filled. Never what you typed |
| Settings | `chrome.storage.local` | Your preferences and which profile is active |
| Vault key, while unlocked | `chrome.storage.session` | Memory-only, never written to disk, cleared when the browser closes |

If you turn on encryption (Options → Security), your profile and resume are
stored as AES-256-GCM ciphertext with a key derived from your passphrase.

## 2. What Fillwright sends

Nothing.

This is enforced by the extension's Content Security Policy, which pins
`connect-src` to `'self'`. The browser refuses any outbound network request from
the extension, so this holds even if a future bug tried to make one. You can
verify it yourself in `public/manifest.json`, and the automated test suite
asserts it in a real browser on every run.

Specifically, there is:

- **No analytics.** No page views, no events, no usage counters.
- **No telemetry or crash reporting.**
- **No remote configuration**, and no remotely loaded code of any kind.
- **No account.** There is nothing to sign up for and no identifier to link.
- **No record of where you apply** leaving your machine.

## 3. What Fillwright can see

By default, nothing at all until you invoke it. Fillwright does not request
`<all_urls>` and does not run a content script on every page. It can read a page
only after you click its toolbar button or press its keyboard shortcut, and only
on that tab.

If you enable automatic detection, Chrome will ask you to approve specific
sites. You can withdraw that at any time from `chrome://extensions`.

Fillwright never reads, stores, or fills:

- password fields
- one-time codes
- card numbers or CVVs
- national insurance / social security numbers

These are excluded before a page is even analysed.

## 4. Sensitive categories

Work authorisation, visa status, gender, race and ethnicity, disability status,
veteran status, criminal history and salary are **never** derived from your
resume — not from your name, your university, or your location. They can only
ever come from answers you type yourself under Application preferences, and most
are off until you switch them on.

An unanswered question stays unanswered. Fillwright will leave it blank rather
than infer one.

## 5. Optional AI

Off by default. If enabled, Fillwright can draft answers to open-ended
application questions using **Chrome's on-device model**, which runs locally on
your computer. No hosted or third-party model is offered, because using one
would require removing the network restriction described in §2.

Fillwright shows you which facts a draft would use before generating anything,
and never places a generated answer into a form without your approval.

## 6. Your control

- **See everything**: Options → Privacy Center lists exactly what is stored.
- **Export**: a local JSON download. It is not uploaded anywhere.
- **Delete selectively**: individual profiles, history, or learned mappings.
- **Delete everything**: Options → Privacy Center → Erase all Fillwright data.
  This drops the database and clears all settings. It cannot be undone, and
  there is no copy anywhere else.
- **Uninstalling** removes all of it too.

## 7. Children

Fillwright is intended for people old enough to be applying for work. It does
not knowingly handle data from children.

## 8. Changes

Any change to what is stored or what is transmitted will be recorded in
[CHANGELOG.md](./CHANGELOG.md) and reflected here. Because there is no server,
a policy change cannot be applied retroactively to data already on your device.

## 9. Contact

Open an issue on the repository. For a security concern, open a private security
advisory instead — see [SECURITY.md](./SECURITY.md).
