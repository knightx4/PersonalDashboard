import type { PlanNode, PlanSection } from './tree';

/**
 * When a second feature may run in a module that already has a session going.
 *
 * The runner used to keep one session per module (`outsideRunning` in
 * inngest/dev/overnight.ts), because two sessions in one module edit the same
 * pages, loaders and tests and the second to merge inherits a conflict. That
 * held the whole night to one module's pace: on 12 October Learn had a session
 * going while three slots stood empty and Idea Space waited behind it, though
 * the two features shared no file.
 *
 * So a module may take a second session, but only to fill a slot that would
 * otherwise stand empty (the tick asks this after every other module has had
 * its turn), only up to `MODULE_SESSIONS_AT_ONCE`, and only when the two
 * features' footprints do not meet. A footprint is what the feature's open
 * work says it will touch: the file paths and the module's page addresses
 * named in the titles, details and done-whens of the feature and its open
 * steps, and whether any of that work writes a migration. Shaping writes those
 * paths into every step (.claude/skills/plan/reference/writing.md), so the
 * plan already says where each feature will land.
 *
 * Every doubt counts as a clash. A feature that names no path cannot be shown
 * to stay clear of anything, so it never shares; two features that both write
 * a migration would both take the module's next migration number. The merge
 * gate is still the backstop for anything the text did not say.
 */

/** The most feature sessions one module has going at once. */
export const MODULE_SESSIONS_AT_ONCE = 2;

/** What one feature's open work says it will touch. */
export type Footprint = {
  /** Directories, repository-relative, with no trailing slash. */
  places: string[];
  /** Whether any open step writes a migration. */
  migration: boolean;
};

const TOP_DIRS = ['app', 'components', 'lib', 'inngest', 'scripts', 'supabase', 'tests', 'docs'];

/** A repository path: one of the top directories, then at least one more segment. */
const PATH = new RegExp(`(?<![\\w/.-])(?:${TOP_DIRS.join('|')})/[\\w\\-.\\[\\]()@/]+`, 'g');

/** A page address in a module, such as /learn/space: a slash at a word's start, then segments. */
const ROUTE = /(?<![\w/.:-])\/([a-z][a-z0-9-]*(?:\/[a-z0-9\-[\]]+)*)/g;

const MIGRATION = /\bmigrations?\b/i;

function isOpen(node: PlanNode): boolean {
  return node.status !== 'done' && node.status !== 'dropped';
}

/** The feature and every open step beneath it. */
function openNodes(feature: PlanNode): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (node: PlanNode) => {
    if (node !== feature && !isOpen(node)) return;
    out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(feature);
  return out;
}

/**
 * A file is placed at its directory, so two steps editing neighbouring files in
 * one folder count as meeting. A path whose last segment has no dot is a
 * directory already.
 */
function placeOf(path: string): string {
  const trimmed = path.replace(/[.,;:)]+$/, '').replace(/\/+$/, '');
  const parts = trimmed.split('/');
  const last = parts[parts.length - 1] ?? '';
  return last.includes('.') && parts.length > 1 ? parts.slice(0, -1).join('/') : trimmed;
}

export function footprintOf(feature: PlanNode): Footprint {
  const places = new Set<string>();
  let migration = false;
  for (const node of openNodes(feature)) {
    const text = [node.title, node.detail, node.acceptance].filter(Boolean).join('\n');
    if (node !== feature && MIGRATION.test(text)) migration = true;
    for (const match of text.matchAll(PATH)) places.add(placeOf(match[0]));
    // Only addresses under the feature's own module: "/learn/space" names the
    // page app/learn/space, where "/dev/plan" in a Learn step is a mention.
    if (feature.module) {
      for (const match of text.matchAll(ROUTE)) {
        const route = match[1]!;
        if (route === feature.module || route.startsWith(`${feature.module}/`)) {
          places.add(`app/${route}`);
        }
      }
    }
  }
  return { places: [...places].sort(), migration };
}

/** Whether one place is the other or sits inside it. */
function nested(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** Whether two features could edit the same thing, counting any doubt as yes. */
export function footprintsMeet(a: Footprint, b: Footprint): boolean {
  if (a.places.length === 0 || b.places.length === 0) return true;
  if (a.migration && b.migration) return true;
  return a.places.some((one) => b.places.some((other) => nested(one, other)));
}

/**
 * The sections with every feature that may not start beside the running ones
 * taken out, allowing a second session in a module when it fits.
 *
 * A feature stays when its module has no session going, or when it has fewer
 * than `MODULE_SESSIONS_AT_ONCE` and the feature's footprint meets none of the
 * running ones there. Features with no module are one group, as in
 * `outsideRunning`, and never share: nothing says where they land.
 */
export function besideRunning(
  sections: readonly PlanSection[],
  runningIds: readonly string[],
): PlanSection[] {
  const running = new Set(runningIds);
  const busy = new Map<string, PlanNode[]>();
  for (const section of sections) {
    for (const node of section.nodes) {
      if (!running.has(node.id)) continue;
      const key = node.module ?? '';
      busy.set(key, [...(busy.get(key) ?? []), node]);
    }
  }
  const prints = new Map<string, Footprint>();
  const printOf = (node: PlanNode) => {
    const known = prints.get(node.id);
    if (known) return known;
    const made = footprintOf(node);
    prints.set(node.id, made);
    return made;
  };
  const fits = (node: PlanNode): boolean => {
    if (running.has(node.id)) return false;
    const there = busy.get(node.module ?? '');
    if (!there) return true;
    if (!node.module || there.length >= MODULE_SESSIONS_AT_ONCE) return false;
    const mine = printOf(node);
    return there.every((other) => !footprintsMeet(mine, printOf(other)));
  };
  return sections.map((section) => ({ ...section, nodes: section.nodes.filter(fits) }));
}
