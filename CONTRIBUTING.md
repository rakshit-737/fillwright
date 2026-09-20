# Contributing to Fillwright

Thanks for taking a look. Fillwright handles people's resumes, so the bar for
changes is higher than for a typical extension — this explains where that bar
sits.

## Getting set up

```bash
npm install
npm run build          # writes dist/
npm run check          # typecheck → lint → audit → check:settings → test → build → verify
npm run test:e2e       # the real-browser suite
```

Load `dist/` as an unpacked extension at `chrome://extensions`.

## The rules that are not up for negotiation

These are enforced by code and by `scripts/verify-build.mjs`. A pull request that
weakens one will not be merged, however convenient it is:

1. **Nothing is submitted automatically.** No code path clicks a submit or apply
   control, and adapters refuse anything that reads as one.
2. **No outbound network access in the core product.** The CSP pins
   `connect-src 'self'`. This is what makes "stays on your device" checkable
   rather than a promise.
3. **No `<all_urls>`, no empty-by-default host permissions.**
4. **No remotely hosted code**, and no `eval` / `new Function`.
5. **Webpage content is data, never instructions.** There is no interpreter for
   page text — only a matcher against a compiled-in vocabulary.
6. **Sensitive answers come only from explicit user input.** The resume parser
   is structurally prevented from writing to `profile.sensitive`.
7. **The user's own typing is never overwritten** without them turning that on.
8. **No `innerHTML` anywhere a page-supplied string could reach.**

## What good looks like here

- **Prefer fixing the existing architecture** to adding a parallel one. There is
  one profile model, one storage layer, one message protocol, one classifier and
  one autofill engine, and it should stay that way.
- **A heuristic that is unsure should decline.** A wrong value on a job
  application is worse than a blank one, because the user may not notice it.
  "Refuses to guess" is a feature; several tests assert the refusals.
- **Explain the value.** Every mapping carries a plain-English reason that is
  shown to the user. New mappings need one too.
- **Comments explain *why*.** What the code does is visible; why it is written
  that way — usually a real form that broke the obvious approach — is not.

## Testing

- Unit and integration tests under `tests/`, run by Vitest in jsdom.
- The browser suite under `tests/e2e/`, run against Chrome for Testing.

**jsdom is not a browser.** Anything touching the DOM, the extension runtime, or
the CSP needs a test in the browser suite as well. The one release cycle that
relied on jsdom alone shipped a field-mapping bug affecting the most common form
layout there is; `tests/context-isolation.test.ts` exists because of it.

When adding a field rule, add a case to `tests/classify.test.ts` — including the
wordings it should *not* match. Add awkward markup to `test-pages/hard-mode.html`
with a note saying what should happen.

### Measuring accuracy: run `npm run eval` for any rule change

A rule that fixes one form can quietly break three others. **Any change to the
classifier (`src/field-detection/`), the option matcher or the resume parser
(`src/parser/`) must be checked with `npm run eval`**, which scores it against
an invented corpus and prints per-field precision, recall and a confusion list:

- `tests/corpus/fields.json` — labelled `FieldSignals` (ATS fixture labels plus
  real-world phrasings), each with its expected canonical field or `unknown`.
- `tests/corpus/resumes/` — resumes in many layouts (single column, LaTeX,
  two-column, Europass, Indian campus format, no headings, surname first), each
  `NN-name.txt` next to `NN-name.expected.json`.

CI fails if any metric falls below `tests/corpus/baseline.json`. When your
change improves a number, run `npm run eval -- --update-baseline` and commit
the new baseline with the change so the gain cannot silently be lost. Never
lower the baseline to get a change through; if a trade-off is deliberate, say
so in the PR. Add a corpus case for the form you are fixing. All corpus data
must be invented — never paste a real person's resume or a real form's hidden
field names that identify an employer's internal systems.

`npm run test:coverage` runs the unit tests with coverage thresholds for
`src/autofill`, `src/field-detection`, `src/security` and `src/parser` (set in
`vitest.config.ts`); CI runs it too. `tests/properties.test.ts` holds
fast-check property tests for the untrusted-input boundaries.

## Reporting a security issue

Please open a private security advisory rather than a public issue. See
[SECURITY.md](./SECURITY.md).
