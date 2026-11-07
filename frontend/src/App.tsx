import { useCallback, useEffect, useState } from 'react';
import { DATA_SOURCE_LABEL, generateDraftReport, getCase, listCases } from './data/api';
import type { CaseDetail, CaseSummary, DraftReport } from './data/types';
import { errorMessage, type AsyncState } from './lib/async';
import type { Selection } from './lib/selection';
import { CaseList } from './components/CaseList';
import { CaseGraph } from './components/CaseGraph';
import { CaseSummaryCard } from './components/CaseSummaryCard';
import { EvidencePanel } from './components/EvidencePanel';
import { ReportPanel } from './components/ReportPanel';
import { TransactionTable } from './components/TransactionTable';
import { WhyFlaggedPanel } from './components/WhyFlaggedPanel';
import { EmptyState, ErrorState, SkeletonLines } from './components/StateViews';

type Tab = 'evidence' | 'why' | 'report';

const TABS: { id: Tab; label: string }[] = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'why', label: 'Why flagged?' },
  { id: 'report', label: 'Draft report' },
];

export default function App() {
  const [cases, setCases] = useState<AsyncState<CaseSummary[]>>({ status: 'idle' });
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseState, setCaseState] = useState<AsyncState<CaseDetail>>({ status: 'idle' });
  const [caseReloadKey, setCaseReloadKey] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('why');
  const [reports, setReports] = useState<Record<string, AsyncState<DraftReport>>>({});

  const loadCases = useCallback(() => {
    setCases({ status: 'loading' });
    listCases()
      .then((data) => {
        setCases({ status: 'success', data });
        setSelectedCaseId((current) => current ?? data[0]?.id ?? null);
      })
      .catch((err) => setCases({ status: 'error', error: errorMessage(err) }));
  }, []);

  useEffect(loadCases, [loadCases]);

  useEffect(() => {
    if (!selectedCaseId) return;
    let cancelled = false;
    setCaseState({ status: 'loading' });
    setSelection(null);
    getCase(selectedCaseId)
      .then((data) => !cancelled && setCaseState({ status: 'success', data }))
      .catch((err) => !cancelled && setCaseState({ status: 'error', error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [selectedCaseId, caseReloadKey]);

  const generateReport = useCallback((caseId: string) => {
    setReports((r) => ({ ...r, [caseId]: { status: 'loading' } }));
    generateDraftReport(caseId)
      .then((data) => setReports((r) => ({ ...r, [caseId]: { status: 'success', data } })))
      .catch((err) => setReports((r) => ({ ...r, [caseId]: { status: 'error', error: errorMessage(err) } })));
  }, []);

  const selectFromGraph = useCallback((next: Selection) => {
    setSelection(next);
    if (next) setTab('evidence');
  }, []);

  const detail = caseState.status === 'success' ? caseState.data : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◎
          </span>
          <span className="brand-name">MuleRadar</span>
          <span className="brand-sub">Investigation dashboard</span>
        </div>
        <div className="topbar-right">
          <span className="disclaimer">Indicators only, not proof of wrongdoing · No AI service connected</span>
          <span className="demo-badge">{DATA_SOURCE_LABEL}</span>
        </div>
      </header>

      <main className="layout">
        <CaseList state={cases} selectedId={selectedCaseId} onSelect={setSelectedCaseId} onRetry={loadCases} />

        <section className="panel center" aria-label="Transaction network">
          {!selectedCaseId && cases.status === 'success' && (
            <EmptyState title="No case selected" detail="Choose a network from the list to inspect it." />
          )}
          {(caseState.status === 'loading' || (cases.status === 'loading' && !detail)) && (
            <div className="center-loading">
              <div className="graph-placeholder shimmer" />
              <SkeletonLines rows={4} />
            </div>
          )}
          {cases.status === 'error' && !detail && (
            <EmptyState title="No network to display" detail="The case list must load before a network can be shown." />
          )}
          {caseState.status === 'error' && (
            <ErrorState
              title="Couldn’t load this case"
              detail={caseState.error}
              onRetry={() => setCaseReloadKey((k) => k + 1)}
            />
          )}
          {detail && caseState.status === 'success' && (
            <>
              <div className="panel-header">
                <h2>
                  Transaction network <span className="mono dim">· {detail.id}</span>
                </h2>
                <span className="panel-sub">Click accounts or transfers to inspect evidence</span>
              </div>
              <CaseGraph caseDetail={detail} selection={selection} onSelect={selectFromGraph} />
              <TransactionTable transactions={detail.transactions} selection={selection} onSelect={selectFromGraph} />
            </>
          )}
        </section>

        <aside className="panel details" aria-label="Case details">
          {caseState.status === 'loading' || caseState.status === 'idle' ? (
            cases.status === 'success' && cases.data.length === 0 ? (
              <EmptyState title="No case details" detail="There are no flagged networks to review." />
            ) : cases.status === 'error' ? (
              <EmptyState title="No case details" />
            ) : (
              <SkeletonLines rows={10} />
            )
          ) : caseState.status === 'error' ? (
            <EmptyState title="Case details unavailable" />
          ) : (
            <>
              <CaseSummaryCard caseDetail={caseState.data} />
              <div className="tabs" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    className={`tab${tab === t.id ? ' is-active' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="tab-body" role="tabpanel">
                {tab === 'evidence' && (
                  <EvidencePanel caseDetail={caseState.data} selection={selection} onSelect={setSelection} />
                )}
                {tab === 'why' && (
                  <WhyFlaggedPanel caseDetail={caseState.data} selection={selection} onSelect={setSelection} />
                )}
                {tab === 'report' && (
                  <ReportPanel
                    caseDetail={caseState.data}
                    state={reports[caseState.data.id] ?? { status: 'idle' }}
                    onGenerate={() => generateReport(caseState.data.id)}
                  />
                )}
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
