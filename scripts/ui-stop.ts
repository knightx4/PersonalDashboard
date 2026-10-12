/**
 * Settle a screen after a third failed critic round (plan #1609).
 *
 *   npm run ui-stop -- <step or note id>
 *
 * Reads the step's recorded verdicts in `.preview-shots/checks/`, takes each
 * surface's latest round, and for every surface stopped on a failed round 3
 * (or 6, 9) prints the last fixes in full and how to settle it.
 *
 * The person is not asked (their answer of 12 October 2026, which replaces
 * decision #1535's A): the builder settles the screen itself with
 * `npm run ui-guard -- <step> --settle "<why>"`, merges and closes the step,
 * and lists the open fixes in the close note, where they can overrule it. A
 * note closes the same way, with the open fixes in its reason.
 *
 * It writes nothing itself. Exits 1 when no surface is stopped.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { stoppedSurfaces, surfaceLabels, type StopRound } from '../lib/plan/ui-check-stop';
import { ownerKey, parseOwner, parseVerdict, type CriticVerdict } from '../lib/preview/ui-checks';

const DIR = '.preview-shots/checks';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The recorder uploads the shots only where it has the service key (scripts/ui-check.ts). */
function shotsUploaded(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && process.env.SUPABASE_SERVICE_ROLE_KEY && !url.includes('placeholder'));
}

function main(): void {
  const ownerArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!ownerArg) fail('Usage: npm run ui-stop -- <step or note id>');
  let owner;
  try {
    owner = parseOwner(ownerArg);
  } catch (error) {
    fail((error as Error).message);
  }
  const key = ownerKey(owner);

  if (!existsSync(DIR)) fail(`No rounds recorded in ${DIR}.`);
  const pattern = new RegExp(`^${key.replace(/[^0-9a-z-]/gi, '')}--([a-z0-9][a-z0-9-]*)--r(\\d+)\\.json$`);
  const verdicts: CriticVerdict[] = [];
  for (const name of readdirSync(DIR)) {
    const m = pattern.exec(name);
    if (!m) continue;
    try {
      verdicts.push(parseVerdict(readFileSync(`${DIR}/${name}`, 'utf8'), m[1], Number(m[2])));
    } catch (error) {
      fail(`${DIR}/${name}: ${(error as Error).message}`);
    }
  }
  const uploaded = shotsUploaded();
  const rounds: StopRound[] = verdicts.map((v) => ({
    surface: v.surface,
    round: v.round,
    verdict: v.verdict,
    fixes: v.fixes,
    shots: uploaded ? ['uploaded'] : [],
  }));
  // Each screen is named as the gallery names it, so the ask reads without the step in mind.
  const gallery = readdirSync('app/preview')
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => readFileSync(`app/preview/${name}`, 'utf8'))
    .join('\n');
  const labels = surfaceLabels(gallery);
  const stopped = stoppedSurfaces(rounds).map((s) => ({ ...s, label: labels.get(s.surface) }));
  if (stopped.length === 0) fail(`No surface of ${ownerArg} is stopped on a failed third round.`);

  for (const s of stopped) {
    const v = verdicts.find((x) => x.surface === s.surface && x.round === s.round)!;
    const name = s.label ? `${s.label} (${s.surface})` : s.surface;
    console.log(`${name}, round ${s.round}: shots ${DIR}/${key}--${s.surface}--r${s.round}--*.png`);
    for (const f of v.fixes) console.log(`  - [${f.shot}] ${f.where}: ${f.problem} (${f.breaks}) -> ${f.change}`);
  }
  const open = stopped.reduce((n, s) => n + s.fixes, 0);
  const why = `the critic stopped at round ${stopped[0].round} with ${open} fix${open === 1 ? '' : 'es'} open on ${stopped
    .map((s) => s.surface)
    .join(', ')}`;
  if (owner.step === null) {
    console.log(
      `\nA note: do not block it. Close it on the fix, and list the open fixes above in its reason (${why}).`,
    );
    return;
  }
  console.log('\nDo not block the step or ask the person. Settle the screen yourself:\n');
  console.log(`npm run ui-guard -- ${owner.step} --settle ${JSON.stringify(why)}\n`);
  console.log('Then merge and close the step, listing the open fixes above in the close note.');
}

main();
