// Live data source: the MuleRadar FastAPI backend (backend/main.py).
// Responses are mapped onto the frontend view model without inventing missing fields.
import type { Account, AccountRole, BackendReport, CaseDetail, CaseSummary, Evaluation, Indicator, IndicatorType, Transaction } from './types';
import { INDICATOR_LABELS, priorityForScore } from '../lib/indicators';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';

interface ApiCaseSummary {
  id: string;
  risk_score: number;
  scheme_type: string;
  account_count: number;
  total_amount: number;
  duration_hours: number;
  summary: string;
  currency?: string;
}

interface ApiNode {
  id: string;
  role: string;
  risk_score: number;
}

interface ApiEdge {
  tx_id?: string;
  source: string;
  target: string;
  amount: number;
  currency?: string;
  timestamp: string;
  flagged?: boolean;
}

interface ApiTimelineStep {
  step: number;
  tx_id?: string;
  timestamp: string;
  from: string;
  to: string;
  amount: number;
  description: string;
}

interface ApiIndicator {
  detector: string;
  reason: string;
  accounts: string[];
  tx_ids: string[];
}

interface ApiCaseDetail {
  id: string;
  risk_score: number;
  scheme_type: string;
  summary: string;
  nodes: ApiNode[];
  edges: ApiEdge[];
  timeline: ApiTimelineStep[];
  ground_truth: { scheme_type: string; account_ids: string[] } | null;
  match_score: number;
  type_correct: boolean | null;
  currency?: string;
  indicators?: ApiIndicator[];
}

export class MissingFieldError extends Error {}

const SCHEME_TITLES: Record<string, string> = {
  CYCLE: 'Circular flow',
  'FAN-IN': 'Fan-in to one account',
  'FAN-OUT': 'Fan-out from one account',
  'SCATTER-GATHER': 'Scatter, then gather',
  'GATHER-SCATTER': 'Gather, then scatter',
  STACK: 'Layered chain of transfers',
};

