import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { loadAreas } from '@/lib/learn/areas/load';
import { PLACE_BATCH, PLACE_MODEL, placeTracks, type PlaceItem } from '@/lib/learn/areas/place';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * The sweep that places every Learn subject still without a placement (plan
 * #1806; docs/LEARN-AREAS-SPEC.md, "Placement").
 *
 * Placement used to happen only where a subject was made by a chain, a lesson
 * or the Know page, and a failed call waited for the next chain written into
 * the same subject. Most subjects are made elsewhere (the clip stream, the
 * feed, a survey, a chat), so by October 2026 101 of 106 had never been
 * placed. This runs inside the hourly theme-placement tick and places
 * whatever is left, so where a subject came from no longer decides whether
 * it gets an area.
 *
 * A subject started from a vault theme copies the theme's row in
 * `learn.theme_fields` and makes no call, as placeTrack does. The rest go to
 * placeTracks in batches of one person's subjects. Every placement the model
 * returns is written, including one that spans domains (neither a field nor a
 * domain), so `placed_at` is set and the subject is not asked about again. A
 * batch whose call fails writes nothing and is tried again next hour.
 *
 * The write only lands on a row still unplaced and not moved by hand. The
 * service client bypasses RLS, so every read and write names the owner.
 */

/** Rows per read. PostgREST caps a response at 1,000. */
const PAGE = 1000;

/** Batches placed at once. */
const CONCURRENCY = 4;

/** Recorded with place-track: the same call, made from the sweep rather than on save. */
const OPERATION: LearnOperation = 'place-track';

export type SubjectPlacementSummary = {
  placed: number;
  copied: number;
  unplaced: number;
  remaining: number;
  failed: string[];
};

type SubjectRow = {
  id: string;
  user_id: string;
  name: string;
  note: string | null;
  theme_id: string | null;
};

type PlacementColumns = {
  field_id: string | null;
  domain_id: string | null;
  runner_up_field_id: string | null;
  placement_confidence: 'clear' | 'close' | 'none';
  placement_basis: string;
  placement_model: string | null;
};

async function pendingSubjects(learn: LearnSupabaseClient): Promise<SubjectRow[]> {
  const rows: SubjectRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await learn
      .from('subjects')
      .select('id, user_id, name, note, theme_id')
      .is('placed_at', null)
      .eq('placement_moved_by_hand', false)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading unplaced subjects failed: ${error.message}`);
    rows.push(...((data ?? []) as SubjectRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** The theme placements for the subjects started from a theme, keyed by theme id. */
async function themePlacements(
  learn: LearnSupabaseClient,
  themeIds: string[],
): Promise<Map<string, PlacementColumns>> {
  const found = new Map<string, PlacementColumns>();
  for (let i = 0; i < themeIds.length; i += 200) {
    const { data, error } = await learn
      .from('theme_fields')
      .select('theme_id, field_id, domain_id, runner_up_id, confidence, basis, model')
      .in('theme_id', themeIds.slice(i, i + 200));
    if (error) throw new Error(`Reading theme placements failed: ${error.message}`);
    for (const row of (data ?? []) as {
      theme_id: string;
      field_id: string | null;
      domain_id: string | null;
      runner_up_id: string | null;
      confidence: PlacementColumns['placement_confidence'];
      basis: string;
      model: string | null;
    }[]) {
      found.set(row.theme_id, {
        field_id: row.field_id,
        domain_id: row.domain_id,
        runner_up_field_id: row.runner_up_id,
        placement_confidence: row.confidence,
        placement_basis: row.basis,
        placement_model: row.model,
      });
    }
  }
  return found;
}

async function writePlacement(
  learn: LearnSupabaseClient,
  subject: SubjectRow,
  columns: PlacementColumns,
): Promise<boolean> {
  const { error } = await learn
    .from('subjects')
    .update({ ...columns, placed_at: new Date().toISOString() })
    .eq('id', subject.id)
    .eq('user_id', subject.user_id)
    .is('placed_at', null)
    .eq('placement_moved_by_hand', false);
  if (error) console.error('[learn subject-placement] write', error.message);
  return !error;
}

/**
 * Place unplaced subjects until `deadline` (a Date.now() value). Called by the
 * theme-placement tick with whatever time the themes left it.
 */
export async function runSubjectPlacement(deadline: number): Promise<SubjectPlacementSummary> {
  const learn = createLearnServiceSupabase();
  const summary: SubjectPlacementSummary = { placed: 0, copied: 0, unplaced: 0, remaining: 0, failed: [] };

  let pending = await pendingSubjects(learn);
  if (pending.length === 0) return summary;

  const fromThemes = await themePlacements(
    learn,
    [...new Set(pending.flatMap((subject) => (subject.theme_id ? [subject.theme_id] : [])))],
  );
  for (const subject of pending) {
    const copied = subject.theme_id ? fromThemes.get(subject.theme_id) : undefined;
    if (copied && (await writePlacement(learn, subject, copied))) summary.copied += 1;
  }
  pending = pending.filter((subject) => !(subject.theme_id && fromThemes.has(subject.theme_id)));

  summary.remaining = pending.length;
  if (pending.length === 0) return summary;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Subject placement needs ANTHROPIC_API_KEY to be set.');

  const core = createCoreServiceSupabase();
  const { fields, domains, fieldIds, domainIds } = await loadAreas(learn);

  // One person's subjects per batch: names are unique per account,
  // case-insensitively, so a title in the reply names exactly one subject.
  const byUser = new Map<string, SubjectRow[]>();
  for (const subject of pending) byUser.set(subject.user_id, [...(byUser.get(subject.user_id) ?? []), subject]);
  const batches: { userId: string; subjects: SubjectRow[] }[] = [];
  for (const [userId, subjects] of byUser) {
    for (let i = 0; i < subjects.length; i += PLACE_BATCH) {
      batches.push({ userId, subjects: subjects.slice(i, i + PLACE_BATCH) });
    }
  }

  let done = 0;
  while (done < batches.length && Date.now() < deadline) {
    const round = batches.slice(done, done + CONCURRENCY);
    done += round.length;

    const results = await Promise.all(
      round.map(async (batch) => {
        const spend: SpendReport[] = [];
        const items: PlaceItem[] = batch.subjects.map((subject) => ({
          title: subject.name,
          context: subject.note?.trim() || subject.name,
        }));
        const result = await placeTracks({
          tracks: items,
          fields,
          domains,
          anthropicApiKey: apiKey,
          onSpend: (report) => spend.push(report),
        });
        for (const report of spend) {
          await recordSpend(core, batch.userId, {
            module: 'learn',
            operation: OPERATION,
            model: report.model,
            usage: report.usage,
          });
        }
        return { batch, result };
      }),
    );

    let writtenThisRound = 0;
    for (const { batch, result } of results) {
      if (!result.ok) {
        summary.failed.push(result.detail);
        continue;
      }
      const byName = new Map(batch.subjects.map((subject) => [subject.name.toLowerCase(), subject]));
      for (const placement of result.placements) {
        const subject = byName.get(placement.title.toLowerCase());
        if (!subject) continue;
        const ok = await writePlacement(learn, subject, {
          field_id: placement.field ? (fieldIds.get(placement.field) ?? null) : null,
          domain_id: placement.domain ? (domainIds.get(placement.domain) ?? null) : null,
          runner_up_field_id: placement.runnerUp ? (fieldIds.get(placement.runnerUp) ?? null) : null,
          placement_confidence: placement.confidence,
          placement_basis: placement.basis,
          placement_model: PLACE_MODEL,
        });
        if (!ok) continue;
        writtenThisRound += 1;
        if (placement.field || placement.domain) summary.placed += 1;
        else summary.unplaced += 1;
      }
    }

    // A round that wrote nothing will write nothing next time either.
    if (writtenThisRound === 0) break;
  }

  summary.remaining = (await pendingSubjects(learn)).length;
  return summary;
}
