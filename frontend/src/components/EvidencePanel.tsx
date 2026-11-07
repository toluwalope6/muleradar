import type { Account, CaseDetail, Transaction } from '../data/types';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { ROLE_LABELS } from '../lib/indicators';
import type { Selection } from '../lib/selection';
import { EmptyState } from './StateViews';

interface Props {
  caseDetail: CaseDetail;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

function IdLink({ kind, id, onSelect }: { kind: 'account' | 'transaction'; id: string; onSelect: Props['onSelect'] }) {
  return (
    <button type="button" className="id-link" onClick={() => onSelect({ kind, id })}>
      {id}
    </button>
  );
}

function AccountDetail({ account, caseDetail, onSelect }: { account: Account } & Omit<Props, 'selection'>) {
  const incoming = caseDetail.transactions.filter((t) => t.to === account.id);
  const outgoing = caseDetail.transactions.filter((t) => t.from === account.id);
  const total = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount, 0);
  const indicators = caseDetail.indicators.filter((i) =>
    i.transactionIds.some((id) => [...incoming, ...outgoing].some((t) => t.id === id)),
  );
  return (
    <div className="evidence-detail">
      <div className="detail-head">
        <span className="kind-tag">Account</span>
        <h3 className="mono">{account.id}</h3>
        <span className={`tag role-${account.role}`}>{ROLE_LABELS[account.role]}</span>
      </div>
      <dl className="kv">
        <dt>Holder</dt>
        <dd>{account.label}</dd>
        <dt>Type</dt>
        <dd>{account.accountType}</dd>
        <dt>Country</dt>
        <dd>{account.country}</dd>
        <dt>Opened</dt>
        <dd>{formatDate(account.openedOn)}</dd>
        <dt>In this case</dt>
        <dd>
          {formatMoney(total(incoming), caseDetail.currency)} in · {formatMoney(total(outgoing), caseDetail.currency)} out
        </dd>
      </dl>
      {[
        ['Incoming', incoming],
        ['Outgoing', outgoing],
      ].map(([label, txs]) => (
        <div key={label as string} className="detail-section">
          <h4>
            {label as string} ({(txs as Transaction[]).length})
          </h4>
          {(txs as Transaction[]).length === 0 ? (
            <p className="muted small">None in this case.</p>
          ) : (
            <ul className="mini-list">
              {(txs as Transaction[]).map((t) => (
                <li key={t.id}>
                  <IdLink kind="transaction" id={t.id} onSelect={onSelect} />
                  <span className="mono dim">{label === 'Incoming' ? `from ${t.from}` : `to ${t.to}`}</span>
                  <span className="mono num">{formatMoney(t.amount, t.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="detail-section">
        <h4>Indicators involving this account</h4>
        {indicators.length === 0 ? (
          <p className="muted small">Context only — not part of a flagged indicator.</p>
        ) : (
          <div className="chip-row">
            {indicators.map((i) => (
              <span key={i.type} className="chip">
                {i.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionDetail({ tx, caseDetail, onSelect }: { tx: Transaction } & Omit<Props, 'selection'>) {
  const indicators = caseDetail.indicators.filter((i) => i.transactionIds.includes(tx.id));
  return (
    <div className="evidence-detail">
      <div className="detail-head">
        <span className="kind-tag">Transaction</span>
        <h3 className="mono">{tx.id}</h3>
        <span className={`tag ${tx.isEvidence ? 'tag-evidence' : 'tag-context'}`}>
          {tx.isEvidence ? 'Evidence' : 'Context'}
        </span>
      </div>
      <div className="tx-flow">
        <IdLink kind="account" id={tx.from} onSelect={onSelect} />
        <span className="tx-arrow">
          <span className="tx-amount">{formatMoney(tx.amount, tx.currency)}</span>→
        </span>
        <IdLink kind="account" id={tx.to} onSelect={onSelect} />
      </div>
      <dl className="kv">
        <dt>Timestamp</dt>
        <dd>{formatDateTime(tx.timestamp)}</dd>
        <dt>Amount</dt>
        <dd className="mono">{formatMoney(tx.amount, tx.currency)}</dd>
        <dt>Reference</dt>
        <dd>“{tx.reference}”</dd>
      </dl>
      <div className="detail-section">
        <h4>Cited by indicators</h4>
        {indicators.length === 0 ? (
          <p className="muted small">Not cited by any indicator. Shown for context only.</p>
        ) : (
          <ul className="cite-list">
            {indicators.map((i) => (
              <li key={i.type}>
                <strong>{i.title}</strong>
                {i.points
                  .filter((p) => p.transactionIds.includes(tx.id))
                  .map((p) => (
                    <p key={p.text}>{p.text}</p>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function EvidencePanel({ caseDetail, selection, onSelect }: Props) {
  if (selection?.kind === 'account') {
    const account = caseDetail.accounts.find((a) => a.id === selection.id);
    if (account) return <AccountDetail account={account} caseDetail={caseDetail} onSelect={onSelect} />;
  }
  if (selection?.kind === 'transaction') {
    const tx = caseDetail.transactions.find((t) => t.id === selection.id);
    if (tx) return <TransactionDetail tx={tx} caseDetail={caseDetail} onSelect={onSelect} />;
  }
  return (
    <div>
      <EmptyState
        title="Nothing selected"
        detail="Click an account or a transaction on the graph, or pick one below, to inspect its evidence."
      />
      <h4 className="list-heading">Accounts in this case</h4>
      <ul className="mini-list">
        {caseDetail.accounts.map((a) => (
          <li key={a.id}>
            <IdLink kind="account" id={a.id} onSelect={onSelect} />
            <span className={`tag role-${a.role}`}>{ROLE_LABELS[a.role]}</span>
            <span className="dim small">{a.accountType}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
