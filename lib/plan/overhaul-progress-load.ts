import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SPECS, readSpec, type SpecDoc } from '@/lib/specs/registry';
import specBaseline from '@/scripts/spec-baseline.json';
import { overhaulProgress, specFilesNamedIn, type OverhaulProgress } from './overhaul-progress';

/**
 * Each overhaul's progress, by its plan item id, for the plan page.
 *
 * The spec is the first one the feature's detail names, and failing that the
 * spec of a change filed against the feature (spec_changes.plan_item_id), as
 * .claude/skills/plan/reference/overhaul.md has it. Where the detail names
 * several, the first with a Contract wins, so a passing mention of another
 * spec ahead of the real one does not hide the counts.
 *
 * The specs are read off disk at request time; next.config.ts traces `docs/`
 * into /dev/plan for that. The counts are scripts/spec-baseline.json's,
 * imported so they are in the bundle, the way /dev/specs reads them.
 */
export async function loadOverhaulProgress(
  supabase: SupabaseClient,
  userId: string,
  overhauls: readonly { id: string; detail: string | null }[],
): Promise<Record<string, OverhaulProgress>> {
  if (overhauls.length === 0) return {};

  const { data, error } = await supabase
    .from('spec_changes')
    .select('spec, plan_item_id')
    .eq('user_id', userId)
    .in(
      'plan_item_id',
      overhauls.map((o) => o.id),
    )
    .order('created_at', { ascending: true });
  if (error) console.error(`Could not read the overhauls' spec changes: ${error.message}`);
  const changed = new Map<string, string[]>();
  for (const row of (data ?? []) as { spec: string; plan_item_id: string }[]) {
    changed.set(row.plan_item_id, [...(changed.get(row.plan_item_id) ?? []), row.spec]);
  }

  const baseline = specBaseline as Record<string, number>;
  const files = SPECS.map((s) => s.file);
  const texts = new Map<string, Promise<string | null>>();
  const read = (doc: SpecDoc) => {
    if (!texts.has(doc.file)) texts.set(doc.file, readSpec(doc));
    return texts.get(doc.file) as Promise<string | null>;
  };

  const entries = await Promise.all(
    overhauls.map(async (o): Promise<[string, OverhaulProgress]> => {
      const named = specFilesNamedIn(o.detail, files).flatMap(
        (file) => SPECS.find((s) => s.file === file) ?? [],
      );
      const fromChanges = (changed.get(o.id) ?? []).flatMap(
        (slug) => SPECS.find((s) => s.slug === slug) ?? [],
      );
      const candidates = [...new Set([...named, ...fromChanges])];
      if (candidates.length === 0) return [o.id, { state: 'no-spec' }];

      const progress = await Promise.all(
        candidates.map(async (doc) => overhaulProgress(doc.title, await read(doc), baseline)),
      );
      return [o.id, progress.find((p) => p.state === 'counting') ?? progress[0]];
    }),
  );
  return Object.fromEntries(entries);
}
