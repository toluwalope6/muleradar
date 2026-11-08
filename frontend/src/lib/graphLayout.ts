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
// Narrow screens: layers become rows (money flows downwards), at most three accounts per row.
const NARROW_PER_ROW = 2;
const NARROW_COL_GAP = 280;
// Narrow screens: loops with many accounts become a tall oval (down the left, up the right).
const NARROW_RING_MAX = 6;
const NARROW_LOOP_X = 130;
const NARROW_LOOP_GAP = 120;
const NARROW_EXTRA_X = 140;
const NARROW_ROW_GAP = 110;
const NARROW_LAYER_GAP = 70;

function sideForAngle(angle: number, narrow = false): LabelSide {
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  // Narrow screens: labels above or below, so the loop can use the full width.
  if (!narrow && Math.abs(x) > Math.abs(y) * 1.4) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'bottom' : 'top';
}

export function computeLayout(c: CaseDetail, includeContext: boolean, narrow = false): Record<string, NodePlacement> {
  const facts = caseFacts(c);
  const cycle = findCycle(c);
  const placements: Record<string, NodePlacement> = {};
  const contextIds = new Set(facts.contextAccounts.map((a) => a.id));
  const visibleTx = includeContext ? c.transactions : facts.flaggedTransfers;
  const neighbourOf = (id: string) => {
    const t = visibleTx.find((x) => (x.from === id || x.to === id) && !contextIds.has(x.from === id ? x.to : x.from));
    return t ? { other: t.from === id ? t.to : t.from, sends: t.from === id } : null;
  };

  const loopExtras = cycle ? c.accounts.filter((a) => !cycle.some((h) => h.from === a.id) && (includeContext || !contextIds.has(a.id))) : [];
  if (cycle && narrow && (cycle.length > NARROW_RING_MAX || loopExtras.length > 0)) {
    const ring = cycle.map((h) => h.from);
    const down = Math.ceil(ring.length / 2);
    const up = ring.length - down;
    ring.forEach((id, i) => {
      placements[id] =
        i < down
          ? { x: -NARROW_LOOP_X, y: i * NARROW_LOOP_GAP, side: 'left' }
          : { x: NARROW_LOOP_X, y: (up - 1 - (i - down)) * NARROW_LOOP_GAP + ((down - up) * NARROW_LOOP_GAP) / 2, side: 'right' };
    });
    // Other accounts go in rows of two: those paying into the loop above it, the rest below.
    const loopBottom = (down - 1) * NARROW_LOOP_GAP;
    const ordered = [...loopExtras].sort((a, b) => a.id.localeCompare(b.id));
    const above = ordered.filter((a) => neighbourOf(a.id)?.sends);
    const below = ordered.filter((a) => !neighbourOf(a.id)?.sends);
    const placeRows = (list: typeof ordered, startY: number, step: number) =>
      list.forEach((a, i) => {
        placements[a.id] = { x: i % 2 === 0 ? -NARROW_EXTRA_X : NARROW_EXTRA_X, y: startY + Math.floor(i / 2) * step, side: 'right' };
      });
    placeRows(above, -NARROW_LOOP_GAP * 1.6, -NARROW_LOOP_GAP);
    placeRows(below, loopBottom + NARROW_LOOP_GAP * 1.6, NARROW_LOOP_GAP);
    return placements;
  }

  if (cycle) {
    const ring = cycle.map((h) => h.from);
    const radius = Math.max(150, 55 * ring.length);
    const angles: Record<string, number> = {};
    ring.forEach((id, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
      angles[id] = angle;
      placements[id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle), side: sideForAngle(angle, narrow) };
    });
    const extras = c.accounts.filter((a) => !placements[a.id] && (includeContext || !contextIds.has(a.id)));
    // Outer ring: each extra starts near the ring account it trades with, then is pushed apart evenly.
    const r = Math.max(radius + 190, (extras.length * 170) / (2 * Math.PI));
    const minGap = Math.min((2 * Math.PI) / Math.max(extras.length, 1), 170 / r);
    const wanted = extras
      .map((a) => {
        const n = neighbourOf(a.id);
        const anchor = n && angles[n.other] !== undefined ? n.other : ring[0];
        return { id: a.id, angle: angles[anchor] - 0.45 };
      })
      .sort((x, y) => x.angle - y.angle || x.id.localeCompare(y.id));
    wanted.forEach((w, i) => {
      if (i > 0) w.angle = Math.max(w.angle, wanted[i - 1].angle + minGap);
      placements[w.id] = { x: r * Math.cos(w.angle), y: r * Math.sin(w.angle), side: sideForAngle(w.angle) };
    });
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
  if (narrow) {
    let y = 0;
    for (const col of [...allCols].sort((a, b) => a - b)) {
      const flaggedMembers = [...(columns.get(col) ?? [])].sort((a, b) => firstSeen(a).localeCompare(firstSeen(b)) || a.localeCompare(b));
      const members = [...flaggedMembers, ...(contextColumns.get(col) ?? [])];
      for (let start = 0; start < members.length; start += NARROW_PER_ROW) {
        const row = members.slice(start, start + NARROW_PER_ROW);
        row.forEach((id, i) => {
          placements[id] = { x: (i - (row.length - 1) / 2) * NARROW_COL_GAP, y, side: 'right' };
        });
        y += NARROW_ROW_GAP;
      }
      y += NARROW_LAYER_GAP;
    }
    return placements;
  }
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
