import { useCallback, useEffect, useMemo, useState } from 'react';
import { DATA_SOURCE, generateDraftReport, getCase, getLoadedDataset, listCases } from './data/api';
import type { CaseDetail, CaseSummary, DraftReport } from './data/types';
import { errorMessage, type AsyncState } from './lib/async';
import { buildCaseStory } from './lib/caseStory';
import type { Selection } from './lib/selection';
import { CaseList } from './components/CaseList';
import { CaseGraph } from './components/CaseGraph';
import { CaseHeader, CaseReview } from './components/CaseOverview';
import { DetailsPanel } from './components/DetailsPanel';
import { ReportModal } from './components/ReportModal';
import { TransactionTable } from './components/TransactionTable';
import { EmptyState, ErrorState, SkeletonLines } from './components/StateViews';
import { PRIORITY_SHORT } from './lib/indicators';
import { COMPACT_QUERY, useMediaQuery } from './lib/useMediaQuery';

export default function App() {
  const [cases, setCases] = useState<AsyncState<CaseSummary[]>>({ status: 'idle' });
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseState, setCaseState] = useState<AsyncState<CaseDetail>>({ status: 'idle' });
  const [caseReloadKey, setCaseReloadKey] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [showContext, setShowContext] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reports, setReports] = useState<Record<string, AsyncState<DraftReport>>>({});
  const [datasetLabel, setDatasetLabel] = useState<string | null>(null);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerVisible = compact && drawerOpen;

  useEffect(() => {
    if (!drawerVisible) return;
    document.body.classList.add('drawer-open');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerVisible]);

  const selectCase = useCallback((id: string) => {
    setSelectedCaseId(id);
    setDrawerOpen(false);
  }, []);

  useEffect(() => {
    getLoadedDataset()
      .then((d) => {
        if (!d) return;
        if (d.source === 'ibm') setDatasetLabel('IBM AML sample (simulated by IBM)');
        else if (d.source === 'synthetic') setDatasetLabel(d.fallback ? 'Generated synthetic data (IBM data unavailable)' : 'Generated synthetic data');
        else setDatasetLabel('Dataset not reported by backend');
      })
      .catch(() => setDatasetLabel('Dataset unknown (backend unreachable)'));
  }, []);

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
    setShowContext(false);
    setReportOpen(false);
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

  const detail = caseState.status === 'success' ? caseState.data : null;
  const selectedSummary = cases.status === 'success' ? cases.data.find((c) => c.id === selectedCaseId) : undefined;
  const story = useMemo(() => (detail ? buildCaseStory(detail) : null), [detail]);

  const select = useCallback(
    (next: Selection) => {
      if (next?.kind === 'transaction' && detail?.transactions.find((t) => t.id === next.id)?.isEvidence === false) {
        setShowContext(true);
      }
      setSelection(next);
    },
    [detail],
  );

  const selectFromTable = useCallback(
    (next: Selection) => {
      select(next);
      document.getElementById('follow-the-money')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [select],
  );

  const openReport = () => {
    if (!detail) return;
    const existing = reports[detail.id];
    if (!existing || existing.status === 'error') generateReport(detail.id);
    setReportOpen(true);
  };
  const closeReport = useCallback(() => setReportOpen(false), []);

  const toggleContext = (show: boolean) => {
    setShowContext(show);
    if (!show && selection && detail) {
      const hidden =
        selection.kind === 'transaction'
          ? detail.transactions.find((t) => t.id === selection.id)?.isEvidence === false
          : !detail.transactions.some((t) => t.isEvidence && (t.from === selection.id || t.to === selection.id));
      if (hidden) setSelection(null);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◎
          </span>
          <span className="brand-name">MuleRadar</span>
        </div>
        <div className="source-switch">
          {DATA_SOURCE === 'mock' ? (
            <span className="demo-badge" title="All accounts, transfers and amounts are fictional">
              Synthetic demo data
            </span>
          ) : (
            <span className="demo-badge live-badge" title="Cases, transfers and reports come from the MuleRadar backend API">
              Live backend{datasetLabel ? ` · ${datasetLabel}` : ''}
            </span>
          )}
          <a className="source-link" href={DATA_SOURCE === 'mock' ? '?source=live' : '?source=mock'}>
            {DATA_SOURCE === 'mock' ? 'Switch to live backend' : 'Switch to synthetic demo'}
          </a>
        </div>
      </header>

      <div className="shell">
        <CaseList
          state={cases}
          selectedId={selectedCaseId}
          onSelect={selectCase}
          onRetry={loadCases}
          drawerOpen={drawerVisible}
          onClose={() => setDrawerOpen(false)}
        />
        {drawerVisible && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

        <main className="main">
          {compact && (
            <button type="button" className="case-picker" onClick={() => setDrawerOpen(true)} aria-expanded={drawerVisible}>
              <span className="case-picker-label">
                Select case <span aria-hidden>▾</span>
              </span>
              {selectedSummary && (
                <span className="case-picker-current">
                  <span className="case-item-title">{selectedSummary.title}</span>
                  <span className="case-item-meta">
                    <span className={`priority-badge priority-${selectedSummary.priority}`}>{PRIORITY_SHORT[selectedSummary.priority]}</span>
                    <span>{selectedSummary.accountCount} accounts</span>
                    <span className="mono dim">{selectedSummary.id}</span>
                  </span>
                </span>
              )}
            </button>
          )}
          {cases.status === 'success' && cases.data.length === 0 && (
            <EmptyState title="Nothing to review" detail="When the sample rules flag a network, it will appear here." />
          )}
          {cases.status === 'error' && (
            <EmptyState title="No case to show" detail="The case list needs to load before a case can be opened." />
          )}
          {(caseState.status === 'loading' || (cases.status === 'loading' && !detail)) && (
            <div className="main-loading" aria-busy="true">
              <div className="skeleton skeleton-title" />
              <SkeletonLines rows={5} />
              <div className="graph-placeholder shimmer" />
            </div>
          )}
          {caseState.status === 'error' && (
            <ErrorState title="Couldn’t load this case" detail={caseState.error} onRetry={() => setCaseReloadKey((k) => k + 1)} />
          )}
          {detail && story && caseState.status === 'success' && (
            <>
              <CaseHeader caseDetail={detail} story={story} onOpenReport={openReport} />

              <section id="follow-the-money" className="graph-section">
                <h2>Follow the money</h2>
                <CaseGraph
                  caseDetail={detail}
                  selection={selection}
                  onSelect={select}
                  showContext={showContext}
                  onToggleContext={toggleContext}
                  compact={compact}
                  detailsPanel={selection && <DetailsPanel caseDetail={detail} selection={selection} onSelect={select} />}
                />
              </section>

              <CaseReview caseDetail={detail} story={story} selection={selection} onSelect={select} />

              <TransactionTable caseDetail={detail} selection={selection} onSelect={selectFromTable} />
            </>
          )}
        </main>
      </div>

      {reportOpen && detail && (
        <ReportModal
          caseDetail={detail}
          state={reports[detail.id] ?? { status: 'idle' }}
          onGenerate={() => generateReport(detail.id)}
          onClose={closeReport}
        />
      )}
    </div>
  );
}
