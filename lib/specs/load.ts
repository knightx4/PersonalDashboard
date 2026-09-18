import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COMMENT_COLUMNS,
  threadFrom,
  type DevComment,
} from '@/lib/comments/load';
import { splitSections, type SpecSection } from '@/lib/specs/sections';
import { readSpec, type SpecDoc } from '@/lib/specs/registry';

/**
 * A specification, its sections, and the thread under each one.
 *
 * The document comes from the repository and the threads come from the
 * database, and the join between them is the anchor. Sections are written on
 * the way in -- a row is created the first time a heading is seen, and never
 * deleted, because the comments under it outlive the heading.
 */

export type SpecSectionWithThread = SpecSection & {
  id: string;
  thread: DevComment[];
};

export type LoadedSpec = {
  doc: SpecDoc;
  /** Null when the file is gone from the repository. */
  sections: SpecSectionWithThread[] | null;
  /** Threads whose heading no longer appears in the document. */
  orphans: { id: string; heading: string; thread: DevComment[] }[];
};

type Row = {
  id: string;
  anchor: string;
  heading: string;
  dev_comments?: unknown;
};

async function storedSections(
  supabase: SupabaseClient,
  userId: string,
  slug: string,
): Promise<Row[]> {
  const { data } = await supabase
    .from('spec_sections')
    .select(`id, anchor, heading, dev_comments (${COMMENT_COLUMNS})`)
    .eq('user_id', userId)
    .eq('slug', slug);
  return (data ?? []) as Row[];
}

export async function loadSpec(
  supabase: SupabaseClient,
  userId: string,
  doc: SpecDoc,
): Promise<LoadedSpec> {
  const markdown = await readSpec(doc);

  if (markdown === null) {
    const rows = await storedSections(supabase, userId, doc.slug);
    // The file is gone. Everything that was ever commented on is an orphan, and
    // showing them beats a page that pretends the conversation never happened.
    return {
      doc,
      sections: null,
      orphans: rows
        .filter((row) => threadFrom(row.dev_comments).length > 0)
        .map((row) => ({
          id: row.id,
          heading: row.heading,
          thread: threadFrom(row.dev_comments),
        })),
    };
  }

  const parsed = splitSections(markdown);

  // Written before the threads are read, so every section on the page has
  // something for a comment to point at. Idempotent, bounded by the number of
  // headings in one document, and the heading and position are refreshed --
  // a heading that changed enough to change its anchor is a new section, and
  // its predecessor's thread becomes an orphan below rather than being lost.
  if (parsed.length > 0) {
    await supabase.from('spec_sections').upsert(
      parsed.map((section) => ({
        user_id: userId,
        slug: doc.slug,
        anchor: section.anchor,
        heading: section.heading,
        position: section.position,
      })),
      { onConflict: 'user_id,slug,anchor' },
    );
  }

  const rows = await storedSections(supabase, userId, doc.slug);
  const byAnchor = new Map(rows.map((row) => [row.anchor, row]));
  const live = new Set(parsed.map((section) => section.anchor));

  const sections = parsed.flatMap((section) => {
    const row = byAnchor.get(section.anchor);
    // A section whose row did not come back is one the upsert could not write,
    // which is a database problem rather than a page problem. Dropping it beats
    // rendering a thread box that cannot save.
    return row ? [{ ...section, id: row.id, thread: threadFrom(row.dev_comments) }] : [];
  });

  const orphans = rows
    .filter((row) => !live.has(row.anchor))
    .map((row) => ({ id: row.id, heading: row.heading, thread: threadFrom(row.dev_comments) }))
    .filter((row) => row.thread.length > 0);

  return { doc, sections, orphans };
}

/** How many comments a document carries, for the list page. */
export async function specCommentCounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('spec_sections')
    .select('slug, dev_comments (id)')
    .eq('user_id', userId);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { slug: string; dev_comments?: unknown }[]) {
    const n = Array.isArray(row.dev_comments) ? row.dev_comments.length : 0;
    counts[row.slug] = (counts[row.slug] ?? 0) + n;
  }
  return counts;
}
