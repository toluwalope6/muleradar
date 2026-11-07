import type { CaseDetail, Transaction } from '../data/types';
import { accountShortLabels } from '../lib/caseStory';
import { formatDate, formatDateTime, formatMoneyWhole } from '../lib/format';
import type { Selection } from '../lib/selection';

interface Props {
  caseDetail: CaseDetail;
  selection: Exclude<Selection, null>;
  onSelect: (selection: Selection) => void;
}

function AccountLink({ id, label, onSelect }: { id: string; label: string; onSelect: Props['onSelect'] }) {
  return (
    <button type="button" className="link" onClick={() => onSelect({ kind: 'account', id })}>
      {label} <span className="mono dim">{id}</span>
    </button>
  );
}

export function DetailsPanel({ caseDetail: c, selection, onSelect }: Props) {
  const labels = accountShortLabels(c);
  const money = (n: number) => formatMoneyWhole(n, c.currency);
  const close = (
    <button type="button" className="icon-btn" aria-label="Close details" onClick={() => onSelect(null)}>
      ×
    </button>
  );

  if (selection.kind === 'transaction') {
    const t = c.transactions.find((x) => x.id === selection.id);
    if (!t) return null;
    const rules = c.indicators.filter((i) => i.transactionIds.includes(t.id));
    return (
      <aside className="details-panel" aria-label="Transfer details">
        <header>
          <div>
            <span className="eyebrow">Transfer</span>
            <h3 className="mono">{t.id}</h3>
          </div>
          {close}
        </header>
        <p className="details-amount">{money(t.amount)}</p>
        <p className={`status ${t.isEvidence ? 'status-flagged' : 'status-context'}`}>
          {t.isEvidence ? 'Flagged transfer' : 'Contextual transfer, not flagged'}
        </p>
        <dl className="kv">
          <dt>From</dt>
          <dd>
            <AccountLink id={t.from} label={labels[t.from]} onSelect={onSelect} />
          </dd>
          <dt>To</dt>
          <dd>
            <AccountLink id={t.to} label={labels[t.to]} onSelect={onSelect} />
          </dd>
          <dt>When</dt>
          <dd>{formatDateTime(t.timestamp)}</dd>
          {t.reference && (
            <>
              <dt>Reference</dt>
              <dd>“{t.reference}”</dd>
            </>
          )}
          {t.note && (
            <>
              <dt>Backend note</dt>
              <dd>{t.note}</dd>
            </>
          )}
          {rules.length > 0 && (
            <>
              <dt>Matched</dt>
              <dd>{rules.map((r) => r.title).join(', ')}</dd>
            </>
          )}
        </dl>
      </aside>
    );
  }

  const a = c.accounts.find((x) => x.id === selection.id);
  if (!a) return null;
  const incoming = c.transactions.filter((t) => t.to === a.id);
  const outgoing = c.transactions.filter((t) => t.from === a.id);
  const total = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount, 0);
  const list = (txs: Transaction[], dir: 'in' | 'out') =>
    txs.length === 0 ? (
      <p className="muted small">None</p>
    ) : (
      <ul className="tx-mini">
        {txs.map((t) => (
          <li key={t.id}>
            <button type="button" className="link" onClick={() => onSelect({ kind: 'transaction', id: t.id })}>
              {money(t.amount)}
            </button>
            <span className="muted">
              {dir === 'in' ? 'from' : 'to'} {labels[dir === 'in' ? t.from : t.to]}
            </span>
            {!t.isEvidence && <span className="dim small">context</span>}
          </li>
        ))}
      </ul>
    );
  return (
    <aside className="details-panel" aria-label="Account details">
      <header>
        <div>
          <span className="eyebrow">Account · {labels[a.id]}</span>
          <h3 className="mono">{a.id}</h3>
        </div>
        {close}
      </header>
      <dl className="kv">
        {a.accountType && (
          <>
            <dt>Type</dt>
            <dd>
              {a.accountType === 'business' ? 'Business' : 'Personal'}
              {a.country ? ` · ${a.country}` : ''}
            </dd>
          </>
        )}
        {a.openedOn && (
          <>
            <dt>Opened</dt>
            <dd>{formatDate(a.openedOn)}</dd>
          </>
        )}
        {a.backendRole && (
          <>
            <dt>Backend role</dt>
            <dd>
              {a.backendRole}
              {a.backendRiskScore !== undefined ? ` · account score ${a.backendRiskScore}/100` : ''}
            </dd>
          </>
        )}
        <dt>In this case</dt>
        <dd>
          {money(total(incoming))} in · {money(total(outgoing))} out
        </dd>
      </dl>
      <h4>Money in</h4>
      {list(incoming, 'in')}
      <h4>Money out</h4>
      {list(outgoing, 'out')}
    </aside>
  );
}
