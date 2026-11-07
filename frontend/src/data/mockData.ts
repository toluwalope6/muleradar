// SYNTHETIC DEMO DATA. Every account, transaction, amount and reference below is fictional.
// Explanation text is assembled from the transactions themselves so figures always stay consistent.
import type {
  Account,
  AccountRole,
  CaseDetail,
  ExplanationPoint,
  Indicator,
  IndicatorType,
  Priority,
  ScoreComponent,
  Transaction,
} from './types';
import { formatDate, formatDateTime, formatDuration, formatMoney, formatPercent, hoursBetween } from '../lib/format';
import { INDICATOR_LABELS } from '../lib/indicators';

const CURRENCY = 'EUR';
const NEAR_THRESHOLD_REFERENCE = 10_000;

export const SAMPLE_SCORE_WEIGHTS: Record<IndicatorType, number> = {
  circular_flow: 40,
  rapid_fan_in: 30,
  rapid_fan_out: 25,
  rapid_pass_through: 15,
  near_threshold_amounts: 15,
  new_account: 10,
};

const VOLUME_BANDS = [
  { min: 40_000, points: 10 },
  { min: 20_000, points: 5 },
];

export const SAMPLE_RULES: Record<IndicatorType, string> = {
  circular_flow:
    'Funds pass through 3 or more accounts and return to the originating account within 72 hours, each hop keeping 80–105% of the previous amount.',
  rapid_fan_in: '5 or more distinct senders pay one account within 24 hours, totalling at least €5,000.',
  rapid_fan_out: 'One account pays 3 or more distinct recipients within 24 hours, totalling at least €5,000.',
  rapid_pass_through:
    'An account forwards 80–105% of a single inbound transfer of at least €5,000 within 24 hours.',
  near_threshold_amounts: `Several transfers fall between 85% and 100% of the sample ${formatMoney(NEAR_THRESHOLD_REFERENCE, CURRENCY)} reference amount.`,
  new_account: 'An account central to the pattern was opened less than 30 days before the activity.',
};

