// Data-access layer. Today it serves synthetic mock data; replace these function bodies with
// fetch calls to the backend API later, keeping the same signatures for the UI.
//
// Demo state switches via the URL: ?mock=empty | error | case-error | report-error
import type { CaseDetail, CaseSummary, DraftReport } from './types';
import { MOCK_CASES } from './mockData';
import { buildDraftReport } from './reportTemplate';

export const DATA_SOURCE_LABEL = 'Demo — synthetic data';

type MockScenario = 'default' | 'empty' | 'error' | 'case-error' | 'report-error';

function scenario(): MockScenario {
  const value = new URLSearchParams(window.location.search).get('mock');
  const known: MockScenario[] = ['empty', 'error', 'case-error', 'report-error'];
  return known.includes(value as MockScenario) ? (value as MockScenario) : 'default';
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toSummary(c: CaseDetail): CaseSummary {
  return {
    id: c.id,
    title: c.title,
    priorityScore: c.priorityScore,
    priority: c.priority,
    indicatorTypes: c.indicatorTypes,
    accountCount: c.accountCount,
    evidenceTransactionCount: c.evidenceTransactionCount,
    evidenceVolume: c.evidenceVolume,
    currency: c.currency,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
  };
}

function findCase(caseId: string): CaseDetail {
  const found = MOCK_CASES.find((c) => c.id === caseId);
  if (!found) throw new Error(`Case ${caseId} was not found.`);
  return found;
}

export async function listCases(): Promise<CaseSummary[]> {
  await delay(600);
  const mode = scenario();
  if (mode === 'error') throw new Error('The case list could not be loaded (simulated error).');
  if (mode === 'empty') return [];
  return MOCK_CASES.map(toSummary);
}

export async function getCase(caseId: string): Promise<CaseDetail> {
  await delay(400);
  if (scenario() === 'case-error') throw new Error(`Case ${caseId} could not be loaded (simulated error).`);
  return findCase(caseId);
}

export async function generateDraftReport(caseId: string): Promise<DraftReport> {
  await delay(900);
  if (scenario() === 'report-error') throw new Error('The draft report could not be generated (simulated error).');
  return buildDraftReport(findCase(caseId));
}
