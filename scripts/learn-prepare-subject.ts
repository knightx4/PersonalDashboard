/**
 * Prepare the subjects that were made before the preparation existed
 * (plan #2276.8).
 *
 *   npm run learn:prepare                      # list what would happen
 *   npm run learn:prepare -- --apply           # open a run for every active subject without one
 *   npm run learn:prepare -- "Urban economics" --apply
 *   npm run learn:prepare -- --apply --kick    # also start each run on the live app
 *
 * Without --apply it only prints. --apply opens each run (ensurePreparation)
 * and marks the opening units the add wrote as placeholders, so write_units
 * replaces them. A subject already prepared, or with drafted topics, is
 * skipped unless named. --kick asks the app's learn-prepare route to work the
 * runs, which spends about two to four dollars a subject; without it the
 * daily cron picks the opened runs up, five a morning.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY; --kick also needs CRON_SECRET and
 * NEXT_PUBLIC_APP_URL. Every read and write is for the app's owner.
 */
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { kickPreparation } from '@/lib/learn/prepare/kick';
import { planExisting, type ExistingSubject } from '@/lib/learn/prepare/existing';
import { ensurePreparation } from '@/lib/learn/prepare/store';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const kick = argv.includes('--kick');
const named = argv.filter((a) => !a.startsWith('--'));

async function main() {
  const { data: owner } = await createServiceSupabase().rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const learn = createLearnServiceSupabase();

  const [subjects, runs, lenses, units] = await Promise.all([
    learn.from('subjects').select('id, name, survey').eq('user_id', userId),
    learn.from('subject_preparations').select('subject_id, status').eq('user_id', userId).is('branch_key', null),
    learn.from('lenses').select('id, subject_id').eq('user_id', userId).not('subject_id', 'is', null),
    learn.from('curriculum_units').select('id, subject_id, write_model').eq('user_id', userId),
  ]);
  for (const r of [subjects, runs, lenses, units]) if (r.error) throw new Error(r.error.message);
  const unitIds = (units.data ?? []).map((u) => u.id as string);
  const [pieces, targets] = await Promise.all([
    unitIds.length ? learn.from('plan_pieces').select('unit_id').eq('user_id', userId).in('unit_id', unitIds) : { data: [], error: null },
    learn.from('lens_targets').select('lens_id').eq('user_id', userId),
  ]);
  if (pieces.error) throw new Error(pieces.error.message);
  if (targets.error) throw new Error(targets.error.message);

  const piecesBy = new Map<string, number>();
  for (const p of pieces.data ?? []) piecesBy.set(p.unit_id as string, (piecesBy.get(p.unit_id as string) ?? 0) + 1);
  const targetsBy = new Map<string, number>();
  for (const t of targets.data ?? []) targetsBy.set(t.lens_id as string, (targetsBy.get(t.lens_id as string) ?? 0) + 1);

  const existing: ExistingSubject[] = (subjects.data ?? []).map((s) => {
    const lens = (lenses.data ?? []).find((l) => l.subject_id === s.id);
    const run = (runs.data ?? []).find((r) => r.subject_id === s.id);
    return {
      id: s.id as string,
      name: s.name as string,
      survey: Boolean(s.survey),
      runStatus: (run?.status as ExistingSubject['runStatus']) ?? null,
      lensTargets: lens ? (targetsBy.get(lens.id as string) ?? 0) : 0,
      units: (units.data ?? [])
        .filter((u) => u.subject_id === s.id)
        .map((u) => ({ writtenByDash: u.write_model !== null, pieces: piecesBy.get(u.id as string) ?? 0 })),
    };
  });

  // Survey stubs are not listed one by one unless named.
  const plans = planExisting(existing, named).filter((p) => named.length > 0 || !existing.find((s) => s.id === p.id)?.survey);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? '';
  let opened = 0;
  let kicked = 0;
  for (const p of plans) {
    console.log(`${p.action === 'open' ? 'prepare' : 'skip   '}  ${p.name}: ${p.reason}${p.replaceUnits ? ' Opening units will be replaced.' : ''}`);
    if (!apply || p.action !== 'open') continue;
    await ensurePreparation(learn, userId, p.id);
    opened += 1;
    if (p.replaceUnits) {
      const { error } = await learn.from('curriculum_units').update({ placeholder: true }).eq('user_id', userId).eq('subject_id', p.id);
      if (error) throw new Error(`Marking ${p.name}'s units failed: ${error.message}`);
    }
    if (kick && (await kickPreparation(origin, p.id))) kicked += 1;
  }
  console.log(apply ? `Opened ${opened} runs${kick ? `, started ${kicked}` : ''}.` : 'Nothing changed; add --apply.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
