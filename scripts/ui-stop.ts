/**
 * Hand a screen to the person after a third failed critic round (plan #1609).
 *
 *   npm run ui-stop -- <step or note id> [--branch <name>]
 *
 * Reads the step's recorded verdicts in `.preview-shots/checks/`, takes each
 * surface's latest round, and for every surface stopped on a failed round 3
 * (or 6, 9 after a redirect) prints:
 *
 *   - the ask to block the step or note with (`criticStopAsk`), naming each
 *     surface, how many fixes are open, where the shots are and the branch;
 *   - the last fixes in full, for the report;
 *   - for a step, the `plan.ts block` command and the statement for the
 *     Supabase connector that write the block.
 *
 * It writes nothing itself. The branch defaults to the checked-out one; push
 * it before blocking, so the work outlives the session. Exits 1 when no
 * surface is stopped, since then there is nothing to hand over.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  criticStopAsk,
  criticStopBlockSql,
  stoppedSurfaces,
  surfaceLabels,
  type StopRound,
} from '../lib/plan/ui-check-stop';
import { ownerKey, parseOwner, parseVerdict, type CriticVerdict } from '../lib/preview/ui-checks';

const DIR = '.preview-shots/checks';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** The recorder uploads the shots only where it has the service key (scripts/ui-check.ts). */
function shotsUploaded(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && process.env.SUPABASE_SERVICE_ROLE_KEY && !url.includes('placeholder'));
}

function main(): void {
  const ownerArg = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--branch');
  if (!ownerArg) fail('Usage: npm run ui-stop -- <step or note id> [--branch <name>]');
  let owner;
  try {
    owner = parseOwner(ownerArg);
  } catch (error) {
    fail((error as Error).message);
  }
  const key = ownerKey(owner);
  const branch = arg('--branch') ?? execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (!branch) fail('Not on a branch: pass --branch <name>.');

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

  const ask = criticStopAsk({ owner: key, surfaces: stopped, branch });
  console.log(`Ask:\n${ask}\n`);
  for (const s of stopped) {
    const v = verdicts.find((x) => x.surface === s.surface && x.round === s.round)!;
    console.log(`${s.surface}, round ${s.round}: shots ${DIR}/${key}--${s.surface}--r${s.round}--*.png`);
    for (const f of v.fixes) console.log(`  - [${f.shot}] ${f.where}: ${f.problem} (${f.breaks}) -> ${f.change}`);
  }
  if (owner.step === null) {
    console.log('\nA note: block it with this ask as its note (notes skill, "Surfaces").');
    return;
  }
  console.log(`\nPush ${branch}, then block the step. With DATABASE_URL:\n`);
  console.log(`npx tsx scripts/plan.ts block ${owner.step} --ask ${JSON.stringify(ask)}\n`);
  console.log('Without it, through the Supabase connector:\n');
  const date = new Date().toISOString().slice(0, 10);
  console.log(criticStopBlockSql({ step: owner.step, ask, date }));
}

main();
