import type { CaseDetail } from '../data/types';
import { accountShortLabels } from '../lib/caseStory';
import { formatDateTime, formatMoneyWhole } from '../lib/format';
import type { Selection } from '../lib/selection';

interface Props {
  caseDetail: CaseDetail;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export function TransactionTable({ caseDetail, selection, onSelect }: Props) {
  const labels = accountShortLabels(caseDetail);
  const rows = [...caseDetail.transactions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const flagged = rows.filter((t) => t.isEvidence).length;
  const context = rows.length - flagged;
  return (
    <details className="section-details">
      <summary>
        View transactions{' '}
        <span className="muted">
          ({flagged} flagged{context > 0 ? `, ${context} contextual` : ''})
        </span>
      </summary>
      <table className="tx-table">
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Transfer</th>
            <th>From</th>
            <th>To</th>
            <th className="num">Amount</th>
            <th>Reference</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const selected = selection?.kind === 'transaction' && selection.id === t.id;
            const related = selection?.kind === 'account' && (t.from === selection.id || t.to === selection.id);
            return (
              <tr
                key={t.id}
                className={`${selected ? 'is-selected' : ''}${related ? ' is-related' : ''}${t.isEvidence ? '' : ' is-context'}`}
                onClick={() => onSelect({ kind: 'transaction', id: t.id })}
              >
                <td className="mono muted">{formatDateTime(t.timestamp).replace(' UTC', '')}</td>
                <td className="mono">{t.id}</td>
                <td>
                  {labels[t.from]} <span className="mono dim">{t.from}</span>
                </td>
                <td>
                  {labels[t.to]} <span className="mono dim">{t.to}</span>
                </td>
                <td className="num mono">{formatMoneyWhole(t.amount, t.currency)}</td>
                <td className="muted">{t.reference}</td>
                <td>{t.isEvidence ? <span className="status-flagged">Flagged</span> : <span className="dim">Contextual</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
