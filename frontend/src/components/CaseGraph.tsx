import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { CaseDetail } from '../data/types';
import { formatMoneyShort } from '../lib/format';
import type { Selection } from '../lib/selection';

interface Props {
  caseDetail: CaseDetail;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

const ROLE_COLORS: Record<string, string> = {
  origin: '#2dd4bf',
  intermediary: '#5eead4',
  collector: '#f5b94a',
  source: '#60a5fa',
  destination: '#a5b4fc',
  context: '#334155',
};

function layoutFor(c: CaseDetail): cytoscape.LayoutOptions {
  if (c.indicatorTypes.includes('circular_flow')) {
    return { name: 'circle', padding: 48, animate: false, startAngle: -Math.PI / 2 };
  }
  const targets = new Set(c.transactions.map((t) => t.to));
  const roots = c.accounts.filter((a) => !targets.has(a.id)).map((a) => a.id);
  return { name: 'breadthfirst', directed: true, roots, padding: 40, spacingFactor: 1.15, animate: false };
}

export function CaseGraph({ caseDetail, selection, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const amounts = caseDetail.transactions.map((t) => t.amount);
    const minAmount = Math.min(...amounts);
    const maxAmount = Math.max(...amounts);
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...caseDetail.accounts.map((a) => ({
          data: { id: a.id, label: a.id, color: ROLE_COLORS[a.role] },
          classes: a.role === 'context' ? 'context' : '',
        })),
        ...caseDetail.transactions.map((t) => ({
          data: {
            id: t.id,
            source: t.from,
            target: t.to,
            amount: t.amount,
            label: formatMoneyShort(t.amount, t.currency),
          },
          classes: t.isEvidence ? 'evidence' : 'context',
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#cbd5e1',
            'font-size': 11,
            'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 7,
            width: 30,
            height: 30,
            'border-width': 3,
            'border-color': '#0b1220',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node.context',
          style: { 'border-style': 'dashed', 'border-color': '#64748b', 'border-width': 2, color: '#64748b' },
        },
        {
          selector: 'edge',
          style: {
            width: minAmount === maxAmount ? 2.5 : `mapData(amount, ${minAmount}, ${maxAmount}, 1.5, 5)`,
            'line-color': '#2a9d8f',
            'target-arrow-color': '#2a9d8f',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.1,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 10,
            'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
            color: '#e2e8f0',
            'text-background-color': '#0f1a2e',
            'text-background-opacity': 1,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-rotation': 'autorotate',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge.context',
          style: { 'line-style': 'dashed', 'line-color': '#475569', 'target-arrow-color': '#475569', color: '#94a3b8' },
        },
        { selector: '.dimmed', style: { opacity: 0.22 } },
        {
          selector: 'node.focused',
          style: { 'border-color': '#f8fafc', 'border-width': 4, 'border-style': 'solid', width: 36, height: 36 },
        },
        {
          selector: 'edge.focused',
          style: { 'line-color': '#5eead4', 'target-arrow-color': '#5eead4', width: 6, 'z-index': 10 },
        },
        { selector: 'edge.related', style: { 'line-color': '#5eead4', 'target-arrow-color': '#5eead4' } },
      ],
      layout: layoutFor(caseDetail),
      minZoom: 0.3,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      autounselectify: true,
      boxSelectionEnabled: false,
    });

    cy.on('tap', 'node', (e) => onSelectRef.current({ kind: 'account', id: e.target.id() }));
    cy.on('tap', 'edge', (e) => onSelectRef.current({ kind: 'transaction', id: e.target.id() }));
    cy.on('tap', (e) => {
      if (e.target === cy) onSelectRef.current(null);
    });
    cy.on('mouseover', 'node, edge', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node, edge', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'default';
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [caseDetail]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('focused related dimmed');
    if (!selection) return;
    const el = cy.getElementById(selection.id);
    if (el.empty()) return;
    const neighbourhood =
      selection.kind === 'account' ? el.closedNeighborhood() : el.union(cy.$id(selection.id).connectedNodes());
    cy.elements().not(neighbourhood).addClass('dimmed');
    el.addClass('focused');
    if (selection.kind === 'account') el.connectedEdges().addClass('related');
  }, [selection, caseDetail]);

  const fit = () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 40 } }, { duration: 250 });
  const relayout = () => cyRef.current?.layout(layoutFor(caseDetail)).run();

  return (
    <div className="graph-wrap">
      <div ref={containerRef} className="graph-canvas" aria-label="Directed transaction graph" role="img" />
      <div className="graph-toolbar">
        <button type="button" className="btn btn-ghost" onClick={fit}>
          Fit
        </button>
        <button type="button" className="btn btn-ghost" onClick={relayout}>
          Reset layout
        </button>
      </div>
      <div className="graph-legend" aria-label="Legend">
        {(['origin', 'source', 'collector', 'intermediary', 'destination'] as const)
          .filter((role) => caseDetail.accounts.some((a) => a.role === role))
          .map((role) => (
            <span key={role} className="legend-item">
              <span className="legend-dot" style={{ background: ROLE_COLORS[role] }} />
              {role[0].toUpperCase() + role.slice(1)}
            </span>
          ))}
        <span className="legend-item">
          <span className="legend-line" /> Evidence transfer
        </span>
        {caseDetail.transactions.some((t) => !t.isEvidence) && (
          <span className="legend-item">
            <span className="legend-line legend-line-dashed" /> Context (not flagged)
          </span>
        )}
      </div>
    </div>
  );
}
