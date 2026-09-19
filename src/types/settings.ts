/** Lightweight, non-sensitive settings. Stored in chrome.storage.local. */

export type AutofillMode = 'manual' | 'assist' | 'smart';

export const AUTOFILL_MODES: readonly AutofillMode[] = ['manual', 'assist', 'smart'];

export interface Settings {
  /** Profile currently used for autofill. */
  activeProfileId: string | null;
  onboardingCompleted: boolean;
  /** Where the user left onboarding, so it resumes if the tab was closed. */
  onboardingStep: number;
  /** Set once the practice form has been filled. */
  onboardingTriedFill: boolean;

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
    /**
     * How proactive Fillwright is on pages it was not explicitly invoked on.
     *
     *  - manual: only when the user clicks the toolbar button or presses the
     *    shortcut. Needs no site access. The default.
     *  - assist: offers a small prompt on pages that clearly are applications.
     *  - smart: also prepares the plan in advance, so counts are ready when
     *    the user opens the panel.
     *
     * No mode fills without confirmation, and no mode ever submits.
     */
    mode: AutofillMode;
  };

  privacy: {
    /** Record company/role/date/url only. Default: false. */
    keepApplicationHistory: boolean;
    /** Months of history to keep: 6, 12 or 24; 0 keeps it until you clear it. */
    historyRetentionMonths: number;
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

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  activeProfileId: null,
  onboardingCompleted: false,
  onboardingStep: 0,
  onboardingTriedFill: false,
  autofill: {
    fillEmptyFieldsOnly: true,
    allowOverwrite: false,
    confidenceThreshold: 0.7,
    previewBeforeFill: true,
    highlightFilledFields: true,
    mode: 'manual',
  },
  privacy: {
    keepApplicationHistory: false,
    historyRetentionMonths: 0,
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
