/**
 * The one way a pane says "this could not load".
 *
 * Trust boundary: renders text produced by `send()`, which is already mapped
 * to user language; never raw exception text.
 */
export function LoadError({
  message,
  onRetry,
  actionLabel = 'Try again',
}: {
  message: string;
  onRetry: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="fw-pane">
      <div className="fw-notice fw-notice--danger" role="alert">
        <p>{message}</p>
        <button className="fw-btn fw-btn--sm" onClick={onRetry}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
