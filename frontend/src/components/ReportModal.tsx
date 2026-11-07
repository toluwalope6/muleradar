import { useEffect, useState } from 'react';
import type { CaseDetail, DraftReport } from '../data/types';
import type { AsyncState } from '../lib/async';
import { formatDateTime, formatMoney } from '../lib/format';
import { ErrorState, SkeletonLines } from './StateViews';

interface Props {
  caseDetail: CaseDetail;
  state: AsyncState<DraftReport>;
  onGenerate: () => void;
  onClose: () => void;
}

function reportAsText(report: DraftReport, c: CaseDetail): string {
  const flagged = c.transactions.filter((t) => report.evidenceTransactionIds.includes(t.id));
  const lines = [
    'DRAFT FOR HUMAN REVIEW — Demo, synthetic data',
    `Case ${report.caseId} · generated ${formatDateTime(report.generatedAt)} from a fixed template (no AI service)`,
    '',
  ];
  for (const s of report.sections) {
    lines.push(s.heading, ...s.paragraphs);
    if (s.heading.startsWith('4.')) {
      for (const t of flagged) {
        lines.push(`  ${t.id}  ${formatDateTime(t.timestamp)}  ${t.from} -> ${t.to}  ${formatMoney(t.amount, t.currency)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function ReportModal({ caseDetail, state, onGenerate, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  const report = state.status === 'success' ? state.data : null;
  const flagged = report
    ? caseDetail.transactions
        .filter((t) => report.evidenceTransactionIds.includes(t.id))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : [];

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportAsText(report, caseDetail));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([reportAsText(report, caseDetail)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `draft-report-${report.caseId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Draft report" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <p className="eyebrow">Case {caseDetail.id}</p>
            <h2>Draft suspicious activity report</h2>
          </div>
          <div className="modal-actions">
            {report && (
              <>
                <button type="button" className="btn btn-quiet" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="btn btn-quiet" onClick={download}>
                  Download .txt
                </button>
                <button type="button" className="btn btn-quiet" onClick={onGenerate}>
                  Regenerate
                </button>
              </>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="draft-banner" role="note">
          <strong>Draft for human review</strong>
          <span>Not a filed report. Filled in from a fixed template using synthetic demo data; no AI service is used.</span>
        </div>
        <div className="modal-body">
          {(state.status === 'loading' || state.status === 'idle') && (
            <div className="report-loading">
              <p className="muted">Building the draft from this case’s data…</p>
              <SkeletonLines rows={10} />
            </div>
          )}
          {state.status === 'error' && <ErrorState title="Couldn’t generate the draft" detail={state.error} onRetry={onGenerate} />}
          {report && (
            <article className="report-doc">
              <p className="small muted">Generated {formatDateTime(report.generatedAt)}</p>
              {report.sections.map((s) => (
                <section key={s.heading}>
                  <h3>{s.heading}</h3>
                  {s.paragraphs.map((p, i) => (
                    <p key={i} className={p.startsWith('•') ? 'bullet' : ''}>
                      {p}
                    </p>
                  ))}
                  {s.heading.startsWith('4.') && (
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Transfer</th>
                          <th>Time (UTC)</th>
                          <th>From → To</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flagged.map((t) => (
                          <tr key={t.id}>
                            <td className="mono">{t.id}</td>
                            <td className="mono">{formatDateTime(t.timestamp).replace(' UTC', '')}</td>
                            <td className="mono">
                              {t.from} → {t.to}
                            </td>
                            <td className="mono num">{formatMoney(t.amount, t.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              ))}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
