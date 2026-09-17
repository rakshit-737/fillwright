# Permission justifications — Fillwright 0.5.0

Paste-ready answers for the **Privacy practices → Permission justification**
fields. Each matches a line in `public/manifest.json`; nothing else is
requested.

## storage

Stores the user's settings (for example, whether to fill only empty fields) and which of their profiles is active, in chrome.storage.local. While the optional encryption is unlocked, the derived key is held in chrome.storage.session (memory only). Profile data itself is kept in the extension's IndexedDB on the user's device. Nothing is synced or sent anywhere.

## scripting

Injects the extension's own bundled script (content.js) into the tab the user activated — by clicking the toolbar button or pressing the keyboard shortcut — so it can read that page's form fields and fill the values the user approves. In the optional Assist and Smart modes, the same bundled script is registered with chrome.scripting.registerContentScripts for the https pages the user granted access to. No remote or generated code is ever executed.

## activeTab

Gives the extension access to the current tab only when the user clicks the toolbar button or presses the keyboard shortcut. This is the default way Fillwright works: it has no access to any page until the user asks it to fill that page.

## Host permission (optional): https://*/*

Requested only when the user turns on Assist or Smart mode in settings, and only through Chrome's permission prompt. It lets Fillwright notice, on its own, that a page is a job application and offer help, instead of waiting for a click. The check runs locally, the extension never fills or submits anything without the user's approval, and turning the mode off or revoking the permission removes access immediately.

## Host permissions (optional): http://localhost/*, http://127.0.0.1/*

Optional, never requested by default. Lets a developer use Assist or Smart mode on application forms served from their own computer while building or testing them.

## Remote code

No. All JavaScript is packaged in the extension. The extension pages' Content Security Policy is `script-src 'self'; object-src 'self'; connect-src 'self'`, which also prevents them from making network requests.
