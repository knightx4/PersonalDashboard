import type { Move } from '@/lib/core/move';

/**
 * What a ref link shows before it is followed (docs/ONE-INTERFACE-SPEC.md,
 * Part 2, "A preview"; plan #1931.4): the row's title line and whose move it
 * is. Pure and client-safe, so a link can work out what to ask for from its
 * own address; lib/core/ref-preview-server.ts reads the answer.
 *
 * A preview is asked for by a key. Most keys are a ref, `schema.table:id`. A
 * plan step written in text is known only by its number or outline, so its
 * key is that, with its hash: `#1084` or `#1490.11`. The server reads either
 * back to the row.
 */

export type RefPreview = {
  /** The row's title line, or NO_LONGER_THERE when it has gone. */
  title: string;
  missing: boolean;
  /** Whose move it is, where the row's workspace says; null where it says nothing. */
  move: Move | null;
  /** The workspace's own tooltip for the move, where it has one. */
  moveTitle?: string;
  /** How the row is named where it has a name of its own, such as `#1490.11`. */
  label?: string;
};

const PLAN_KEY = /^#(\d{1,5}(?:\.\d+)*)$/;

/**
 * `schema.table:id`, the shape lib/core/refs.ts parseRef reads. Repeated here
 * rather than imported, because refs.ts carries the whole sources catalogue
 * and this file goes to the browser with every link.
 */
const REF = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:\S+$/;

/** Where a ref whose page needs more than its id opens (OPEN_PATH in lib/core/refs.ts). */
const OPEN_PATH = '/open';

function parseRef(ref: string): boolean {
  return REF.test(ref);
}

/** A plan step's key: `#1084` or `#1490.11`. */
export function planKey(ref: number | string): string {
  return `#${ref}`;
}

/** The number or outline a plan key names, or null when it is not one. */
export function parsePlanKey(key: string): { number: number } | { outline: string } | null {
  const match = PLAN_KEY.exec(key);
  if (!match) return null;
  return match[1].includes('.') ? { outline: match[1] } : { number: Number(match[1]) };
}

/** Whether a key is something the server can answer: a ref or a plan key. */
export function isPreviewKey(key: string): boolean {
  return parsePlanKey(key) !== null || parseRef(key);
}

/**
 * The key an address in the app opens, or null when it is not a row's page
 * that can be read back from the address alone: `/open/<ref>` (a ref whose
 * page needs more than its id), `/dev/plan/<number or outline>` (a step's
 * page), and the plan filtered to one step, as links written before
 * plan #1931.4 still point.
 */
export function previewKeyFromHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  const [path, query = ''] = href.split('#')[0].split('?');

  if (path.startsWith(`${OPEN_PATH}/`)) {
    let ref: string;
    try {
      ref = decodeURIComponent(path.slice(OPEN_PATH.length + 1));
    } catch {
      return null;
    }
    return parseRef(ref) ? ref : null;
  }

  const step = /^\/dev\/plan\/([^/]+)$/.exec(path);
  if (step) {
    let written: string;
    try {
      written = decodeURIComponent(step[1]).replace(/^#/, '');
    } catch {
      return null;
    }
    return PLAN_KEY.test(`#${written}`) ? `#${written}` : null;
  }

  if (path === '/dev/plan') {
    const q = new URLSearchParams(query).get('q')?.trim() ?? '';
    return PLAN_KEY.test(q) ? q : null;
  }
  return null;
}
