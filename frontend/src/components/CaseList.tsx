import { useEffect, useRef } from 'react';
import type { CaseSummary } from '../data/types';
import type { AsyncState } from '../lib/async';
import { PRIORITY_SHORT } from '../lib/indicators';
import { EvaluationPanel } from './EvaluationPanel';
import { EmptyState, ErrorState, SkeletonLines } from './StateViews';

interface Props {
  state: AsyncState<CaseSummary[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  /** Phone/tablet: the list is a drawer. */
  drawerOpen?: boolean;
  onClose?: () => void;
}

export function CaseList({ state, selectedId, onSelect, onRetry, drawerOpen = false, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (drawerOpen) closeRef.current?.focus();
  }, [drawerOpen]);
  return (
    <nav className={`sidebar${drawerOpen ? ' is-open' : ''}`} aria-label="Cases to review">
      <div className="sidebar-head">
        <div>
          <h2>Cases to review</h2>
          <p className="muted small">Ordered by review priority</p>
        </div>
        <button ref={closeRef} type="button" className="icon-btn drawer-close" aria-label="Close case list" onClick={onClose}>
          ×
        </button>
      </div>
      <EvaluationPanel />
      {(state.status === 'loading' || state.status === 'idle') && (
        <div className="case-items">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="case-item case-item-skeleton">
              <SkeletonLines rows={2} />
            </div>
          ))}
        </div>
      )}
      {state.status === 'error' && <ErrorState title="Couldn’t load cases" detail={state.error} onRetry={onRetry} />}
      {state.status === 'success' && state.data.length === 0 && (
        <EmptyState title="No cases to review" detail="The sample rules did not flag any networks." />
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ul className="case-items">
          {state.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`case-item${c.id === selectedId ? ' is-selected' : ''}`}
                onClick={() => onSelect(c.id)}
                aria-current={c.id === selectedId ? 'true' : undefined}
              >
                <span className="case-item-title">{c.title}</span>
                <span className="case-item-meta">
                  <span className={`priority-badge priority-${c.priority}`}>{PRIORITY_SHORT[c.priority]}</span>
                  <span>{c.accountCount} accounts</span>
                  <span className="mono dim">{c.id}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
