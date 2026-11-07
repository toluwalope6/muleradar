import { useState } from 'react';
import type { CaseDetail, DraftReport } from '../data/types';
import type { AsyncState } from '../lib/async';
import { formatDateTime, formatMoney } from '../lib/format';
import { ErrorState, SkeletonLines } from './StateViews';

interface Props {
  caseDetail: CaseDetail;
  state: AsyncState<DraftReport>;
  onGenerate: () => void;
}

function reportAsText(report: DraftReport, c: CaseDetail): string {
  const evidence = c.transactions.filter((t) => report.evidenceTransactionIds.includes(t.id));
  const lines = [
    `DRAFT FOR HUMAN REVIEW — Demo, synthetic data`,
    `Case ${report.caseId} · generated ${formatDateTime(report.generatedAt)} from a fixed template`,
    '',
  ];
  for (const s of report.sections) {
    lines.push(s.heading, ...s.paragraphs);
    if (s.heading.startsWith('4.')) {
      for (const t of evidence) {
        lines.push(`  ${t.id}  ${formatDateTime(t.timestamp)}  ${t.from} -> ${t.to}  ${formatMoney(t.amount, t.currency)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function ReportPanel({ caseDetail, state, onGenerate }: Props) {
  const [copied, setCopied] = useState(false);

  if (state.status === 'idle') {
    return (
      <div className="report-intro">
        <h3>Draft investigation report</h3>
        <p className="muted">
          Builds a structured draft from this case’s indicators and transactions using a fixed template. No AI service
          is connected. The draft must be reviewed and completed by an analyst.
        </p>
        <button type="button" className="btn btn-primary" onClick={onGenerate}>
          Generate draft report
        </button>
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <div className="report-intro">
        <p className="muted">Generating draft from case evidence…</p>
        <SkeletonLines rows={8} />
      </div>
    );
  }
  if (state.status === 'error') {
    return <ErrorState title="Couldn’t generate the draft" detail={state.error} onRetry={onGenerate} />;
  }

  const report = state.data;
  const evidence = caseDetail.transactions
    .filter((t) => report.evidenceTransactionIds.includes(t.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportAsText(report, caseDetail));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="report-viewer">
      <div className="draft-banner" role="note">
        <strong>Draft for human review</strong>
        <span>Not a filed report. Template-generated from synthetic demo data.</span>
      </div>
      <div className="report-meta">
        <span>
          Case <span className="mono">{report.caseId}</span> · generated {formatDateTime(report.generatedAt)}
        </span>
        <span className="report-actions">
          <button type="button" className="btn btn-ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy text'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onGenerate}>
            Regenerate
          </button>
        </span>
      </div>
      <article className="report-doc">
        <h3 className="report-title">Suspicious activity report — draft</h3>
        {report.sections.map((s) => (
          <section key={s.heading}>
            <h4>{s.heading}</h4>
            {s.paragraphs.map((p, i) => (
              <p key={i} className={p.startsWith('•') ? 'bullet' : ''}>
                {p}
              </p>
            ))}
            {s.heading.startsWith('4.') && (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Time (UTC)</th>
                    <th>From → To</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((t) => (
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
    </div>
  );
}
