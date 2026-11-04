/**
 * Tiles named in words (plan #2778.9). Ask Dash, the connector and the goals
 * routine say which list, field, metric or step a tile reads by its name
 * ("the Loans list, its Balance field"); this turns those names into the ids
 * a saved tile holds, so checkLayout (lib/goals/dashboard.ts) can check it.
 * A name that matches nothing is left as it was and the check refuses it,
 * naming what the goal has instead.
 *
 * Pure, so the matching is tested without a database. The goal's lists,
 * metrics and steps are read in lib/goals/dashboard-store.ts
 * (loadDashboardTargets).
 */

import { liveFields, type CollectionField } from '@/lib/goals/collections';
import { TILE_TYPE_LABELS, type DashboardContext, type Tile } from '@/lib/goals/dashboard';

/** What a tile may read on one goal, with the names a person would use. */
export type DashboardTargets = {
  lists: ReadonlyArray<{ id: string; name: string; fields: CollectionField[] }>;
  metrics: ReadonlyArray<{ id: string; name: string }>;
  /** Every live step under the goal, at any depth. */
  steps: ReadonlyArray<{ id: string; title: string; parentId: string | null; status?: string; dueOn?: string | null }>;
};

export function targetsContext(targets: DashboardTargets): DashboardContext {
  return { lists: targets.lists, metrics: targets.metrics, stepIds: new Set(targets.steps.map((s) => s.id)) };
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The one entry a name means: its id, the exact name, or the one name that
 * starts with or holds the words. Null when none or several match.
 */
function match<T>(entries: readonly T[], wanted: string, id: (e: T) => string, name: (e: T) => string): T | null {
  const key = norm(wanted);
  if (!key) return null;
  if (ID.test(key)) return entries.find((e) => id(e).toLowerCase() === key) ?? null;
  const exact = entries.filter((e) => norm(name(e)) === key);
  if (exact.length === 1) return exact[0];
  const starts = entries.filter((e) => norm(name(e)).startsWith(key));
  if (starts.length === 1) return starts[0];
  const holds = entries.filter((e) => norm(name(e)).includes(key));
  return holds.length === 1 ? holds[0] : null;
}

export type Resolved = { ok: true; tile: Record<string, unknown> } | { ok: false; error: string };

/** "It keeps "Loans" and "Programs"" or "It keeps no lists", for a refusal. */
function keeps(names: readonly string[], what: string): string {
  if (names.length === 0) return `The goal keeps no ${what}.`;
  const quoted = names.slice(0, 12).map((n) => `"${n}"`);
  return `The goal keeps ${quoted.join(', ')}${names.length > 12 ? ', and more' : ''}.`;
}

/**
 * A tile as the model or a routine wrote it, with each list, field, metric
 * and step it names turned into the id the goal holds. A tile that names a
 * list, metric or step the goal does not have is refused here, saying what
 * the goal has; everything else (a stray key, a field of the wrong kind) is
 * left for checkLayout to refuse.
 */
export function resolveTile(raw: unknown, targets: DashboardTargets): Resolved {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'A tile is an object with a type.' };
  const tile: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  let fields: CollectionField[] = [];
  if (typeof tile.list === 'string') {
    const list = match(targets.lists, tile.list, (l) => l.id, (l) => l.name);
    if (!list) return { ok: false, error: `There is no list "${tile.list}" on this goal. ${keeps(targets.lists.map((l) => l.name), 'lists')}` };
    tile.list = list.id;
    fields = liveFields(list.fields);
  }
  const fieldKey = (wanted: string): string => {
    const field = match(fields, wanted, (f) => f.key, (f) => f.label) ?? fields.find((f) => f.key === wanted.trim());
    return field ? field.key : wanted;
  };
  if (typeof tile.field === 'string') tile.field = fieldKey(tile.field);
  if (Array.isArray(tile.fields)) tile.fields = tile.fields.map((f) => (typeof f === 'string' ? fieldKey(f) : f));

  if (typeof tile.metric === 'string') {
    const metric = match(targets.metrics, tile.metric, (m) => m.id, (m) => m.name);
    if (!metric) return { ok: false, error: `There is no metric "${tile.metric}" on this goal. ${keeps(targets.metrics.map((m) => m.name), 'metrics')}` };
    tile.metric = metric.id;
  }
  const step = (wanted: string): string | null => match(targets.steps, wanted, (s) => s.id, (s) => s.title)?.id ?? null;
  for (const key of ['step', 'parent'] as const) {
    if (typeof tile[key] !== 'string') continue;
    const id = step(tile[key] as string);
    if (!id) return { ok: false, error: `No one step on this goal is called "${tile[key]}". Name it by more of its title.` };
    tile[key] = id;
  }
  if (Array.isArray(tile.steps)) {
    const ids: unknown[] = [];
    for (const entry of tile.steps) {
      if (typeof entry !== 'string') {
        ids.push(entry);
        continue;
      }
      const id = step(entry);
      if (!id) return { ok: false, error: `No one step on this goal is called "${entry}". Name it by more of its title.` };
      ids.push(id);
    }
    tile.steps = ids;
  }
  return { ok: true, tile };
}

