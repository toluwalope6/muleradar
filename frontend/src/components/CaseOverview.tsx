import type { CaseDetail } from '../data/types';
import { caseFacts, type CaseStory } from '../lib/caseStory';
import { formatDateTime, formatDuration, formatMoneyWhole } from '../lib/format';
import { PRIORITY_LABELS } from '../lib/indicators';
import type { Selection } from '../lib/selection';

interface Props {
  caseDetail: CaseDetail;
  story: CaseStory;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onOpenReport: () => void;
}

export function CaseOverview({ caseDetail: c, story, selection, onSelect, onOpenReport }: Props) {
  const facts = caseFacts(c);
  const rawTotal = c.scoreComponents.reduce((t, s) => t + s.points, 0);
  return (
    <>
      <header className="case-head">
        <div className="case-head-text">
          <p className="eyebrow">
            Case {c.id} · {c.title}
          </p>
          <h1>{story.headline}</h1>
          <span className={`priority-pill priority-${c.priority}`}>{PRIORITY_LABELS[c.priority]}</span>
        </div>
        <div className="report-action">
          <button type="button" className="btn btn-primary" onClick={onOpenReport}>
            Generate draft report
          </button>
          <p className="small muted">Filled in from a fixed template using this case’s data only. No AI service is used.</p>
        </div>
      </header>

      <div className="overview">
        <div className="story">
          <section>
            <h2>What happened</h2>
            {story.whatHappened.map((s) => (
              <p key={s} className="lead">
                {s}
              </p>
            ))}
            <p className="muted">{story.whyItMatters}</p>
          </section>

          <section>
            <h2>Why this needs review</h2>
            <ol className="reasons">
              {story.whyReview.map((p) => (
                <li key={p.title}>
                  <strong>{p.title}</strong>
                  <span>{p.text}</span>
                </li>
              ))}
            </ol>
            <p className="small muted">These are patterns that need a human review, not proof of wrongdoing.</p>
          </section>

          <details className="section-details">
            <summary>Technical details: matched rules and review priority score</summary>
            <div className="tech">
              {c.indicators.map((i) => (
                <div key={i.type} className="tech-rule">
                  <h3>{i.title}</h3>
                  <p className="muted small">Sample rule: {i.rule}</p>
                  <ul>
                    {i.points.map((p) => (
                      <li key={p.text}>
                        {p.text}{' '}
                        {p.transactionIds.map((id) => (
                          <button
                            type="button"
                            key={id}
                            className={`tx-ref${selection?.kind === 'transaction' && selection.id === id ? ' is-active' : ''}`}
                            onClick={() => onSelect({ kind: 'transaction', id })}
                          >
                            {id}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="tech-rule">
                <h3>Review priority score: {c.priorityScore} / 100</h3>
                <p className="muted small">
                  Ranks cases for review by adding sample rule weights. It is not a probability of fraud or wrongdoing.
                </p>
                <table className="score-table">
                  <tbody>
                    {c.scoreComponents.map((s) => (
                      <tr key={s.label}>
                        <td>{s.label}</td>
                        <td className="num mono">+{s.points}</td>
                      </tr>
                    ))}
                    <tr className="score-total">
                      <td>Total{rawTotal > 100 ? ` (${rawTotal}, capped at 100)` : ''}</td>
                      <td className="num mono">{c.priorityScore}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </div>

        <aside className="facts" aria-label="Key facts">
          <div className="fact">
            <span className="fact-value">{facts.flaggedAccounts.length}</span>
            <span className="fact-label">Flagged accounts</span>
          </div>
          <div className="fact">
            <span className="fact-value">{facts.flaggedTransfers.length}</span>
            <span className="fact-label">Flagged transfers</span>
          </div>
          <div className="fact">
            <span className="fact-value">{formatMoneyWhole(facts.totalFlagged, c.currency)}</span>
            <span className="fact-label">Total across flagged transfers</span>
            <span className="fact-note">Adds up every flagged transfer, so money that passes through several accounts is counted more than once.</span>
          </div>
          <div className="fact">
            <span className="fact-value">{formatDuration(c.windowStart, c.windowEnd)}</span>
            <span className="fact-label">Time span</span>
            <span className="fact-note">
              {formatDateTime(c.windowStart)} to {formatDateTime(c.windowEnd)}
            </span>
          </div>
          {(facts.contextAccounts.length > 0 || facts.contextTransfers.length > 0) && (
            <p className="fact-note">
              The graph can also show {facts.contextAccounts.length > 0 && `${facts.contextAccounts.length} other account${facts.contextAccounts.length === 1 ? '' : 's'} and `}
              {facts.contextTransfers.length} contextual transfer{facts.contextTransfers.length === 1 ? '' : 's'} that were not flagged.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
