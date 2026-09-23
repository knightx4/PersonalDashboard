import type { SearchHit } from '@/lib/search/sources';

/**
 * Dev rows into hits, apart from the reads so the hrefs can be tested without
 * a database -- the same split as map.ts.
 *
 * Only a spec has a page of its own. A plan step lands on the plan with its
 * number already in the plan's own search box, which unfolds the feature it
 * sits under; an idea and a note land on their list at the row's anchor.
 */

export type DevRows = {
  plan: { id: string; number: number; title: string; parent_id: string | null; status: string }[];
  ideas: { id: string; body: string; module: string | null }[];
  notes: { id: string; body: string; kind: string; status: string }[];
  specs: readonly { slug: string; title: string; blurb: string }[];
};

/** The first line of a body, short enough to be a title. */
export function firstLine(body: string, max = 90): string {
  const line = body.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (line.length <= max) return line || 'Untitled';
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

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
      title: row.title,
      subtitle: `${row.parent_id ? 'Step' : 'Feature'} #${row.number} · ${row.status.replace('_', ' ')}`,
      match: `#${row.number}`,
      href: planHref(row.number),
    });
  }

  for (const spec of rows.specs) {
    hits.push({
      module: 'dev',
      kind: 'spec',
      id: spec.slug,
      title: spec.title,
      subtitle: 'Spec',
      match: spec.blurb,
      href: `/dev/specs/${spec.slug}`,
    });
  }

  for (const row of rows.ideas) {
    hits.push({
      module: 'dev',
      kind: 'idea',
      id: row.id,
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
      title: firstLine(row.body),
      subtitle: `${row.kind === 'bug' ? 'Bug' : 'Request'} · ${row.status.replace('_', ' ')}`,
      match: row.body,
      href: `/dev/bugs#note-${row.id}`,
    });
  }

  return hits;
}
