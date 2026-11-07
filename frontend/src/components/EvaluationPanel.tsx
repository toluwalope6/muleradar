import { useEffect, useState, type ReactNode } from 'react';
import { getEvaluation } from '../data/api';
import type { Evaluation } from '../data/types';
import { errorMessage, type AsyncState } from '../lib/async';
import { formatPercent } from '../lib/format';

const num = (n: number) => n.toLocaleString('en-GB');

interface Metric {
  label: string;
  numerator?: number;
  denominator?: number;
  reported: number;
  definition: ReactNode;
}

/** A metric is shown only when the backend returns its counts and they reproduce the reported value. */
function verified(m: Metric): m is Metric & { numerator: number; denominator: number } {
  if (m.numerator === undefined || m.denominator === undefined || m.denominator === 0) return false;
  // The backend rounds to 3 decimals (half-to-even), so a correct value can be off by exactly 0.0005.
  return Math.abs(m.numerator / m.denominator - m.reported) <= 0.0005 + 1e-9;
}

function MetricRow({ m }: { m: Metric }) {
  if (m.denominator === 0) {
    return (
      <div className="eval-metric">
        <div className="eval-head">
          <dt>{m.label}</dt>
          <dd className="muted">Not measured</dd>
        </div>
        <p className="eval-def">There is nothing to measure it against (denominator is 0).</p>
      </div>
    );
  }
  if (!verified(m)) {
    return (
      <div className="eval-metric">
        <div className="eval-head">
          <dt>{m.label}</dt>
          <dd className="muted">Hidden</dd>
        </div>
        <p className="eval-def">The backend did not return counts that reproduce this figure, so it can’t be verified here.</p>
      </div>
    );
  }
  return (
    <div className="eval-metric">
      <div className="eval-head">
        <dt>{m.label}</dt>
        <dd>{formatPercent(m.numerator / m.denominator)}</dd>
      </div>
      <p className="eval-count">
        {num(m.numerator)} / {num(m.denominator)}
      </p>
      <p className="eval-def">{m.definition}</p>
    </div>
  );
}

export function EvaluationPanel() {
  const [state, setState] = useState<AsyncState<Evaluation | null>>({ status: 'loading' });
  useEffect(() => {
    getEvaluation()
      .then((data) => setState({ status: 'success', data }))
      .catch((err) => setState({ status: 'error', error: errorMessage(err) }));
  }, []);

  if (state.status === 'success' && state.data === null) return null;
  const e = state.status === 'success' ? state.data : null;
  const threshold = e?.schemeMatchThreshold !== undefined ? formatPercent(e.schemeMatchThreshold) : null;
  const metrics: Metric[] = e
    ? [
        {
          label: 'Precision: case transactions labelled laundering',
          numerator: e.truePositiveTransactions,
          denominator: e.flaggedTransactions,
          reported: e.precision,
          definition: 'Transaction coverage across all case transactions, including contextual ones (not only flagged transfers).',
        },
        {
          label: 'Recall: labelled laundering covered by cases',
          numerator: e.truePositiveTransactions,
          denominator: e.labelledLaundering,
          reported: e.recall,
          definition: 'Labelled laundering transactions in the sample that appear anywhere in a case, including as contextual transfers.',
        },
        {
          label: 'Labelled schemes found',
          numerator: e.schemesFound,
          denominator: e.schemesTotal,
          reported: e.schemesTotal ? e.schemesFound / e.schemesTotal : 0,
          definition: threshold
            ? `Labelled schemes matched by a case. Each case is matched to the labelled scheme whose accounts overlap its own most (shared accounts ÷ all accounts of both); it counts if the overlap is at least ${threshold}. Partial matches count.`
            : 'Labelled schemes matched by a case.',
        },
        {
          label: 'Scheme type correct',
          numerator: e.schemesTypeCorrect,
          denominator: e.schemesFound,
          reported: e.schemeTypeAccuracy,
          definition: 'Found schemes where the best-matching case’s scheme type equals the label.',
        },
      ]
    : [];
  return (
    <details className="evaluation">
      <summary>Evaluation on development sample</summary>
      {state.status === 'loading' && <p className="muted small">Loading…</p>}
      {state.status === 'error' && <p className="small error-text">Couldn’t load the evaluation: {state.error}</p>}
      {e && (
        <>
          <dl className="eval-grid">
            {metrics.map((m) => (
              <MetricRow key={m.label} m={m} />
            ))}
          </dl>
          <p className="small muted">
            Recall and “schemes found” differ because they count different things: recall counts transactions, while a scheme counts as found when one
            case shares enough accounts with it, even if some of its transactions are missed.
            {e.launderingInSchemes !== undefined && e.labelledLaundering !== undefined &&
              ` ${num(e.launderingInSchemes)} of the ${num(e.labelledLaundering)} labelled laundering transactions belong to a labelled scheme.`}
          </p>
          <p className="small muted">
            Computed by the backend on the same sample the rules were developed on; no held-out evaluation was done.
            {e.dataset === 'ibm' &&
              ' The sample keeps every labelled laundering transaction from the IBM dataset but only some normal ones, so these results do not establish performance on the full dataset or in real-world use.'}
            {e.dataset === 'synthetic' && ' The data and its labels come from the backend’s own synthetic generator, so these results do not establish real-world performance.'}
            {!e.dataset && ' The backend did not say which dataset built the sample.'}
          </p>
        </>
      )}
    </details>
  );
}
