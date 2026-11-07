import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import cytoscape from 'cytoscape';
import type { CaseDetail } from '../data/types';
import { accountShortLabels, caseFacts, findCycle } from '../lib/caseStory';
import { formatMoneyWhole } from '../lib/format';
import { computeLayout } from '../lib/graphLayout';
import type { Selection } from '../lib/selection';

interface Props {
  caseDetail: CaseDetail;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  showContext: boolean;
  onToggleContext: (show: boolean) => void;
  detailsPanel: ReactNode;
}

const ALWAYS_SHOW_AMOUNTS_UP_TO = 5;
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';
const COLORS = { flaggedNode: '#2dd4bf', hubNode: '#f5b94a', contextNode: '#475569', edge: '#2bb3a3', contextEdge: '#64748b' };

export function CaseGraph({ caseDetail, selection, onSelect, showContext, onToggleContext, detailsPanel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const facts = useMemo(() => caseFacts(caseDetail), [caseDetail]);
  const panelOpen = selection !== null;
  const hiddenContextCount = facts.contextTransfers.length;
  const visibleTransfers = showContext ? caseDetail.transactions : facts.flaggedTransfers;
  const degree = new Map<string, number>();
  for (const t of visibleTransfers) for (const id of [t.from, t.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  // Amount labels on edges that meet at one account would collide, so those show on hover instead.
  const showAllAmounts = visibleTransfers.length <= ALWAYS_SHOW_AMOUNTS_UP_TO && Math.max(0, ...degree.values()) <= 2;

  useEffect(() => {
    if (!containerRef.current) return;
    const labels = accountShortLabels(caseDetail);
    const placements = computeLayout(caseDetail, showContext);
    const contextIds = new Set(facts.contextAccounts.map((a) => a.id));
    const cycle = findCycle(caseDetail);
    const hubIds = new Set(
      cycle ? [cycle[0].from] : caseDetail.accounts.filter((a) => a.role === 'collector' || a.role === 'origin').map((a) => a.id),
    );
    const transfers = showContext ? caseDetail.transactions : facts.flaggedTransfers;
    const amounts = transfers.map((t) => t.amount);
    const minAmount = Math.min(...amounts);
    const maxAmount = Math.max(...amounts);

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...caseDetail.accounts
          .filter((a) => placements[a.id])
          .map((a) => ({
            data: { id: a.id, label: `${labels[a.id]}\n…${a.id.slice(-4)}` },
            position: { x: placements[a.id].x, y: placements[a.id].y },
            classes: [`label-${placements[a.id].side}`, contextIds.has(a.id) ? 'context' : hubIds.has(a.id) ? 'hub' : 'flagged'].join(' '),
          })),
        ...transfers.map((t) => ({
          data: { id: t.id, source: t.from, target: t.to, amount: t.amount, amountLabel: formatMoneyWhole(t.amount, t.currency) },
          classes: [t.isEvidence ? 'flagged' : 'context', showAllAmounts ? 'show-amount' : ''].join(' '),
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': COLORS.flaggedNode,
            label: 'data(label)',
            'text-wrap': 'wrap',
            'text-justification': 'center',
            color: '#f1f5fb',
            'font-size': 14,
            'font-family': FONT,
            'font-weight': 600,
            'line-height': 1.3,
            'text-background-color': '#0b1426',
            'text-background-opacity': 0.92,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle',
            width: 30,
            height: 30,
            'border-width': 3,
            'border-color': '#0b1426',
            'overlay-opacity': 0,
          },
        },
        { selector: 'node.hub', style: { 'background-color': COLORS.hubNode, width: 36, height: 36 } },
        {
          selector: 'node.context',
          style: { 'background-color': '#1e293b', 'border-color': COLORS.contextNode, 'border-style': 'dashed', 'border-width': 2, color: '#c3cede' },
        },
        { selector: 'node.label-top', style: { 'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -8 } },
        { selector: 'node.label-bottom', style: { 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 8 } },
        { selector: 'node.label-left', style: { 'text-valign': 'center', 'text-halign': 'left', 'text-margin-x': -10, 'text-justification': 'right' } },
        { selector: 'node.label-right', style: { 'text-valign': 'center', 'text-halign': 'right', 'text-margin-x': 10, 'text-justification': 'left' } },
        {
          selector: 'edge',
          style: {
            width: minAmount === maxAmount ? 3 : `mapData(amount, ${minAmount}, ${maxAmount}, 2, 6)`,
            'line-color': COLORS.edge,
            'target-arrow-color': COLORS.edge,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.6,
            'curve-style': 'bezier',
            'font-size': 14,
            'font-family': FONT,
            'font-weight': 600,
            color: '#f1f5f9',
            'text-background-color': '#0b1426',
            'text-background-opacity': 1,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'text-rotation': 'autorotate',
            'overlay-padding': 6,
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge.context',
          style: { 'line-style': 'dashed', 'line-color': COLORS.contextEdge, 'target-arrow-color': COLORS.contextEdge, color: '#e2e8f0' },
        },
        { selector: 'edge.show-amount, edge.hovered, edge.focused', style: { label: 'data(amountLabel)' } },
        // Amounts on a selected account's transfers sit near the far end, where the edges fan apart.
        {
          selector: 'edge.related-in',
          style: { 'source-label': 'data(amountLabel)', 'source-text-offset': 64, 'source-text-rotation': 'autorotate' },
        },
        {
          selector: 'edge.related-out',
          style: { 'target-label': 'data(amountLabel)', 'target-text-offset': 64, 'target-text-rotation': 'autorotate' },
        },
        { selector: 'edge.hovered', style: { 'line-color': '#5eead4', 'target-arrow-color': '#5eead4', 'z-index': 9 } },
        { selector: '.dimmed', style: { opacity: 0.25 } },
        { selector: 'node.focused', style: { 'border-color': '#f8fafc', 'border-width': 4, 'border-style': 'solid' } },
        { selector: 'edge.focused', style: { 'line-color': '#99f6e4', 'target-arrow-color': '#99f6e4', 'z-index': 10 } },
        { selector: 'edge.related', style: { 'line-color': '#5eead4', 'target-arrow-color': '#5eead4' } },
      ],
      layout: { name: 'preset', fit: true, padding: 56 },
      minZoom: 0.3,
      maxZoom: 1.5,
      autounselectify: true,
      boxSelectionEnabled: false,
    });
    cy.fit(undefined, 56);

    // Large cases fit at a small zoom; enlarge labels in graph units so they stay at least 12px on screen.
    const keepLabelsReadable = () => {
      const size = Math.max(14, 12 / cy.zoom());
      cy.batch(() => cy.elements().style('font-size', size));
    };
    keepLabelsReadable();
    cy.on('zoom', keepLabelsReadable);

    cy.on('tap', 'node', (e) => onSelectRef.current({ kind: 'account', id: e.target.id() }));
    cy.on('tap', 'edge', (e) => onSelectRef.current({ kind: 'transaction', id: e.target.id() }));
    cy.on('tap', (e) => {
      if (e.target === cy) onSelectRef.current(null);
    });
    cy.on('mouseover', 'edge', (e) => e.target.addClass('hovered'));
    cy.on('mouseout', 'edge', (e) => e.target.removeClass('hovered'));
    cy.on('mouseover', 'node, edge', () => containerRef.current && (containerRef.current.style.cursor = 'pointer'));
    cy.on('mouseout', 'node, edge', () => containerRef.current && (containerRef.current.style.cursor = 'default'));

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [caseDetail, facts, showContext, showAllAmounts]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('focused related related-in related-out dimmed');
    if (!selection) return;
    const el = cy.getElementById(selection.id);
    if (el.empty()) return;
    const neighbourhood =
      selection.kind === 'account' ? el.closedNeighborhood() : el.union(cy.$id(selection.id).connectedNodes());
    cy.elements().not(neighbourhood).addClass('dimmed');
    el.addClass('focused');
    if (selection.kind === 'account') {
      const edges = el.connectedEdges().addClass('related').not('.show-amount');
      edges.filter(`[target = "${selection.id}"]`).addClass('related-in');
      edges.filter(`[source = "${selection.id}"]`).addClass('related-out');
    }
  }, [selection, caseDetail, showContext]);

  // The canvas narrows while the details panel is open; refit so nothing hides behind it.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.resize();
    cy.fit(undefined, 56);
  }, [panelOpen]);

  const fit = () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 56 } }, { duration: 250 });
  const resetLayout = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const placements = computeLayout(caseDetail, showContext);
    cy.nodes().forEach((n) => {
      const p = placements[n.id()];
      if (p) n.position({ x: p.x, y: p.y });
    });
    cy.fit(undefined, 56);
  };

  return (
    <div className="graph-card">
      <div className="graph-bar">
        <div className="legend" aria-label="Legend">
          <span className="legend-item">
            <span className="legend-dot legend-dot-hub" /> Key account
          </span>
          <span className="legend-item">
            <span className="legend-dot" /> Flagged account
          </span>
          <span className="legend-item">
            <span className="legend-arrow" /> Flagged transfer (arrow shows direction, thicker = larger)
          </span>
          {showContext && hiddenContextCount > 0 && (
            <span className="legend-item">
              <span className="legend-arrow legend-arrow-dashed" /> Contextual, not flagged
            </span>
          )}
        </div>
        <div className="graph-actions">
          {hiddenContextCount > 0 && (
            <label className="toggle">
              <input type="checkbox" checked={showContext} onChange={(e) => onToggleContext(e.target.checked)} />
              Show contextual transfers ({hiddenContextCount})
            </label>
          )}
          <button type="button" className="btn btn-quiet" onClick={fit}>
            Fit
          </button>
          <button type="button" className="btn btn-quiet" onClick={resetLayout}>
            Reset layout
          </button>
        </div>
      </div>
      <div className={`graph-body${panelOpen ? ' has-panel' : ''}`}>
        <div className="graph-stage">
          <div ref={containerRef} className="graph-canvas" aria-label="Directed graph of transfers between accounts" role="img" />
          {!showAllAmounts && !panelOpen && <p className="graph-hint">Hover over a transfer to see its amount. Click an account or transfer for details.</p>}
          {showAllAmounts && !panelOpen && <p className="graph-hint">Click an account or transfer for details.</p>}
        </div>
        {panelOpen && detailsPanel}
      </div>
    </div>
  );
}
