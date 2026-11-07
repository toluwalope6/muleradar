// Data-access layer used by the UI. Two explicitly selected sources:
//   live (default): the MuleRadar backend API, see ./backend.ts
//   mock: bundled synthetic demo cases
// Select with ?source=live|mock or VITE_DATA_SOURCE. A failed live request is shown as an error;
// it never falls back to mock data.
//
// Mock demo states via the URL: ?mock=empty | error | case-error | report-error (implies mock source)
import type { CaseDetail, CaseSummary, DraftReport } from './types';
import { MOCK_CASES } from './mockData';
import { buildDraftReport } from './reportTemplate';
import { fetchCase, fetchCases, fetchReport } from './backend';

export type DataSource = 'live' | 'mock';

function selectSource(): DataSource {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('source') ?? (params.has('mock') ? 'mock' : null) ?? import.meta.env.VITE_DATA_SOURCE;
  return requested === 'mock' ? 'mock' : 'live';
}

export const DATA_SOURCE: DataSource = selectSource();

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
  if (DATA_SOURCE === 'live') return fetchCases();
  await delay(600);
  const mode = scenario();
  if (mode === 'error') throw new Error('The case list could not be loaded (simulated error).');
  if (mode === 'empty') return [];
  return MOCK_CASES.map(toSummary);
}

export async function getCase(caseId: string): Promise<CaseDetail> {
  if (DATA_SOURCE === 'live') return fetchCase(caseId);
  await delay(400);
  if (scenario() === 'case-error') throw new Error(`Case ${caseId} could not be loaded (simulated error).`);
  return findCase(caseId);
}

export async function generateDraftReport(caseId: string): Promise<DraftReport> {
  if (DATA_SOURCE === 'live') return fetchReport(caseId);
  await delay(900);
  if (scenario() === 'report-error') throw new Error('The draft report could not be generated (simulated error).');
  return buildDraftReport(findCase(caseId));
}
