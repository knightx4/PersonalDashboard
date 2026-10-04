/**
 * The phone checks on the gallery surfaces a change touched
 * (docs/UI-QUALITY-SPEC.md, Part 5).
 *
 *   npm run check:phone                    # the surfaces this branch touched
 *   npm run check:phone -- <id> [<id>…]    # these surfaces
 *   npm run check:phone -- --all           # every surface
 *   npm run check:phone -- --record        # measure every surface into a new baseline
 *
 * Each surface is opened at 390 pixels in a headless Chromium and measured
 * for sideways scrolling, press targets under 44 pixels, pressable things
 * under the dock, and text under the contrast floor in light and dark (see
 * tests/interaction/checks.ts). A surface that declares a deck
 * (lib/preview/deck.ts) is also pressed: Next has to show the next item with
 * the network held, and every control and link has to show a press within
 * 100ms (tests/interaction/deck.ts). Counts are held against
 * scripts/phone-baseline.json: one that rises fails, one that falls is
 * written back, to be committed with the change that lowered it. `--record`
 * writes the baseline from scratch and refuses when one exists: it made the
 * first one from main, and is not a way to raise a count.
 *
 * "Touched" is worked out the way the plan brief works it out: the files that
 * differ from the merge base with origin/main (origin/main itself in a
 * shallow clone), committed or not, mapped to
 * surfaces by lib/preview/routes.ts and lib/preview/importers.ts, plus any
 * surface the branch added to SURFACE_ROUTES.
 *
 * It needs a production build in .next (the gate's Build step makes one).
 * It serves that build itself with UI_PREVIEW=1 on a free port (PHONE_PORT to
 * choose one), so it never measures a preview server left running from an
 * earlier build, unless PREVIEW_URL names a server to use instead. With nothing touched it starts nothing and passes.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { parseTheme } from '../lib/theme';
import { importedBy, pagesUsing } from '../lib/preview/importers';
import { SURFACE_ROUTES, surfacesForFiles } from '../lib/preview/routes';
import { compare, sortBaseline, surfaceIdsIn, touchedSurfaces, type Baseline } from '../tests/interaction/baseline';
import { chromePath, launch } from '../tests/interaction/browser';
import { CHECK_RULES, checkPage, type Findings } from '../tests/interaction/checks';
import { checkDeck } from '../tests/interaction/deck';
import { readDecks } from '../lib/preview/deck';

const ROOT = process.cwd();
const BASELINE = join(ROOT, 'scripts/phone-baseline.json');
const PORT = process.env.PHONE_PORT;

/**
 * A port nothing is listening on. A fixed one would let a server left running
 * from an earlier build answer in place of this build's, and the checks would
 * pass or fail on code that is not the code being checked.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
const THEMES = [parseTheme('light'), parseTheme('dark')];

const git = (command: string) =>
  execSync(`git ${command}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The surfaces this branch touched, against its merge base with origin/main. */
function touched(): string[] {
  // A shallow clone (Claude Code on the web) has no merge base to find. The
  // gate runs after origin/main is merged in, so main itself is then the base.
  let base = 'origin/main';
  try {
    base = git('merge-base origin/main HEAD').trim();
  } catch {
    // Keep origin/main.
  }
  const files = [
    ...git(`diff --name-only ${base}`).split('\n'),
    ...git('ls-files --others --exclude-standard').split('\n'),
  ].filter(Boolean);
  const graph = importedBy(ROOT);
  const served = surfacesForFiles(files, (file) => pagesUsing(file, graph));
  let before: string[] = [];
  try {
    before = surfaceIdsIn(git(`show ${base}:lib/preview/routes.ts`));
  } catch {
    // No routes file on the base: every surface is new.
  }
  return touchedSurfaces(served, before, Object.keys(SURFACE_ROUTES));
}

function readBaseline(): Baseline {
  return existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline) : {};
}

