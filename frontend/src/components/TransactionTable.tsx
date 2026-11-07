import type { Transaction } from '../data/types';
import { formatDateTime, formatMoney } from '../lib/format';
import type { Selection } from '../lib/selection';

interface Props {
  transactions: Transaction[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export function TransactionTable({ transactions, selection, onSelect }: Props) {
  const rows = [...transactions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const isRelated = (t: Transaction) =>
    selection?.kind === 'account' && (t.from === selection.id || t.to === selection.id);
  return (
    <div className="tx-table-wrap">
      <table className="tx-table">
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Transaction</th>
            <th>From → To</th>
            <th className="num">Amount</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const selected = selection?.kind === 'transaction' && selection.id === t.id;
            return (
              <tr
                key={t.id}
                className={`${selected ? 'is-selected' : ''} ${isRelated(t) ? 'is-related' : ''}`}
                onClick={() => onSelect({ kind: 'transaction', id: t.id })}
              >
                <td className="mono dim">{formatDateTime(t.timestamp).replace(' UTC', '')}</td>
                <td className="mono">{t.id}</td>
                <td className="mono">
                  {t.from} → {t.to}
                </td>
                <td className="num mono">{formatMoney(t.amount, t.currency)}</td>
                <td>
                  <span className={`tag ${t.isEvidence ? 'tag-evidence' : 'tag-context'}`}>
                    {t.isEvidence ? 'Evidence' : 'Context'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
