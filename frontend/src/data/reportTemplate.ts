// Template-based draft report built only from the selected case's data. No AI service is involved.
import type { CaseDetail, DraftReport } from './types';
import { formatDateTime, formatMoney } from '../lib/format';
import { ROLE_LABELS } from '../lib/indicators';

export function buildDraftReport(c: CaseDetail): DraftReport {
  const evidence = c.transactions.filter((t) => t.isEvidence);
  const money = (n: number) => formatMoney(n, c.currency);
  const patternAccounts = c.accounts.filter((a) => a.role !== 'context');

  return {
    caseId: c.id,
    generatedAt: new Date().toISOString(),
    method: 'template',
    evidenceTransactionIds: evidence.map((t) => t.id),
    sections: [
      {
        heading: '1. Case overview',
        paragraphs: [
          `Case ${c.id} (“${c.title}”) was surfaced by the sample detection rules on synthetic demo data with a priority score of ${c.priorityScore}/100 (${c.priority}).`,
          `It involves ${c.accountCount} accounts and ${c.evidenceTransactionCount} evidence transactions totalling ${money(c.evidenceVolume)}, between ${formatDateTime(c.windowStart)} and ${formatDateTime(c.windowEnd)}.`,
        ],
      },
      {
        heading: '2. Indicators observed',
        paragraphs: c.indicators.flatMap((i) => [
          `${i.title}. Rule: ${i.rule}`,
          ...i.points.map((p) => `• ${p.text}`),
        ]),
      },
      {
        heading: '3. Accounts and roles in the pattern',
        paragraphs: patternAccounts.map(
          (a) => `• ${a.id}: ${ROLE_LABELS[a.role]}, ${a.accountType} account, ${a.country}, opened ${a.openedOn}.`,
        ),
      },
      {
        heading: '4. Transaction evidence',
        paragraphs: ['The evidence transactions are listed in the table below, in chronological order.'],
      },
      {
        heading: '5. Limitations',
        paragraphs: [
          'These are indicators that warrant review, not proof of money laundering or any other criminal activity. Legitimate explanations should be considered.',
          'This draft was generated from a fixed template using only this case’s synthetic demo data. No customer due diligence records, external sources or AI services were consulted.',
        ],
      },
      {
        heading: '6. Analyst assessment',
        paragraphs: ['[To be completed by the reviewing analyst before any further action.]'],
      },
    ],
  };
}
