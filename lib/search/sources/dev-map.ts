import { MODULES } from '@/lib/modules';
import type { SearchHit } from '@/lib/search/sources';
import { APP_VISION, visionAnchor } from '@/lib/specs/vision';

/**
 * Dev rows into hits, apart from the reads so the hrefs can be tested without
 * a database -- the same split as map.ts.
 *
 * Only a spec has a page of its own. A plan step lands on the plan with its
 * number already in the plan's own search box, which unfolds the feature it
 * sits under; an idea and a note land on their list at the row's anchor.
 *
 * An open question and a raise land on the Dash tab at their card instead,
 * because that is where they are answered: the plan shows a question, but
 * answering it there means finding it again on Dash (plan #1154).
 *
 * A workspace's vision lands on the specs page at the head of that
 * workspace's group, where it is read and edited (plan #1155).
 */

export type DevRows = {
  plan: { id: string; number: number; title: string; parent_id: string | null; status: string }[];
  ideas: { id: string; body: string; module: string | null }[];
  notes: { id: string; body: string; kind: string; status: string }[];
  specs: readonly { slug: string; title: string; blurb: string }[];
  /** Decisions still waiting on an answer, dismissed ones already left out. */
  questions?: { id: string; number: number; title: string; detail: string | null }[];
  /** Raises from the Dash tab's queue, dismissed ones already left out. */
  raises?: {
    id: string;
    title: string;
    detail: string | null;
    ask: string | null;
    status: string;
  }[];
  /** The visions a query found: one per workspace, the app's under `app`. */
  visions?: { id: string; module: string; body: string }[];
};

/**
 * The open questions and raises a query finds, at most `limit` of each. They
 * are read whole and matched here, so the words under the title count: a
 * question's options, a raise's story and its ask. A query that is a step
 * number ("#612" or "612") finds the question with that number.
 */
export function matchWaiting(
  rows: Required<Pick<DevRows, 'questions' | 'raises'>>,
  query: string | undefined,
  limit: number,
): Required<Pick<DevRows, 'questions' | 'raises'>> {
  const needle = query?.trim().toLowerCase();
  const number = needle?.match(/^#?(\d+)$/)?.[1];
  const has = (...parts: (string | null)[]) =>
    !needle || parts.join(' ').toLowerCase().includes(needle);

  return {
    questions: rows.questions
      .filter((row) =>
        number ? row.number === Number(number) : has(row.title, row.detail),
      )
      .slice(0, limit),
    raises: rows.raises.filter((row) => has(row.title, row.detail, row.ask)).slice(0, limit),
  };
}

/**
 * The visions a query finds, matched on the text of each. There is at most one
 * per workspace, so they are read whole and matched here like the questions.
 */
export function matchVisions(
  visions: NonNullable<DevRows['visions']>,
  query: string | undefined,
  limit: number,
): NonNullable<DevRows['visions']> {
  const needle = query?.trim().toLowerCase();
  return visions
    .filter((row) => row.body.trim() && (!needle || row.body.toLowerCase().includes(needle)))
    .slice(0, limit);
}

/** What a vision is called on the specs page: its workspace's name, or the app. */
export function visionLabel(scope: string): string {
  if (scope === APP_VISION) return 'the app';
  return MODULES.find((module) => module.id === scope)?.label ?? scope;
}

/** The card on the Dash tab a plan row is drawn as, in "Waiting on you". */
export function waitingAnchor(id: string): string {
  return `waiting-${id}`;
}

/** The card on the Dash tab a raise is drawn as. */
export function raiseAnchor(id: string): string {
  return `raise-${id}`;
}

/** The first line of a body, short enough to be a title. */
export function firstLine(body: string, max = 90): string {
  const line = body.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (line.length <= max) return line || 'Untitled';
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

/** What a note's subtitle calls it. Keyed by the `feedback_kind` enum. */
const NOTE_KIND_LABEL: Record<string, string> = { bug: 'Bug', feature: 'Request', like: 'Like' };

export function planHref(number: number): string {
  return `/dev/plan?view=all&q=${encodeURIComponent(`#${number}`)}`;
}

export function devHits(rows: DevRows): SearchHit[] {
  const hits: SearchHit[] = [];

  for (const row of rows.plan) {
    hits.push({
      module: 'dev',
      kind: 'plan',
      id: row.id,
      ref: `public.plan_items:${row.id}`,
      title: row.title,
      subtitle: `${row.parent_id ? 'Step' : 'Feature'} #${row.number} · ${row.status.replace('_', ' ')}`,
      match: `#${row.number}`,
      href: planHref(row.number),
    });
  }

  for (const row of rows.questions ?? []) {
    hits.push({
      module: 'dev',
      kind: 'plan',
      id: row.id,
      ref: `public.plan_items:${row.id}`,
      title: row.title,
      subtitle: `Question #${row.number} · waiting on you`,
      // The number, as a step is quoted, and the options beneath the title:
      // the word you remember from a question is as often in an option.
      match: `#${row.number} ${row.detail ?? ''}`.trim(),
      href: `/dev/raised#${waitingAnchor(row.id)}`,
    });
  }

  for (const row of rows.raises ?? []) {
    hits.push({
      module: 'dev',
      kind: 'raise',
      id: row.id,
      ref: `public.raised_items:${row.id}`,
      title: row.title,
      subtitle: `Raised · ${row.status}`,
      match: `${row.ask ?? ''} ${row.detail ?? ''}`.trim() || undefined,
      href: `/dev/raised#${raiseAnchor(row.id)}`,
    });
  }

  for (const spec of rows.specs) {
    hits.push({
      module: 'dev',
      kind: 'spec',
      id: spec.slug,
      // A spec is a file in docs/, not a row, so there is nothing to point at.
      ref: null,
      title: spec.title,
      subtitle: 'Spec',
      match: spec.blurb,
      href: `/dev/specs/${spec.slug}`,
    });
  }

  for (const row of rows.visions ?? []) {
    hits.push({
      module: 'dev',
      kind: 'vision',
      id: row.module,
      ref: `public.module_visions:${row.id}`,
      title: `Vision for ${visionLabel(row.module)}`,
      subtitle: 'Vision · Specs',
      match: row.body,
      href: `/dev/specs#${visionAnchor(row.module)}`,
    });
  }

  for (const row of rows.ideas) {
    hits.push({
      module: 'dev',
      kind: 'idea',
      id: row.id,
      ref: `public.ideas:${row.id}`,
      title: firstLine(row.body),
      subtitle: 'Idea',
      match: row.body,
      href: `/dev/ideas#idea-${row.id}`,
    });
  }

  for (const row of rows.notes) {
    hits.push({
      module: 'dev',
      kind: 'feedback',
      id: row.id,
      ref: `public.feedback_items:${row.id}`,
      title: firstLine(row.body),
      subtitle: `${NOTE_KIND_LABEL[row.kind] ?? 'Request'} · ${row.status.replace('_', ' ')}`,
      match: row.body,
      href: `/dev/bugs#note-${row.id}`,
    });
  }

  return hits;
}
