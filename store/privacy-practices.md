# Privacy practices declaration — Fillwright 0.5.0

For the **Privacy practices → Data usage** section. In Chrome Web Store terms,
data is "collected" when it is transmitted off the user's device. Fillwright
processes the data below **only on the user's device** and transmits none of
it, so every category is declared **not collected**.

| Data type (Web Store category) | Collected? | What happens on the device |
|---|---|---|
| Personally identifiable information | Not collected | Name, email, phone and address from the user's resume are stored locally and written into forms the user approves. |
| Health information | Not collected | Disability status is stored only if the user enters it, and filled only after confirmation. |
| Financial and payment information | Not collected | Expected salary is stored only if the user enters it and turns salary answers on. No payment data is read. |
| Authentication information | Not collected | Password, one-time-code and card fields are skipped and never read. The optional vault passphrase is used to derive a key and is not stored. |
| Personal communications | Not collected | — |
| Location | Not collected | The user's own address, if present in their resume or profile, stays local. No device location is requested. |
| Web history | Not collected | Fillwright does not read browsing history. The optional application history (off by default) stores company, role, site and date locally. |
| User activity | Not collected | No analytics, telemetry, click or keystroke recording. Typing is observed only as a timestamp, to avoid rescanning while the user types. |
| Website content | Not collected | Form labels and job-posting text on the current page are read locally to match fields and skills; nothing is stored or sent. |

## Certifications (check all three)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

Publish `PRIVACY.md` (for example via the repository's GitHub page) and use that URL.
