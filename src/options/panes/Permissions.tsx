interface PermissionDoc {
  id: string;
  name: string;
  why: string;
  canAccess: string;
  cannotAccess: string;
  optional: boolean;
}

const PERMISSIONS: PermissionDoc[] = [
  {
    id: 'storage',
    name: 'storage',
    why: 'Saves your settings and remembers which profile is active.',
    canAccess: 'Fillwright’s own settings record inside the extension’s storage area.',
    cannotAccess: 'Anything stored by websites or by other extensions.',
    optional: false,
  },
  {
    id: 'activeTab',
    name: 'activeTab',
    why: 'Lets Fillwright read the form on the tab you are looking at — but only after you click the toolbar icon or press the shortcut.',
    canAccess: 'The page in the current tab, for as long as that activation lasts.',
    cannotAccess:
      'Any tab you have not activated, your browsing history, or pages in the background.',
    optional: false,
  },
  {
    id: 'scripting',
    name: 'scripting',
    why: 'Injects the field-detection script into the tab you activated. That script is bundled with the extension.',
    canAccess: 'The tab granted by activeTab or by a host permission you approved.',
    cannotAccess: 'Remote code — Fillwright never downloads or evaluates scripts from the network.',
    optional: false,
  },
  {
    id: 'host',
    name: 'Access to https sites (optional)',
    why: 'Only if you choose Assist or Smart mode, so Fillwright can offer help on application pages before you click. Chrome asks you first.',
    canAccess:
      'Pages on https sites while Assist or Smart is on. Fillwright checks locally whether a page is an ' +
      'application and stays silent if it is not. Localhost can be granted separately for testing your own forms.',
    cannotAccess:
      'Anything while you are in Manual mode. Switching back to Manual, or removing the access in Chrome, ' +
      'stops it immediately.',
    optional: true,
  },
];

/**
 * Permission transparency page. Every entry corresponds to a line in
 * public/manifest.json, so the claims here are checkable rather than asserted.
 */
export function Permissions() {
  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Permissions</h1>
        <p className="fw-pane__subtitle">
          Fillwright requests the narrowest set of permissions that still lets it fill a form.
        </p>
      </header>

      <section className="fw-section">
        <p className="fw-section__lead">
          Notably absent: <code>&lt;all_urls&gt;</code>. Fillwright does not ask to read every site
          you visit. By default it can only see a page after you deliberately activate it there.
        </p>
      </section>

      <ul className="fw-permlist">
        {PERMISSIONS.map((permission) => (
          <li className="fw-perm" key={permission.id}>
            <div className="fw-perm__head">
              <code className="fw-perm__name">{permission.name}</code>
              <span className={`fw-tag${permission.optional ? ' fw-tag--muted' : ''}`}>
                {permission.optional ? 'Optional' : 'Required'}
              </span>
            </div>
            <p className="fw-perm__why">{permission.why}</p>
            <dl className="fw-perm__grid">
              <div>
                <dt>Can access</dt>
                <dd>{permission.canAccess}</dd>
              </div>
              <div>
                <dt>Cannot access</dt>
                <dd>{permission.cannotAccess}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