const DETECTORS: Record<string, { type: IndicatorType; rule: string }> = {
  cycle: { type: 'circular_flow', rule: 'Backend cycle detector: a time-ordered loop of 3–6 transfers, each keeping roughly the previous amount.' },
  fan_in: { type: 'rapid_fan_in', rule: 'Backend fan-in detector: one account receiving from many distinct accounts within 24h.' },
  fan_out: { type: 'rapid_fan_out', rule: 'Backend fan-out detector: one account paying many distinct accounts within 24h.' },
  pass_through: { type: 'rapid_pass_through', rule: 'Backend pass-through detector: most of an inflow sent on within 48h.' },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new Error(`Could not reach the MuleRadar backend at ${API_BASE_URL}. Check that it is running.`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Backend returned ${res.status}${detail ? `: ${detail}` : ''} (${path}).`);
  }
  return (await res.json()) as T;
}

/** Backend timestamps carry no offset; they are treated as UTC, matching how the UI labels times. */
const utc = (ts: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);

const titleFor = (schemeType: string) => SCHEME_TITLES[schemeType] ?? schemeType;

// The cycle's start is derived from the cited transfers (findCycle), so "source" is not mapped to "origin".
function roleFor(role: string): AccountRole {
  if (role === 'source') return 'source';
  if (role === 'mule') return 'intermediary';
  if (role === 'destination') return 'destination';
  return 'context';
}

export function mapSummary(s: ApiCaseSummary): CaseSummary {
  return {
    id: s.id,
    title: titleFor(s.scheme_type),
    priorityScore: s.risk_score,
    priority: priorityForScore(s.risk_score),
    indicatorTypes: [],
    accountCount: s.account_count,
    currency: s.currency ?? 'USD',
  };
}

export function mapDetail(d: ApiCaseDetail): CaseDetail {
  if (d.edges.some((e) => !e.tx_id) || !d.indicators) {
    throw new MissingFieldError(
      'The backend response is missing transaction IDs or detector evidence (edges[].tx_id, edges[].flagged, indicators). Update the backend to the integration branch.',
    );
  }
  const currency = d.currency ?? 'USD';
  const notes = new Map(d.timeline.filter((s) => s.tx_id).map((s) => [s.tx_id!, s.description]));
  const transactions: Transaction[] = d.edges.map((e) => ({
    id: e.tx_id!,
    timestamp: utc(e.timestamp),
    from: e.source,
    to: e.target,
    amount: e.amount,
    currency: e.currency ?? currency,
    note: notes.get(e.tx_id!),
    isEvidence: Boolean(e.flagged),
  }));
  const accounts: Account[] = d.nodes.map((n) => ({
    id: n.id,
    label: n.id,
    role: roleFor(n.role),
    backendRole: n.role,
    backendRiskScore: n.risk_score,
  }));

  const grouped = new Map<string, ApiIndicator[]>();
  for (const hit of d.indicators) grouped.set(hit.detector, [...(grouped.get(hit.detector) ?? []), hit]);
  const indicators: Indicator[] = [...grouped].map(([detector, hits]) => {
    const known = DETECTORS[detector];
    return {
      type: known?.type ?? (detector as IndicatorType),
      title: known ? INDICATOR_LABELS[known.type] : detector,
      rule: known?.rule ?? `Backend detector “${detector}”.`,
      points: hits.map((h) => ({ text: h.reason, transactionIds: h.tx_ids })),
      transactionIds: [...new Set(hits.flatMap((h) => h.tx_ids))],
    };
  });

  const flagged = transactions.filter((t) => t.isEvidence).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const window = flagged.length ? flagged : [...transactions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    id: d.id,
    title: titleFor(d.scheme_type),
    priorityScore: d.risk_score,
    priority: priorityForScore(d.risk_score),
    indicatorTypes: indicators.map((i) => i.type),
    accountCount: d.nodes.length,
    evidenceTransactionCount: flagged.length,
    evidenceVolume: flagged.reduce((s, t) => s + t.amount, 0),
    currency,
    windowStart: window[0]?.timestamp ?? '',
    windowEnd: window[window.length - 1]?.timestamp ?? '',
    schemeType: d.scheme_type,
    backendSummary: d.summary,
    groundTruth: d.ground_truth
      ? { schemeType: d.ground_truth.scheme_type, matchScore: d.match_score, typeCorrect: d.type_correct }
      : null,
    accounts,
    transactions,
    indicators,
    scoreComponents: [],
  };
}

export async function fetchCases(): Promise<CaseSummary[]> {
  return (await request<ApiCaseSummary[]>('/cases')).map(mapSummary);
}

export async function fetchCase(caseId: string): Promise<CaseDetail> {
  return mapDetail(await request<ApiCaseDetail>(`/cases/${encodeURIComponent(caseId)}`));
}

export async function fetchReport(caseId: string): Promise<BackendReport> {
  const body = await request<{ report: string; generated_by?: string }>(`/cases/${encodeURIComponent(caseId)}/report`, { method: 'POST' });
  return {
    kind: 'markdown',
    caseId,
    generatedAt: new Date().toISOString(),
    generatedBy: body.generated_by ?? 'unknown',
    markdown: body.report,
  };
}

interface ApiMetrics {
  precision: number;
  recall: number;
  schemes_found: number;
  schemes_total: number;
  scheme_type_accuracy: number;
  transactions?: number;
  labelled_laundering?: number;
  flagged_transactions?: number;
  true_positive_transactions?: number;
  schemes_type_correct?: number;
  scheme_match_threshold?: number;
  laundering_in_schemes?: number;
  dataset?: string | null;
  dataset_requested?: string | null;
}

export interface LoadedDataset {
  /** "ibm" or "synthetic", or null if the backend doesn't know. */
  source: string | null;
  /** True when IBM data was requested but synthetic data was generated instead. */
  fallback: boolean;
}

export async function fetchLoadedDataset(): Promise<LoadedDataset> {
  const m = await request<ApiMetrics>('/metrics');
  const source = m.dataset ?? null;
  return { source, fallback: source === 'synthetic' && m.dataset_requested === 'ibm' };
}

/** Returns null when the backend has no labelled data to evaluate against. */
export async function fetchMetrics(): Promise<Evaluation | null> {
  const m = await request<ApiMetrics>('/metrics');
  if (!m.schemes_total && !m.labelled_laundering) return null;
  return {
    precision: m.precision,
    recall: m.recall,
    schemesFound: m.schemes_found,
    schemesTotal: m.schemes_total,
    schemeTypeAccuracy: m.scheme_type_accuracy,
    transactions: m.transactions,
    labelledLaundering: m.labelled_laundering,
    flaggedTransactions: m.flagged_transactions,
    truePositiveTransactions: m.true_positive_transactions,
    schemesTypeCorrect: m.schemes_type_correct,
    schemeMatchThreshold: m.scheme_match_threshold,
    launderingInSchemes: m.laundering_in_schemes,
    dataset: m.dataset,
  };
}
