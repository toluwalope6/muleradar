import { useEffect, useState } from 'react';
import { getEvaluation } from '../data/api';
import type { Evaluation } from '../data/types';
import { errorMessage, type AsyncState } from '../lib/async';
import { formatPercent } from '../lib/format';

const num = (n: number) => n.toLocaleString('en-GB');

export function EvaluationPanel() {
  const [state, setState] = useState<AsyncState<Evaluation | null>>({ status: 'loading' });
  useEffect(() => {
    getEvaluation()
      .then((data) => setState({ status: 'success', data }))
      .catch((err) => setState({ status: 'error', error: errorMessage(err) }));
  }, []);

  if (state.status === 'success' && state.data === null) return null;
  const e = state.status === 'success' ? state.data : null;
  const share = e?.transactions && e.labelledLaundering !== undefined ? e.labelledLaundering / e.transactions : null;
  return (
    <details className="evaluation">
      <summary>Detection evaluation</summary>
      {state.status === 'loading' && <p className="muted small">Loading…</p>}
      {state.status === 'error' && <p className="small error-text">Couldn’t load the evaluation: {state.error}</p>}
      {e && (
        <>
          <dl className="eval-grid">
            <div>
              <dt>Precision</dt>
              <dd>{formatPercent(e.precision)}</dd>
            </div>
            <div>
              <dt>Recall</dt>
              <dd>{formatPercent(e.recall)}</dd>
            </div>
            {e.schemesTotal > 0 && (
              <div>
                <dt>Labelled schemes found</dt>
                <dd>
                  {num(e.schemesFound)} / {num(e.schemesTotal)}
                </dd>
              </div>
            )}
            {e.schemesTotal > 0 && (
              <div>
                <dt>Scheme type correct</dt>
                {/* The backend reports 0 when no scheme was found, which means "not measured". */}
                <dd>{e.schemesFound > 0 ? formatPercent(e.schemeTypeAccuracy) : 'Not measured'}</dd>
              </div>
            )}
          </dl>
          <p className="small muted">
            Computed by the backend against the dataset’s laundering labels, per transaction: precision is the share of transactions in cases that are
            labelled laundering; recall is the share of labelled laundering transactions that appear in a case. Case transactions include contextual
            ones.
          </p>
          {share !== null && e.transactions !== undefined && e.labelledLaundering !== undefined && (
            <p className="small muted">
              Evaluated on {num(e.transactions)} transactions, {num(e.labelledLaundering)} ({formatPercent(share)}) labelled laundering. If the sample
              over-represents laundering (the IBM loader keeps every laundering transfer but only a sample of normal ones), precision is higher than
              it would be on the full data. The rules were not tested on a held-out set.
            </p>
          )}
        </>
      )}
    </details>
  );
}