const money = (amount: number) => formatMoney(amount, CURRENCY);
const sum = (txs: Transaction[]) => txs.reduce((total, t) => total + t.amount, 0);
const ids = (txs: Transaction[]) => txs.map((t) => t.id);
const byTime = (txs: Transaction[]) => [...txs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

function account(
  id: string,
  accountType: Account['accountType'],
  role: AccountRole,
  openedOn: string,
  country = 'IE',
): Account {
  const label = `${accountType === 'business' ? 'Business' : 'Personal'} account (fictional)`;
  return { id, label, accountType, role, openedOn, country };
}

function tx(
  id: string,
  timestamp: string,
  from: string,
  to: string,
  amount: number,
  reference: string,
  isEvidence = true,
): Transaction {
  return { id, timestamp, from, to, amount, currency: CURRENCY, reference, isEvidence };
}

function indicator(type: IndicatorType, points: ExplanationPoint[]): Indicator {
  const transactionIds = [...new Set(points.flatMap((p) => p.transactionIds))];
  return { type, title: INDICATOR_LABELS[type], rule: SAMPLE_RULES[type], points, transactionIds };
}

function circularFlow(hops: Transaction[]): Indicator {
  const first = hops[0];
  const last = hops[hops.length - 1];
  const intermediaries = hops.slice(1).map((h) => h.from);
  const ratios = hops.slice(1).map((h, i) => h.amount / hops[i].amount);
  return indicator('circular_flow', [
    {
      text: `${money(first.amount)} left ${first.from} (${first.id}) and passed through ${intermediaries.join(', ')} before ${money(last.amount)} returned to ${last.to} (${last.id}).`,
      transactionIds: ids(hops),
    },
    {
      text: `The loop closed in ${formatDuration(first.timestamp, last.timestamp)}, from ${formatDateTime(first.timestamp)} to ${formatDateTime(last.timestamp)}.`,
      transactionIds: [first.id, last.id],
    },
    {
      text: `${formatPercent(last.amount / first.amount)} of the original amount came back; each hop kept between ${formatPercent(Math.min(...ratios))} and ${formatPercent(Math.max(...ratios))} of the previous transfer.`,
      transactionIds: ids(hops),
    },
  ]);
}

function passThroughPoint(inbound: Transaction, outbound: Transaction[]): ExplanationPoint {
  const out = byTime(outbound);
  const forwarded = sum(out);
  const lastOut = out[out.length - 1];
  const outText =
    out.length === 1
      ? `forwarded ${money(forwarded)} (${lastOut.id})`
      : `forwarded ${money(forwarded)} across ${out.length} transfers (${out[0].id}–${lastOut.id})`;
  return {
    text: `${inbound.to} received ${money(inbound.amount)} (${inbound.id}) and ${outText}, ${formatPercent(forwarded / inbound.amount)} of the inflow, within ${formatDuration(inbound.timestamp, lastOut.timestamp)}.`,
    transactionIds: [inbound.id, ...ids(out)],
  };
}

function fanIn(inbound: Transaction[]): Indicator {
  const txs = byTime(inbound);
  const first = txs[0];
  const last = txs[txs.length - 1];
  const senders = new Set(txs.map((t) => t.from));
  return indicator('rapid_fan_in', [
    {
      text: `${first.to} received ${txs.length} payments from ${senders.size} distinct senders totalling ${money(sum(txs))} within ${formatDuration(first.timestamp, last.timestamp)} (${formatDateTime(first.timestamp)} to ${formatDateTime(last.timestamp)}).`,
      transactionIds: ids(txs),
    },
  ]);
}

function fanOut(outbound: Transaction[], precedingInflow?: Transaction[]): Indicator {
  const txs = byTime(outbound);
  const first = txs[0];
  const last = txs[txs.length - 1];
  const recipients = new Set(txs.map((t) => t.to));
  const points: ExplanationPoint[] = [
    {
      text: `${first.from} sent ${txs.length} payments to ${recipients.size} distinct recipients totalling ${money(sum(txs))} within ${formatDuration(first.timestamp, last.timestamp)} (${formatDateTime(first.timestamp)} to ${formatDateTime(last.timestamp)}).`,
      transactionIds: ids(txs),
    },
  ];
  if (precedingInflow && precedingInflow.length > 1) {
    const inflow = byTime(precedingInflow);
    points.push({
      text: `The outflows equal ${formatPercent(sum(txs) / sum(inflow))} of the ${money(sum(inflow))} collected during the fan-in. The last outflow (${last.id}) left ${formatDuration(inflow[0].timestamp, last.timestamp)} after the first inflow (${inflow[0].id}).`,
      transactionIds: [inflow[0].id, ...ids(txs)],
    });
  }
  return indicator('rapid_fan_out', points);
}

function nearThreshold(txs: Transaction[]): Indicator {
  const amounts = txs.map((t) => t.amount);
  return indicator('near_threshold_amounts', [
    {
      text: `All ${txs.length} transfers were between ${money(Math.min(...amounts))} and ${money(Math.max(...amounts))}, just below the sample ${money(NEAR_THRESHOLD_REFERENCE)} reference amount.`,
      transactionIds: ids(txs),
    },
  ]);
}

function newAccount(acc: Account, firstTx: Transaction): Indicator {
  const days = Math.floor(hoursBetween(acc.openedOn, firstTx.timestamp) / 24);
  return indicator('new_account', [
    {
      text: `${acc.id} was opened on ${formatDate(acc.openedOn)}, ${days} days before its first evidence transaction (${firstTx.id}).`,
      transactionIds: [firstTx.id],
    },
  ]);
}

function priorityFor(score: number): Priority {
  if (score >= 60) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

interface CaseDraft {
  id: string;
  title: string;
  accounts: Account[];
  transactions: Transaction[];
  indicators: Indicator[];
}

function finalizeCase(draft: CaseDraft): CaseDetail {
  const evidence = byTime(draft.transactions.filter((t) => t.isEvidence));
  const evidenceVolume = sum(evidence);
  const scoreComponents: ScoreComponent[] = draft.indicators.map((i) => ({
    label: i.title,
    points: SAMPLE_SCORE_WEIGHTS[i.type],
  }));
  const band = VOLUME_BANDS.find((b) => evidenceVolume >= b.min);
  if (band) scoreComponents.push({ label: `Evidence volume ≥ ${money(band.min)}`, points: band.points });
  const priorityScore = Math.min(
    100,
    scoreComponents.reduce((total, c) => total + c.points, 0),
  );
  return {
    ...draft,
    priorityScore,
    priority: priorityFor(priorityScore),
    indicatorTypes: draft.indicators.map((i) => i.type),
    accountCount: draft.accounts.filter((a) => a.role !== 'context').length,
    evidenceTransactionCount: evidence.length,
    evidenceVolume,
    currency: CURRENCY,
    windowStart: evidence[0].timestamp,
    windowEnd: evidence[evidence.length - 1].timestamp,
    scoreComponents,
  };
}

function caseC001(): CaseDetail {
  const accounts = [
    account('ACC-1001', 'business', 'origin', '2024-03-11'),
    account('ACC-1002', 'business', 'intermediary', '2025-06-02'),
    account('ACC-1003', 'personal', 'intermediary', '2023-11-20', 'GB'),
    account('ACC-1004', 'business', 'intermediary', '2026-01-15'),
    account('ACC-1090', 'business', 'context', '2021-05-04'),
  ];
  const t1 = tx('TX-10001', '2026-10-14T09:12:00Z', 'ACC-1001', 'ACC-1002', 48_500, 'Consultancy invoice 0412');
  const t2 = tx('TX-10002', '2026-10-14T11:47:00Z', 'ACC-1002', 'ACC-1003', 47_800, 'Stock purchase');
  const t3 = tx('TX-10003', '2026-10-14T16:05:00Z', 'ACC-1003', 'ACC-1004', 47_150, 'Services rendered');
  const t4 = tx('TX-10004', '2026-10-15T08:30:00Z', 'ACC-1004', 'ACC-1001', 46_600, 'Refund');
  const ctx = tx('TX-10005', '2026-10-13T15:00:00Z', 'ACC-1090', 'ACC-1001', 50_000, 'Customer payment', false);
  return finalizeCase({
    id: 'C-001',
    title: 'Four-account circular transfer loop',
    accounts,
    transactions: [ctx, t1, t2, t3, t4],
    indicators: [
      circularFlow([t1, t2, t3, t4]),
      indicator('rapid_pass_through', [passThroughPoint(t1, [t2]), passThroughPoint(t2, [t3]), passThroughPoint(t3, [t4])]),
    ],
  });
}

function caseC002(): CaseDetail {
  const collector = account('ACC-2100', 'personal', 'collector', '2026-09-28');
  const accounts = [
    account('ACC-2001', 'personal', 'source', '2019-02-14'),
    account('ACC-2002', 'personal', 'source', '2022-08-30'),
    account('ACC-2003', 'personal', 'source', '2020-12-01', 'GB'),
    account('ACC-2004', 'personal', 'source', '2024-05-19'),
    account('ACC-2005', 'personal', 'source', '2018-07-07'),
    account('ACC-2006', 'personal', 'source', '2025-10-23'),
    collector,
    account('ACC-2201', 'business', 'destination', '2025-04-02', 'LT'),
    account('ACC-2202', 'personal', 'destination', '2026-08-12'),
    account('ACC-2203', 'business', 'destination', '2024-11-28', 'NL'),
    account('ACC-2290', 'personal', 'context', '2017-03-09'),
  ];
  const inflows = [
    tx('TX-20001', '2026-10-21T10:02:00Z', 'ACC-2001', 'ACC-2100', 9_400, 'Loan repayment'),
    tx('TX-20002', '2026-10-21T10:41:00Z', 'ACC-2002', 'ACC-2100', 9_750, 'Car deposit'),
    tx('TX-20003', '2026-10-21T11:15:00Z', 'ACC-2003', 'ACC-2100', 8_900, 'Gift'),
    tx('TX-20004', '2026-10-21T12:08:00Z', 'ACC-2004', 'ACC-2100', 9_600, 'Furniture'),
    tx('TX-20005', '2026-10-21T13:30:00Z', 'ACC-2005', 'ACC-2100', 9_200, 'Rent share'),
    tx('TX-20006', '2026-10-21T14:46:00Z', 'ACC-2006', 'ACC-2100', 9_850, 'Event tickets'),
  ];
  const outflows = [
    tx('TX-20007', '2026-10-21T15:20:00Z', 'ACC-2100', 'ACC-2201', 18_000, 'Invoice 7781'),
    tx('TX-20008', '2026-10-21T15:52:00Z', 'ACC-2100', 'ACC-2202', 18_000, 'Personal transfer'),
    tx('TX-20009', '2026-10-21T17:05:00Z', 'ACC-2100', 'ACC-2203', 17_850, 'Invoice 7782'),
  ];
  const ctx = tx('TX-20010', '2026-09-29T09:30:00Z', 'ACC-2290', 'ACC-2100', 120, 'Initial deposit', false);
  return finalizeCase({
    id: 'C-002',
    title: 'Rapid fan-in / fan-out through a newly opened account',
    accounts,
    transactions: [ctx, ...inflows, ...outflows],
    indicators: [fanIn(inflows), fanOut(outflows, inflows), nearThreshold(inflows), newAccount(collector, inflows[0])],
  });
}

function caseC003(): CaseDetail {
  const accounts = [
    account('ACC-3000', 'business', 'source', '2022-01-17'),
    account('ACC-3001', 'business', 'intermediary', '2025-03-08'),
    account('ACC-3101', 'personal', 'destination', '2021-09-12'),
    account('ACC-3102', 'personal', 'destination', '2023-04-25'),
    account('ACC-3103', 'personal', 'destination', '2020-06-30', 'GB'),
    account('ACC-3104', 'personal', 'destination', '2024-02-02'),
    account('ACC-3105', 'personal', 'destination', '2026-05-21'),
    account('ACC-3190', 'business', 'context', '2016-10-10'),
  ];
  const inbound = tx('TX-30001', '2026-10-25T09:05:00Z', 'ACC-3000', 'ACC-3001', 24_000, 'Invoice settlement');
  const outflows = [
    tx('TX-30002', '2026-10-25T09:40:00Z', 'ACC-3001', 'ACC-3101', 4_700, 'Contractor fee'),
    tx('TX-30003', '2026-10-25T09:58:00Z', 'ACC-3001', 'ACC-3102', 4_750, 'Contractor fee'),
    tx('TX-30004', '2026-10-25T10:21:00Z', 'ACC-3001', 'ACC-3103', 4_650, 'Contractor fee'),
    tx('TX-30005', '2026-10-25T10:44:00Z', 'ACC-3001', 'ACC-3104', 4_700, 'Contractor fee'),
    tx('TX-30006', '2026-10-25T11:10:00Z', 'ACC-3001', 'ACC-3105', 4_720, 'Contractor fee'),
  ];
  const ctx = tx('TX-30007', '2026-10-20T14:00:00Z', 'ACC-3001', 'ACC-3190', 1_150, 'Office rent', false);
  return finalizeCase({
    id: 'C-003',
    title: 'Single inflow rapidly split across five accounts',
    accounts,
    transactions: [ctx, inbound, ...outflows],
    indicators: [fanOut(outflows), indicator('rapid_pass_through', [passThroughPoint(inbound, outflows)])],
  });
}

function caseC004(): CaseDetail {
  const accounts = [
    account('ACC-4001', 'personal', 'origin', '2023-07-03'),
    account('ACC-4002', 'personal', 'intermediary', '2024-09-15'),
    account('ACC-4003', 'personal', 'intermediary', '2022-02-27'),
  ];
  const hops = [
    tx('TX-40001', '2026-10-27T08:00:00Z', 'ACC-4001', 'ACC-4002', 3_200, 'Shared holiday'),
    tx('TX-40002', '2026-10-28T22:30:00Z', 'ACC-4002', 'ACC-4003', 3_110, 'Payback'),
    tx('TX-40003', '2026-10-30T06:45:00Z', 'ACC-4003', 'ACC-4001', 3_020, 'Settle up'),
  ];
  return finalizeCase({
    id: 'C-004',
    title: 'Three-account circular transfers',
    accounts,
    transactions: hops,
    indicators: [circularFlow(hops)],
  });
}

export const MOCK_CASES: CaseDetail[] = [caseC001(), caseC002(), caseC003(), caseC004()].sort(
  (a, b) => b.priorityScore - a.priorityScore,
);
