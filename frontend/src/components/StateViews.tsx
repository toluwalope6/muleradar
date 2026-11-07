interface MessageProps {
  title: string;
  detail?: string;
}

export function EmptyState({ title, detail }: MessageProps) {
  return (
    <div className="state state-empty" role="status">
      <div className="state-icon" aria-hidden>○</div>
      <p className="state-title">{title}</p>
      {detail && <p className="state-detail">{detail}</p>}
    </div>
  );
}

export function ErrorState({ title, detail, onRetry }: MessageProps & { onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon" aria-hidden>!</div>
      <p className="state-title">{title}</p>
      {detail && <p className="state-detail">{detail}</p>}
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function SkeletonLines({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-group" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - (i % 3) * 15}%` }} />
      ))}
    </div>
  );
}
