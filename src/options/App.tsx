import { useEffect, useState } from 'react';
import { LoadError } from '@/components/LoadError';
import { useHashRoute } from './useHashRoute';
import { PrivacyCenter } from './panes/PrivacyCenter';
import { Permissions } from './panes/Permissions';
import { SettingsPane } from './panes/SettingsPane';
import { ImportResume } from './panes/ImportResume';
import { ProfileEditor } from './panes/ProfileEditor';
import { Preferences } from './panes/Preferences';
import { Welcome } from './panes/Welcome';
import { Profiles } from './panes/Profiles';
import { History } from './panes/History';
import { SavedMappings } from './panes/SavedMappings';
import { Security } from './panes/Security';
import { Assistance } from './panes/Assistance';
import { send } from '@/utils/messaging';
import type { Settings } from '@/types/settings';

const NAV: Array<{ id: string; label: string; group: string }> = [
  { id: 'profile', label: 'Profile', group: 'Your data' },
  { id: 'import', label: 'Resume', group: 'Your data' },
  { id: 'preferences', label: 'Application preferences', group: 'Your data' },
  { id: 'profiles', label: 'Profiles', group: 'Your data' },
  { id: 'history', label: 'Application history', group: 'Activity' },
  { id: 'learned', label: 'What Fillwright learned', group: 'Activity' },
  { id: 'privacy', label: 'Privacy Center', group: 'Privacy & security' },
  { id: 'security', label: 'Security', group: 'Privacy & security' },
  { id: 'permissions', label: 'Permissions', group: 'Privacy & security' },
  { id: 'settings', label: 'Settings', group: 'Privacy & security' },
  { id: 'assistance', label: 'Writing assistance', group: 'Optional' },
];

export function App() {
  const [route, navigate] = useHashRoute('profile');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void send<Settings>({ type: 'ui:get-settings' }).then((result) => {
      if (result.ok) {
        setSettings(result.data);
        setLoadError('');
      } else {
        setLoadError(result.error);
      }
    });
  }, [attempt]);

  // Settings change in other tabs too (the practice form marks onboarding
  // progress); follow them so every pane stays current.
  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.settings) setAttempt((n) => n + 1);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // Opening Fillwright's settings with no particular page resumes unfinished
  // setup. A deep link (#/profile, #/security) is always honoured.
  const [openedBare] = useState(() => location.hash.replace(/^#\/?/, '') === '');
  useEffect(() => {
    if (openedBare && settings && !settings.onboardingCompleted && route !== 'welcome') {
      navigate('welcome');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedBare, settings?.onboardingCompleted]);

  // Honour the user's theme choice on the options page chrome itself.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.ui.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.ui.theme);
    root.setAttribute('data-reduced-motion', String(settings.ui.reducedMotion));
  }, [settings]);

  const groups = Array.from(new Set(NAV.map((item) => item.group)));

  // Onboarding takes over the whole page: there is nothing useful to navigate
  // to until a profile exists.
  if (loadError && !settings) {
    return <LoadError message={loadError} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  if (route === 'welcome') {
    // Setup resumes at the saved step, so it waits for settings to load.
    if (!settings) {
      return (
        <div className="fw-pane" role="status">
          <span className="fw-spinner" aria-hidden="true" />{' '}
          <span className="fw-muted">Loading…</span>
        </div>
      );
    }
    return (
      <Welcome
        settings={settings}
        onSettingsChange={setSettings}
        onDone={() => navigate('profile')}
      />
    );
  }

  return (
    <div className="fw-shell">
      <a className="fw-skip-link" href="#fw-main">
        Skip to content
      </a>

      <aside className="fw-sidebar">
        <div className="fw-brand fw-sidebar__brand">
          <span className="fw-brand__mark" aria-hidden="true" />
          <span className="fw-brand__name">Fillwright</span>
        </div>

        <nav aria-label="Sections">
          {groups.map((group) => (
            <div className="fw-navgroup" key={group}>
              <h2 className="fw-navgroup__title">{group}</h2>
              <ul className="fw-navlist">
                {NAV.filter((item) => item.group === group).map((item) => (
                  <li key={item.id}>
                    <button
                      className={`fw-navlink${route === item.id ? ' fw-navlink--active' : ''}`}
                      aria-current={route === item.id ? 'page' : undefined}
                      onClick={() => navigate(item.id)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <p className="fw-sidebar__foot">Everything here is stored on this device only.</p>
      </aside>

      <main className="fw-main" id="fw-main" tabIndex={-1}>
        {route === 'privacy' && <PrivacyCenter />}
        {route === 'permissions' && <Permissions />}
        {route === 'settings' && <SettingsPane settings={settings} onChange={setSettings} />}
        {route === 'import' && <ImportResume settings={settings} />}
        {route === 'profile' && <ProfileEditor settings={settings} />}
        {route === 'preferences' && <Preferences settings={settings} />}
        {route === 'profiles' && <Profiles settings={settings} onSettingsChange={setSettings} />}
        {route === 'history' && <History settings={settings} onSettingsChange={setSettings} />}
        {route === 'learned' && <SavedMappings />}
        {route === 'assistance' && (
          <Assistance settings={settings} onSettingsChange={setSettings} />
        )}
        {route === 'security' && <Security settings={settings} onSettingsChange={setSettings} />}
      </main>
    </div>
  );
}
