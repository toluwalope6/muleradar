import type { CaseSummary } from '../data/types';
import type { AsyncState } from '../lib/async';
import { formatDate, formatMoney } from '../lib/format';
import { INDICATOR_LABELS } from '../lib/indicators';
import { EmptyState, ErrorState, SkeletonLines } from './StateViews';

interface Props {
  state: AsyncState<CaseSummary[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function CaseList({ state, selectedId, onSelect, onRetry }: Props) {
  return (
    <aside className="panel case-list" aria-label="Ranked suspicious networks">
      <div className="panel-header">
        <h2>Suspicious networks</h2>
        {state.status === 'success' && <span className="count-pill">{state.data.length}</span>}
      </div>
      <p className="panel-sub">Ranked by sample priority score</p>
      <div className="case-list-body">
        {(state.status === 'loading' || state.status === 'idle') &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="case-card case-card-skeleton">
              <SkeletonLines rows={3} />
            </div>
          ))}
        {state.status === 'error' && (
          <ErrorState title="Couldn’t load networks" detail={state.error} onRetry={onRetry} />
        )}
        {state.status === 'success' && state.data.length === 0 && (
          <EmptyState title="No suspicious networks" detail="The sample rules did not flag any networks." />
        )}
        {state.status === 'success' &&
          state.data.map((c, index) => (
            <button
              type="button"
              key={c.id}
              className={`case-card${c.id === selectedId ? ' is-selected' : ''}`}
              onClick={() => onSelect(c.id)}
              aria-pressed={c.id === selectedId}
            >
              <div className="case-card-top">
                <span className="case-rank">#{index + 1}</span>
                <span className="case-id">{c.id}</span>
                <span className={`score-badge priority-${c.priority}`} title="Sample priority score">
                  {c.priorityScore}
                </span>
              </div>
              <div className="case-title">{c.title}</div>
              <div className="chip-row">
                {c.indicatorTypes.map((t) => (
                  <span key={t} className="chip">
                    {INDICATOR_LABELS[t]}
                  </span>
                ))}
              </div>
              <div className="case-meta">
                <span>{c.accountCount} accounts</span>
                <span>{c.evidenceTransactionCount} txns</span>
                <span>{formatMoney(c.evidenceVolume, c.currency)}</span>
              </div>
              <div className="case-meta case-meta-dim">{formatDate(c.windowStart)}</div>
            </button>
          ))}
      </div>
    </aside>
  );
}