/** What a tile reads, in words: "Loans", "Balance on Loans", "the steps". */
function source(tile: Tile, targets: DashboardTargets): string {
  const list = 'list' in tile && tile.list ? targets.lists.find((l) => l.id === tile.list) : undefined;
  if (list) {
    const field = 'field' in tile && tile.field ? liveFields(list.fields).find((f) => f.key === tile.field) : undefined;
    return field ? `${field.label} on ${list.name}` : list.name;
  }
  if ('metric' in tile && tile.metric) return targets.metrics.find((m) => m.id === tile.metric)?.name ?? 'a metric';
  if (tile.type === 'countdown' && tile.step) return targets.steps.find((s) => s.id === tile.step)?.title ?? 'a step';
  if ((tile.type === 'rooms' || tile.type === 'tracker') && tile.parent) {
    return targets.steps.find((s) => s.id === tile.parent)?.title ?? 'a step';
  }
  return 'the steps';
}

/** A tile in a sentence: its title when it has one, else its kind and what it reads ("a chart of Balance on Loans"). */
export function tileWords(tile: Tile, targets: DashboardTargets): string {
  if (tile.title) return `"${tile.title}"`;
  if (tile.type === 'rooms') return tile.parent ? `the parts of ${source(tile, targets)}` : 'the parts';
  if (tile.type === 'countdown') return `a countdown to ${source(tile, targets)}`;
  const kind = TILE_TYPE_LABELS[tile.type].toLowerCase();
  return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} of ${source(tile, targets)}`;
}

/** The tiles of a layout, numbered from 1, for a refusal that asks which one. */
export function layoutWords(tiles: readonly Tile[], targets: DashboardTargets): string {
  if (tiles.length === 0) return 'The dashboard has no tiles yet.';
  return `The dashboard has ${tiles.map((t, i) => `${i + 1}. ${tileWords(t, targets)}`).join('; ')}.`;
}

/**
 * Which tile a person meant: its place from 1, or words from its title, its
 * kind or what it reads. Null when none or several match.
 */
export function findTile(tiles: readonly Tile[], wanted: unknown, targets: DashboardTargets): number | null {
  if (typeof wanted === 'number') return Number.isInteger(wanted) && wanted >= 1 && wanted <= tiles.length ? wanted - 1 : null;
  if (typeof wanted !== 'string') return null;
  const key = norm(wanted);
  if (/^\d+$/.test(key)) return findTile(tiles, Number(key), targets);
  if (!key) return null;
  const words = tiles.map((t) => norm(`${t.title ?? ''} ${TILE_TYPE_LABELS[t.type]} ${t.type} ${source(t, targets)}`));
  const titled = tiles.flatMap((t, i) => (t.title && norm(t.title) === key ? [i] : []));
  if (titled.length === 1) return titled[0];
  const held = words.flatMap((w, i) => (w.includes(key) ? [i] : []));
  return held.length === 1 ? held[0] : null;
}

