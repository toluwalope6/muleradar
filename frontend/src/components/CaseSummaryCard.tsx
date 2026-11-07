import type { CaseDetail } from '../data/types';
import { formatDateTime, formatDuration, formatMoney } from '../lib/format';
import { INDICATOR_LABELS, PRIORITY_LABELS } from '../lib/indicators';

export function CaseSummaryCard({ caseDetail: c }: { caseDetail: CaseDetail }) {
  return (
    <section className="summary-card" aria-label="Case summary">
      <div className="summary-top">
        <div>
          <div className="eyebrow">{c.id}</div>
          <h2 className="summary-title">{c.title}</h2>
        </div>
        <div className={`score-ring priority-${c.priority}`} title="Sample priority score (0–100)">
          <span className="score-value">{c.priorityScore}</span>
          <span className="score-max">/100</span>
        </div>
      </div>
      <div className={`priority-label priority-${c.priority}`}>{PRIORITY_LABELS[c.priority]}</div>
      <div className="chip-row">
        {c.indicatorTypes.map((t) => (
          <span key={t} className="chip chip-strong">
            {INDICATOR_LABELS[t]}
          </span>
        ))}
      </div>
      <dl className="stat-grid">
        <div>
          <dt>Accounts</dt>
          <dd>{c.accountCount}</dd>
        </div>
        <div>
          <dt>Evidence txns</dt>
          <dd>{c.evidenceTransactionCount}</dd>
        </div>
        <div>
          <dt>Evidence volume</dt>
          <dd>{formatMoney(c.evidenceVolume, c.currency)}</dd>
        </div>
        <div>
          <dt>Activity window</dt>
          <dd title={`${formatDateTime(c.windowStart)} – ${formatDateTime(c.windowEnd)}`}>
            {formatDuration(c.windowStart, c.windowEnd)}
          </dd>
        </div>
      </dl>
      <details className="score-breakdown">
        <summary>Score breakdown (sample weights)</summary>
        <ul>
          {c.scoreComponents.map((s) => (
            <li key={s.label}>
              <span>{s.label}</span>
              <span className="mono">+{s.points}</span>
            </li>
          ))}
          <li className="score-total">
            <span>Priority score{c.scoreComponents.reduce((t, s) => t + s.points, 0) > 100 ? ' (capped)' : ''}</span>
            <span className="mono">{c.priorityScore}</span>
          </li>
        </ul>
      </details>
    </section>
  );
}
