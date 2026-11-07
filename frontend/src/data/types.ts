// Frontend view model shared by the synthetic mock data and the live backend.
// Backend responses are mapped onto these types in src/data/backend.ts; fields the backend does not
// provide are optional rather than filled in.

export type IndicatorType =
  | 'circular_flow'
  | 'rapid_fan_in'
  | 'rapid_fan_out'
  | 'rapid_pass_through'
  | 'near_threshold_amounts'
  | 'new_account';

export type AccountRole = 'origin' | 'source' | 'collector' | 'intermediary' | 'destination' | 'context';

export type Priority = 'high' | 'medium' | 'low';

export interface Account {
  id: string;
  label: string;
  accountType?: 'personal' | 'business';
  country?: string;
  openedOn?: string;
  role: AccountRole;
  /** Role and account score exactly as returned by the backend (live mode only). */
  backendRole?: string;
  backendRiskScore?: number;
}

export interface Transaction {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  reference?: string;
  /** Backend timeline description for this transfer (live mode only). */
  note?: string;
  isEvidence: boolean;
}

export interface ExplanationPoint {
  text: string;
  transactionIds: string[];
}

export interface Indicator {
  type: IndicatorType;
  title: string;
  rule: string;
  points: ExplanationPoint[];
  transactionIds: string[];
}

export interface ScoreComponent {
  label: string;
  points: number;
}

export interface CaseSummary {
  id: string;
  title: string;
  priorityScore: number;
  priority: Priority;
  indicatorTypes: IndicatorType[];
  accountCount: number;
  evidenceTransactionCount?: number;
  evidenceVolume?: number;
  currency: string;
  windowStart?: string;
  windowEnd?: string;
}

export interface GroundTruthMatch {
  schemeType: string;
  matchScore: number;
  typeCorrect: boolean | null;
}

export interface CaseDetail extends CaseSummary {
  evidenceTransactionCount: number;
  evidenceVolume: number;
  windowStart: string;
  windowEnd: string;
  /** Backend scheme type and summary, shown verbatim (live mode only). */
  schemeType?: string;
  backendSummary?: string;
  groundTruth?: GroundTruthMatch | null;
  accounts: Account[];
  transactions: Transaction[];
  indicators: Indicator[];
  scoreComponents: ScoreComponent[];
}

export interface ReportSection {
  heading: string;
  paragraphs: string[];
}

export interface TemplateReport {
  kind: 'sections';
  caseId: string;
  generatedAt: string;
  method: 'template';
  sections: ReportSection[];
  evidenceTransactionIds: string[];
}

/** Markdown report returned by the backend's POST /cases/{id}/report. */
export interface BackendReport {
  kind: 'markdown';
  caseId: string;
  generatedAt: string;
  /** "template", or the AI provider the backend used (e.g. "openai", "anthropic"). */
  generatedBy: string;
  markdown: string;
}

export type DraftReport = TemplateReport | BackendReport;

/** Detection evaluation against the dataset's labels, as computed by the backend (live mode only). */
export interface Evaluation {
  precision: number;
  recall: number;
  schemesFound: number;
  schemesTotal: number;
  schemeTypeAccuracy: number;
  transactions?: number;
  labelledLaundering?: number;
  flaggedTransactions?: number;
}
