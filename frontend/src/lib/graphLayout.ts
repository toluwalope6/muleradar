// Deterministic node positions so labels never collide: a ring for loops, spaced columns otherwise.
import type { CaseDetail } from '../data/types';
import { caseFacts, findCycle } from './caseStory';

export type LabelSide = 'top' | 'bottom' | 'left' | 'right';

export interface NodePlacement {
  x: number;
  y: number;
  side: LabelSide;
}

const COLUMN_GAP = 320;
const ROW_GAP = 96;

function sideForAngle(angle: number): LabelSide {
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  if (Math.abs(x) > Math.abs(y) * 1.4) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'bottom' : 'top';
}

export function computeLayout(c: CaseDetail, includeContext: boolean): Record<string, NodePlacement> {
  const facts = caseFacts(c);
  const cycle = findCycle(c);
  const placements: Record<string, NodePlacement> = {};
  const contextIds = new Set(facts.contextAccounts.map((a) => a.id));
  const visibleTx = includeContext ? c.transactions : facts.flaggedTransfers;
  const neighbourOf = (id: string) => {
    const t = visibleTx.find((x) => (x.from === id || x.to === id) && !contextIds.has(x.from === id ? x.to : x.from));
    return t ? { other: t.from === id ? t.to : t.from, sends: t.from === id } : null;
  };

  if (cycle) {
    const ring = cycle.map((h) => h.from);
    const radius = Math.max(150, 55 * ring.length);
    const angles: Record<string, number> = {};
    ring.forEach((id, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
      angles[id] = angle;
      placements[id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle), side: sideForAngle(angle) };
    });
    const extras = c.accounts.filter((a) => !placements[a.id] && (includeContext || !contextIds.has(a.id)));
    const perAnchor = new Map<string, number>();
    for (const a of extras) {
      const n = neighbourOf(a.id);
      const anchor = n && angles[n.other] !== undefined ? n.other : ring[0];
      const k = perAnchor.get(anchor) ?? 0;
      perAnchor.set(anchor, k + 1);
      const angle = angles[anchor] - 0.45 - 0.35 * k;
      const r = radius + 190;
      placements[a.id] = { x: r * Math.cos(angle), y: r * Math.sin(angle), side: sideForAngle(angle) };
    }
    return placements;
  }

  // Layered: each flagged account sits one column after the furthest account that pays it.
  const flagged = facts.flaggedTransfers;
  const layer: Record<string, number> = {};
  for (const a of facts.flaggedAccounts) layer[a.id] = 0;
  for (let pass = 0; pass < facts.flaggedAccounts.length; pass++) {
    for (const t of flagged) {
      if (t.from !== t.to && layer[t.to] <= layer[t.from]) layer[t.to] = Math.min(layer[t.from] + 1, facts.flaggedAccounts.length);
    }
  }
  const firstSeen = (id: string) => flagged.find((t) => t.from === id || t.to === id)?.timestamp ?? '';
  const columns = new Map<number, string[]>();
  for (const a of facts.flaggedAccounts) columns.set(layer[a.id], [...(columns.get(layer[a.id]) ?? []), a.id]);
  const extras = includeContext ? facts.contextAccounts : [];
  const contextColumns = new Map<number, string[]>();
  for (const a of extras) {
    const n = neighbourOf(a.id);
    const col = n ? layer[n.other] + (n.sends ? -1 : 1) : 0;
    layer[a.id] = col;
    contextColumns.set(col, [...(contextColumns.get(col) ?? []), a.id]);
  }
  const allCols = [...new Set([...columns.keys(), ...contextColumns.keys()])];
  const minCol = Math.min(...allCols);
  const maxCol = Math.max(...allCols);
  const sideFor = (col: number): LabelSide => (col === minCol ? 'left' : col === maxCol ? 'right' : 'top');
  for (const [col, members] of columns) {
    const sorted = [...members].sort((a, b) => firstSeen(a).localeCompare(firstSeen(b)) || a.localeCompare(b));
    sorted.forEach((id, i) => {
      placements[id] = { x: col * COLUMN_GAP, y: (i - (sorted.length - 1) / 2) * ROW_GAP, side: sideFor(col) };
    });
  }
  for (const [col, members] of contextColumns) {
    const occupied = (columns.get(col) ?? []).map((id) => placements[id].y);
    let y = occupied.length ? Math.max(...occupied) + ROW_GAP * 1.25 : ROW_GAP * 1.25;
    for (const id of members) {
      placements[id] = { x: col * COLUMN_GAP, y, side: sideFor(col) };
      y += ROW_GAP;
    }
  }
  return placements;
}
