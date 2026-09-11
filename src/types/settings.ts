/** Lightweight, non-sensitive settings. Stored in chrome.storage.local. */

export interface Settings {
  /** Profile currently used for autofill. */
  activeProfileId: string | null;
  onboardingCompleted: boolean;

  autofill: {
    /** Never overwrite a field the user already typed into. Default: true. */
    fillEmptyFieldsOnly: boolean;
    /** Explicit opt-in to clobber existing values. Default: false. */
    allowOverwrite: boolean;
    /** Below this, a mapping is shown as "review required" instead of filled. */
    confidenceThreshold: number;
    /** Show the fill preview before touching the page. Default: true. */
    previewBeforeFill: boolean;
    /** Briefly outline fields Fillwright changed. */
    highlightFilledFields: boolean;
    /** Offer to scan automatically on pages that look like applications. */
    autoDetectOnKnownSites: boolean;
  };

  privacy: {
    /** Record company/role/date/url only. Default: false. */
    keepApplicationHistory: boolean;
    /** Encrypt the profile store with a user passphrase. */
    encryptionEnabled: boolean;
    /** Wipe decrypted data from memory after N minutes of inactivity. */
    autoLockMinutes: number;
  };

  ai: {
    /** Master switch. Default: false — core autofill never needs this. */
    enabled: boolean;
    /**
     * 'chrome-builtin' runs Chrome's on-device model; nothing leaves the machine.
     * External providers are intentionally unimplemented: the extension CSP
     * blocks outbound connections. See SECURITY.md.
     */
    provider: 'none' | 'chrome-builtin';
    /** Let the model help classify fields we could not match deterministically. */
    assistFieldMapping: boolean;
    /** Let the model draft answers to open-ended essay questions. */
    assistAnswerDrafting: boolean;
  };

  ui: {
    theme: 'system' | 'light' | 'dark';
    reducedMotion: boolean;
    showFloatingWidget: boolean;
  };

  advanced: {
    /**
     * Shows the signals behind each match in the on-page panel. For debugging
     * a form that maps badly. Values are masked; page-derived text is not,
     * because that is the thing being diagnosed.
     */
    diagnostics: boolean;
  };

  version: number;
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  activeProfileId: null,
  onboardingCompleted: false,
  autofill: {
    fillEmptyFieldsOnly: true,
    allowOverwrite: false,
    confidenceThreshold: 0.7,
    previewBeforeFill: true,
    highlightFilledFields: true,
    autoDetectOnKnownSites: false,
  },
  privacy: {
    keepApplicationHistory: false,
    encryptionEnabled: false,
    autoLockMinutes: 30,
  },
  ai: {
    enabled: false,
    provider: 'none',
    assistFieldMapping: false,
    assistAnswerDrafting: false,
  },
  ui: {
    theme: 'system',
    reducedMotion: false,
    showFloatingWidget: true,
  },
  advanced: {
    diagnostics: false,
  },
  version: SETTINGS_VERSION,
};
