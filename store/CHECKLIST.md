# Chrome Web Store — pre-submission checklist

Run these in order before uploading `release/fillwright-<version>.zip`.

## Automated

1. `npm run presubmit` — builds the zip through `npm run package`, which runs
   typecheck, lint, the dependency audit, unit tests, build and the build
   verifier first. It then opens the zip and fails on:
   - a permission, optional host or CSP that differs from the approved set;
   - `host_permissions`, `web_accessible_resources` or `externally_connectable`;
   - source maps, test fixtures, the perf probe or any test-only marker;
   - an open shadow root (the test build's panel);
   - remote scripts, stylesheets, dynamic imports or fetches;
   - `eval` / `new Function` outside pdf.js (pdf.js runs with
     `isEvalSupported: false`, and the CSP blocks eval anyway);
   - `content.js` over 100 KB, or a package over 10 MB.
2. `npm run test:e2e` — the real-browser suite (96 tests).
3. `npm run perf` — the performance budget.
4. `npm run screenshots` — regenerates `store/screenshots/*.png` (1280×800).

## Manual

- [ ] Version bumped in `package.json` and `public/manifest.json`, and
      `CHANGELOG.md` has an entry for it.
- [ ] Load `dist/` unpacked in a current stable Chrome and fill one real
      application by hand (the automated suite uses local fixtures).
- [ ] Store listing text matches `store/listing.md`.
- [ ] Permission justifications match `store/permissions.md`, and the
      manifest still lists exactly those permissions.
- [ ] Privacy practices form matches `store/privacy-practices.md`; the privacy
      policy URL points at the published `PRIVACY.md`.
- [ ] Screenshots show only the fictional "Alex Example" profile and the
      "Example Corp" demo page.
- [ ] Icons: 128×128 store icon is `public/icons/icon-128.png`.
- [ ] Upload the zip, not the `dist/` folder, and not `dist-e2e/`.
