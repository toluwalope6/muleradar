// Provisional frontend types for the mock data layer.
// These are NOT an agreed backend contract; map backend responses onto them in src/data/api.ts.

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
  accountType: 'personal' | 'business';
  country: string;
  openedOn: string;
  role: AccountRole;
}

export interface Transaction {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  reference: string;
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
  evidenceTransactionCount: number;
  evidenceVolume: number;
  currency: string;
  windowStart: string;
  windowEnd: string;
}

export interface CaseDetail extends CaseSummary {
  accounts: Account[];
  transactions: Transaction[];
  indicators: Indicator[];
  scoreComponents: ScoreComponent[];
}

export interface ReportSection {
  heading: string;
  paragraphs: string[];
}

export interface DraftReport {
  caseId: string;
  generatedAt: string;
  method: 'template';
  sections: ReportSection[];
  evidenceTransactionIds: string[];
}