async function serve(): Promise<{ url: string; stop: () => void }> {
  if (process.env.PREVIEW_URL) return { url: process.env.PREVIEW_URL.replace(/\/$/, ''), stop: () => {} };
  if (!existsSync(join(ROOT, '.next/BUILD_ID'))) {
    throw new Error('No build in .next. Run `npm run build` first (the gate builds before this runs).');
  }
  const port = PORT ?? String(await freePort());
  const url = `http://localhost:${port}`;
  const child: ChildProcess = spawn(join(ROOT, 'node_modules/.bin/next'), ['start', '-p', port], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      UI_PREVIEW: '1',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
    },
  });
  const stop = () => {
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      // Already gone.
    }
  };
  for (let tries = 0; tries < 120; tries++) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode} on :${port}.`);
    try {
      const reply = await fetch(`${url}/preview`);
      if (reply.status === 404) {
        stop();
        throw new Error(`${url}/preview is 404: the server did not take UI_PREVIEW=1.`);
      }
      if (reply.ok) return { url, stop };
    } catch (error) {
      if (error instanceof Error && error.message.includes('UI_PREVIEW')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stop();
  throw new Error(`The preview server on :${port} did not answer within a minute.`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const record = args.includes('--record');
  if (record && existsSync(BASELINE)) {
    console.error('scripts/phone-baseline.json exists. --record only makes the first one; counts only go down.');
    return 1;
  }
  const all = args.includes('--all') || record;
  const named = args.filter((arg) => !arg.startsWith('--'));
  const unknown = named.filter((id) => !(id in SURFACE_ROUTES));
  if (unknown.length > 0) {
    console.error(`No surface named ${unknown.join(', ')} in lib/preview/routes.ts.`);
    return 1;
  }
  const surfaces = all ? Object.keys(SURFACE_ROUTES) : named.length > 0 ? named : touched();
  if (surfaces.length === 0) {
    console.log('✓ phone checks: no gallery surface touched');
    return 0;
  }
  if (!chromePath()) {
    console.error('No Chromium for the phone checks: set PHONE_CHROME, or PLAYWRIGHT_BROWSERS_PATH to where one is.');
    return 1;
  }

  console.log(`phone checks on ${surfaces.length} surface${surfaces.length === 1 ? '' : 's'}: ${surfaces.join(', ')}`);
  const server = await serve();
  const browser = await launch();
  const measured: Record<string, Findings> = {};
  try {
    const decks = readDecks(await (await fetch(`${server.url}/preview`)).text());
    for (const surface of surfaces) {
      const url = `${server.url}/preview?s=${surface}`;
      await browser.page.open(url);
      measured[surface] = await checkPage(browser.page, THEMES);
      const deck = decks[surface];
      if (deck) Object.assign(measured[surface], await checkDeck(browser.page, url, deck));
    }
  } finally {
    await browser.close();
    server.stop();
  }

  if (record) {
    const counts: Baseline = {};
    for (const [surface, findings] of Object.entries(measured)) {
      counts[surface] = Object.fromEntries(Object.entries(findings).map(([check, lines]) => [check, lines.length]));
    }
    writeFileSync(BASELINE, JSON.stringify(sortBaseline(counts), null, 2) + '\n');
    console.log(`Recorded ${surfaces.length} surfaces in scripts/phone-baseline.json.`);
    return 0;
  }

  const baseline = readBaseline();
  const { rises, next, lowered } = compare(baseline, measured);
  // A surface gone from the gallery takes its counts with it.
  const gone = Object.keys(next).filter((surface) => !(surface in SURFACE_ROUTES));
  for (const surface of gone) delete next[surface];

  if (rises.length > 0) {
    for (const rise of rises) {
      console.error(
        `\n✗ ${rise.surface}: ${CHECK_RULES[rise.check]}. ${rise.now} found, the baseline allows ${rise.was}:`,
      );
      for (const line of rise.findings) console.error(`    ${line}`);
    }
    console.error(
      `\nphone checks: ${rises.length} rise${rises.length === 1 ? '' : 's'}. Fix what the change added; ` +
        'the baseline (scripts/phone-baseline.json) only goes down.',
    );
    return 1;
  }

  if (lowered.length > 0 || gone.length > 0) {
    writeFileSync(BASELINE, JSON.stringify(sortBaseline(next), null, 2) + '\n');
    if (lowered.length > 0) {
      console.log(`Lowered in scripts/phone-baseline.json (commit it):\n  ${lowered.join('\n  ')}`);
    }
  }
  console.log(`✓ phone checks: ${surfaces.length} surface${surfaces.length === 1 ? '' : 's'} at or under the baseline`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
