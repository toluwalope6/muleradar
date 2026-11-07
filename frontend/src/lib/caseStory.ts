// Plain-English case narrative derived only from the selected case's accounts and transactions.
import type { Account, CaseDetail, Transaction } from '../data/types';
import { formatDate, formatDateTime, formatDuration, formatMoneyWhole, formatPercent, hoursBetween } from './format';

export type StoryKind = 'circular' | 'collect-distribute' | 'other';

export interface StoryPoint {
  title: string;
  text: string;
  transactionIds: string[];
}

export interface AmountFact {
  label: string;
  value: number;
  note: string;
}

export interface CaseStory {
  kind: StoryKind;
  headline: string;
  /** Two short sentences. */
  whatHappened: string[];
  /** Directional amounts (sent, returned, incoming, outgoing); never a sum of every transfer. */
  amounts: AmountFact[];
  whyItMatters: string;
  whyReview: StoryPoint[];
}

export interface CaseFacts {
  flaggedTransfers: Transaction[];
  contextTransfers: Transaction[];
  flaggedAccounts: Account[];
  contextAccounts: Account[];
  totalFlagged: number;
}

const byTime = (txs: Transaction[]) => [...txs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
const sum = (txs: Transaction[]) => txs.reduce((total, t) => total + t.amount, 0);
const ids = (txs: Transaction[]) => txs.map((t) => t.id);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWords = (n: number, word: string) => `${NUMBER_WORDS[n] ?? n} ${word}${n === 1 ? '' : 's'}`;

export function caseFacts(c: CaseDetail): CaseFacts {
  const flaggedTransfers = byTime(c.transactions.filter((t) => t.isEvidence));
  const flaggedIds = new Set(flaggedTransfers.flatMap((t) => [t.from, t.to]));
  return {
    flaggedTransfers,
    contextTransfers: byTime(c.transactions.filter((t) => !t.isEvidence)),
    flaggedAccounts: c.accounts.filter((a) => flaggedIds.has(a.id)),
    contextAccounts: c.accounts.filter((a) => !flaggedIds.has(a.id)),
    totalFlagged: sum(flaggedTransfers),
  };
}

/** Follows a circular-flow indicator's transfers (or all flagged transfers) until funds return to their start. */
export function findCycle(c: CaseDetail): Transaction[] | null {
  if (!c.indicatorTypes.includes('circular_flow')) return null;
  for (const point of c.indicators.find((i) => i.type === 'circular_flow')?.points ?? []) {
    const hops = byTime(c.transactions.filter((t) => point.transactionIds.includes(t.id)));
    const closes = hops.length >= 2 && hops.every((h, i) => i === 0 || hops[i - 1].to === h.from) && hops[hops.length - 1].to === hops[0].from;
    if (closes) return hops;
  }
  const flagged = caseFacts(c).flaggedTransfers;
  if (flagged.length === 0) return null;
  const start = c.accounts.find((a) => a.role === 'origin')?.id ?? flagged[0].from;
  const hops: Transaction[] = [];
  let current = start;
  let after = '';
  while (hops.length < flagged.length) {
    const next = flagged.find((t) => t.from === current && t.timestamp >= after && !hops.includes(t));
    if (!next) break;
    hops.push(next);
    current = next.to;
    after = next.timestamp;
    if (current === start) return hops;
  }
  return null;
}

function hubAccount(c: CaseDetail, flagged: Transaction[]): string | null {
  const counts = new Map<string, number>();
  for (const t of flagged) {
    counts.set(t.from, (counts.get(t.from) ?? 0) + 1);
    counts.set(t.to, (counts.get(t.to) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const a of c.accounts) {
    if ((counts.get(a.id) ?? 0) > (best ? counts.get(best)! : 1)) best = a.id;
  }
  return best;
}

function circularStory(c: CaseDetail, hops: Transaction[]): CaseStory {
  const money = (n: number) => formatMoneyWhole(n, c.currency);
  const first = hops[0];
  const last = hops[hops.length - 1];
  const start = first.from;
  const relays = hops.length - 1;
  const loopTime = formatDuration(first.timestamp, last.timestamp);
  const returned = formatPercent(last.amount / first.amount);
  const holds = hops.slice(1).map((h, i) => hoursBetween(hops[i].timestamp, h.timestamp));
  const longestHold = hops.slice(1).reduce(
    (best, h, i) => (holds[i] > best.hours ? { hours: holds[i], from: hops[i].timestamp, to: h.timestamp } : best),
    { hours: -1, from: first.timestamp, to: first.timestamp },
  );
  const ratios = hops.slice(1).map((h, i) => h.amount / hops[i].amount);
  const minRatio = formatPercent(Math.min(...ratios));
  const maxRatio = formatPercent(Math.max(...ratios));
  const references = hops.map((h) => h.reference).filter((r): r is string => Boolean(r));

  const whyReview: StoryPoint[] = [
    {
      title: 'Most of the amount sent came back to where it started',
      text: `${money(last.amount)} of the ${money(first.amount)} sent from ${start} returned to it ${loopTime} later (${returned}).`,
      transactionIds: [first.id, last.id],
    },
    {
      title: 'Each account passed it on quickly',
      text: `No account held the funds for longer than ${formatDuration(longestHold.from, longestHold.to)}, and each transfer was ${
        minRatio === maxRatio ? minRatio : `${minRatio}–${maxRatio}`
      } of the one before.`,
      transactionIds: ids(hops),
    },
  ];
  if (references.length === hops.length && new Set(references).size === references.length && hops.length >= 3) {
    whyReview.push({
      title: 'Each step has a different payment reference',
      text: references.map((r) => `“${r}”`).join(', ') + ', while the amount stays almost the same.',
      transactionIds: ids(hops),
    });
  }

  return {
    kind: 'circular',
    headline: `${money(first.amount)} sent through ${countWords(hops.length, 'account')}; ${money(last.amount)} returned`,
    whatHappened: [
      `${start} sent ${money(first.amount)} on ${formatDate(first.timestamp)}, and it was passed on through ${plural(relays, 'other account')}.`,
      `${loopTime} later, ${money(last.amount)} returned to ${start}: ${returned} of the amount sent.`,
    ],
    amounts: [
      { label: `Sent from ${start}`, value: first.amount, note: `First transfer in the loop (${first.id}), ${formatDateTime(first.timestamp)}` },
      { label: `Returned to ${start}`, value: last.amount, note: `Last transfer in the loop (${last.id}), ${formatDateTime(last.timestamp)}` },
    ],
    whyItMatters:
      'Money that returns to its starting point through other accounts can make the same funds look like several separate payments. There may be a legitimate explanation, such as an internal settlement.',
    whyReview,
  };
}

function collectDistributeStory(c: CaseDetail, hub: string, flagged: Transaction[]): CaseStory {
  const money = (n: number) => formatMoneyWhole(n, c.currency);
  const inflows = byTime(flagged.filter((t) => t.to === hub));
  const outflows = byTime(flagged.filter((t) => t.from === hub));
  const senders = new Set(inflows.map((t) => t.from)).size;
  const recipients = new Set(outflows.map((t) => t.to)).size;
  const inSum = sum(inflows);
  const outSum = sum(outflows);
  const lastIn = inflows[inflows.length - 1];
  const lastOut = outflows[outflows.length - 1];
  const onward = inSum > 0 ? formatPercent(outSum / inSum) : null;
  const onwardTime = lastIn && lastOut ? formatDuration(lastIn.timestamp, lastOut.timestamp) : null;
  const hubAccount = c.accounts.find((a) => a.id === hub);
  const openedOn = hubAccount?.openedOn;
  const ageDays = openedOn && inflows[0] ? Math.floor(hoursBetween(openedOn, inflows[0].timestamp) / 24) : null;

  const whatHappened: string[] = [];
  if (inflows.length > 1) {
    whatHappened.push(
      `${hub} received ${inflows.length} payments totalling ${money(inSum)} over ${formatDuration(inflows[0].timestamp, lastIn.timestamp)} on ${formatDate(inflows[0].timestamp)}.`,
    );
  } else if (lastIn) {
    whatHappened.push(`${hub} received ${money(lastIn.amount)} from ${lastIn.from} on ${formatDateTime(lastIn.timestamp)}.`);
  }
  if (inflows.length === 0 && outflows.length > 0) {
    whatHappened.push(
      `${hub} sent ${plural(outflows.length, 'payment')} totalling ${money(outSum)} to ${plural(recipients, 'account')} over ${formatDuration(outflows[0].timestamp, lastOut.timestamp)}, starting ${formatDate(outflows[0].timestamp)}.`,
      'No flagged incoming payment to this account appears in the case.',
    );
  }
  if (outflows.length > 0 && onward && onwardTime) {
    whatHappened.push(
      `Within ${onwardTime}${inflows.length > 1 ? ' of the last one' : ''}, it sent ${money(outSum)} to ${plural(recipients, 'account')}, equal to ${onward} of the incoming amount.`,
    );
  }

  const whyReview: StoryPoint[] = [];
  if (onward && onwardTime) {
    whyReview.push({
      title: outSum > inSum ? 'It paid out more than its flagged incoming payments' : 'Most of the incoming amount was paid out quickly',
      text: `Outgoing payments of ${money(outSum)} equal ${onward} of the ${money(inSum)} received; the last one left within ${onwardTime} of the ${
        inflows.length > 1 ? 'final incoming payment' : 'payment arriving'
      }.`,
      transactionIds: ids([...inflows, ...outflows]),
    });
  }
  if (c.indicatorTypes.includes('near_threshold_amounts') && inflows.length > 1) {
    const amounts = inflows.map((t) => t.amount);
    const max = Math.max(...amounts);
    const roundAbove = Math.ceil((max + 1) / 1000) * 1000;
    whyReview.push({
      title: `Incoming payments sat just under ${money(roundAbove)}`,
      text: `All ${inflows.length} were between ${money(Math.min(...amounts))} and ${money(max)}.`,
      transactionIds: ids(inflows),
    });
  }
  if (c.indicatorTypes.includes('new_account') && openedOn && ageDays !== null) {
    whyReview.push({
      title: 'The receiving account was new',
      text: `${hub} was opened on ${formatDate(openedOn)}, ${plural(ageDays, 'day')} before the first payment arrived.`,
      transactionIds: inflows[0] ? [inflows[0].id] : [],
    });
  }
  if (recipients >= 3 && outflows.length > 0) {
    const amounts = outflows.map((t) => t.amount);
    whyReview.push({
      title: `Split across ${recipients} recipients in similar amounts`,
      text: `Each outgoing payment was between ${money(Math.min(...amounts))} and ${money(Math.max(...amounts))}, sent over ${formatDuration(outflows[0].timestamp, lastOut.timestamp)}.`,
      transactionIds: ids(outflows),
    });
  }

  const headline =
    inflows.length === 0
      ? `${money(outSum)} out to ${countWords(recipients, 'account')}`
      : outflows.length > 0
      ? `${money(inSum)} in from ${countWords(senders, 'account')}; ${money(outSum)} out to ${countWords(recipients, 'account')}`
      : `${money(inSum)} in from ${countWords(senders, 'account')}`;
  for (const point of detectorPoints(c)) {
    if (whyReview.length >= 2) break;
    whyReview.push(point);
  }
  const amounts: AmountFact[] = [];
  if (inflows.length > 0) {
    amounts.push({ label: `Incoming to ${hub}`, value: inSum, note: `${plural(inflows.length, 'flagged payment')} from ${plural(senders, 'account')}` });
  }
  if (outflows.length > 0) {
    amounts.push({ label: `Outgoing from ${hub}`, value: outSum, note: `${plural(outflows.length, 'flagged payment')} to ${plural(recipients, 'account')}` });
  }

  return {
    kind: 'collect-distribute',
    headline,
    whatHappened,
    amounts,
    whyItMatters:
      inflows.length > 1
        ? 'An account that collects from several accounts and quickly pays most of it out can be passing on other people’s funds. It can also have ordinary explanations.'
        : 'Quickly dividing one large payment between several accounts can be a way to break funds into smaller amounts. It can also have ordinary explanations, such as paying contractors.',
    whyReview: whyReview.slice(0, 3),
  };
}

/** Detector findings as review points, used when the transfer pattern alone gives fewer than two. */
function detectorPoints(c: CaseDetail): StoryPoint[] {
  return c.indicators.flatMap((i) => i.points.slice(0, 1).map((p) => ({ title: i.title, text: p.text, transactionIds: p.transactionIds })));
}

export function buildCaseStory(c: CaseDetail): CaseStory {
  const cycle = findCycle(c);
  if (cycle) return circularStory(c, cycle);
  const flagged = caseFacts(c).flaggedTransfers;
  const hub = hubAccount(c, flagged);
  if (hub) return collectDistributeStory(c, hub, flagged);
  return {
    kind: 'other',
    headline: c.title,
    whatHappened: c.indicators.slice(0, 2).flatMap((i) => i.points.slice(0, 1).map((p) => p.text)),
    amounts: [],
    whyItMatters: 'These transfers matched sample review rules. Matching a rule is a reason to look closer, not proof of wrongdoing.',
    whyReview: c.indicators.slice(0, 3).map((i) => ({
      title: i.title,
      text: i.points[0]?.text ?? i.rule,
      transactionIds: i.transactionIds,
    })),
  };
}

/** Short graph labels such as "Sender 2" or "Relay 1"; the full ID is shown on selection. */
export function accountShortLabels(c: CaseDetail): Record<string, string> {
  const labels: Record<string, string> = {};
  const cycle = findCycle(c);
  if (cycle) {
    labels[cycle[0].from] = 'Start / end';
    cycle.slice(1).forEach((h, i) => (labels[h.from] = `Relay ${i + 1}`));
  }
  const firstSeen = (id: string) =>
    byTime(c.transactions.filter((t) => t.from === id || t.to === id))[0]?.timestamp ?? '';
  const base: Record<Account['role'], string> = {
    origin: 'Start / end',
    source: 'Sender',
    collector: 'Collector',
    intermediary: 'Pass-through',
    destination: 'Recipient',
    context: 'Other account',
  };
  const facts = caseFacts(c);
  const groups = new Map<string, Account[]>();
  for (const a of c.accounts) {
    if (labels[a.id]) continue;
    const role = facts.contextAccounts.includes(a) ? 'context' : a.role;
    groups.set(role, [...(groups.get(role) ?? []), a]);
  }
  for (const [role, accounts] of groups) {
    const sorted = [...accounts].sort((x, y) => firstSeen(x.id).localeCompare(firstSeen(y.id)) || x.id.localeCompare(y.id));
    sorted.forEach((a, i) => {
      labels[a.id] = sorted.length === 1 ? base[role as Account['role']] : `${base[role as Account['role']]} ${i + 1}`;
    });
  }
  return labels;
}
