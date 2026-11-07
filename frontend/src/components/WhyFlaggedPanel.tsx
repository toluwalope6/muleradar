import type { CaseDetail } from '../data/types';
import type { Selection } from '../lib/selection';

interface Props {
  caseDetail: CaseDetail;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export function WhyFlaggedPanel({ caseDetail, selection, onSelect }: Props) {
  return (
    <div className="why-panel">
      <p className="notice">
        Indicators are patterns that warrant review, not proof of wrongdoing. This explanation is assembled from the
        sample rules and this case’s transactions only. Click a transaction ID to highlight it on the graph.
      </p>
      {caseDetail.indicators.map((indicator) => (
        <article key={indicator.type} className="indicator-card">
          <header>
            <h3>{indicator.title}</h3>
            <span className="small dim">{indicator.transactionIds.length} transactions cited</span>
          </header>
          <p className="rule">
            <span className="rule-label">Sample rule</span>
            {indicator.rule}
          </p>
          <ul className="point-list">
            {indicator.points.map((point) => (
              <li key={point.text}>
                <p>{point.text}</p>
                <div className="chip-row">
                  {point.transactionIds.map((id) => {
                    const active = selection?.kind === 'transaction' && selection.id === id;
                    return (
                      <button
                        type="button"
                        key={id}
                        className={`tx-chip${active ? ' is-active' : ''}`}
                        onClick={() => onSelect({ kind: 'transaction', id })}
                      >
                        {id}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
