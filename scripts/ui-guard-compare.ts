/**
 * The shooting half of `npm run ui-guard -- <n> --compare` (plan #2815.3):
 * a preview of this checkout and one of origin/main, every surface the step
 * reached through a shared file shot on both, and the shots compared. The
 * rule (which surfaces, what the report says) is lib/plan/ui-compare.ts.
 *
 * The branch's preview is the one already on PREVIEW_PORT (3400 by default)
 * when it was built after the step's files last changed; otherwise this
 * builds and starts it. Main's is built in a worktree of origin/main under the
 * system's temp folder, kept between runs and rebuilt only when origin/main
 * has moved, and served on PREVIEW_PORT + 1000. Each side is shot by
 * `--workers` shooters at once (three by default), each with its own
 * Chromium, into .preview-shots/ and .preview-shots/before/. A server this
 * started is stopped at the end.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BEFORE_SHOTS_DIR } from '../lib/preview/ui-checks';
import { compareSurfaceShots, fileShotReader, type ShotComparison } from '../lib/plan/ui-settle-diff';
import { mainPreviewPort, probePort, shares, type CompareTimings } from '../lib/plan/ui-compare';

/** The placeholders screen.md builds the preview with; both sides get the same. */
const PREVIEW_ENV = {
  UI_PREVIEW: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
  NEXT_TELEMETRY_DISABLED: '1',
};

/** The gallery's index on `port`: its text, 'not-preview' for a server built without UI_PREVIEW, or null for none. */
async function galleryIndex(port: number): Promise<string | 'not-preview' | null> {
  try {
    const response = await fetch(`http://localhost:${port}/preview`);
    if (response.status === 404) return 'not-preview';
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function servedIds(index: string): Set<string> {
  return new Set([...index.matchAll(/\/preview\?s=([\w-]+)/g)].map((m) => m[1]!));
}

function git(cwd: string, args: string[]): string {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.trim()}`);
  return run.stdout.trim();
}

/**
 * NODE_OPTIONS with the 8 GB heap CI and the gate give a build, added to what
 * it already holds (cloud sessions set --use-openssl-ca). Without it the
 * build's type check runs out of memory on this repository.
 */
export function withHeap(options: string | undefined): string {
  const held = (options ?? '').trim();
  if (/(^|\s)--max-old-space-size=/.test(held)) return held;
  return held ? `${held} --max-old-space-size=8192` : '--max-old-space-size=8192';
}

/** Builds the preview in `dir`, its output in a log beside the shots. */
function build(dir: string, log: string): void {
  console.log(`Building the preview in ${dir} (log: ${log}).`);
  const fd = openSync(log, 'w');
  const run = spawnSync('npx', ['next', 'build'], {
    cwd: dir,
    env: { ...process.env, ...PREVIEW_ENV, NODE_OPTIONS: withHeap(process.env.NODE_OPTIONS) },
    stdio: ['ignore', fd, fd],
  });
  if (run.status !== 0) throw new Error(`The preview build in ${dir} failed; ${log} has why.`);
}

/** Starts `next start` in `dir` on `port` and waits for the gallery to answer. */
async function serve(dir: string, port: number, log: string): Promise<ChildProcess> {
  const fd = openSync(log, 'a');
  const server = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: dir,
    env: { ...process.env, ...PREVIEW_ENV },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  for (let i = 0; i < 120; i++) {
    const index = await galleryIndex(port);
    if (typeof index === 'string' && index !== 'not-preview') return server;
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop(server);
  throw new Error(`The preview in ${dir} did not answer on :${port} within two minutes; ${log} has why.`);
}

function stop(server: ChildProcess | null): void {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/** The newest change among the step's files that are on disk, and HEAD's commit time. */
function newestChange(root: string, files: readonly string[]): number {
  let newest = Number(git(root, ['log', '-1', '--format=%ct', 'HEAD'])) * 1000;
  for (const file of files) {
    const full = join(root, file);
    if (existsSync(full)) newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

/** This checkout's preview: the running one when it is current, else one this builds. */
async function branchPreview(
  root: string,
  port: number,
  files: readonly string[],
): Promise<{ index: string; server: ChildProcess | null }> {
  const running = await galleryIndex(port);
  if (running === 'not-preview') {
    throw new Error(`The server on :${port} was built without UI_PREVIEW. Stop it and run this again.`);
  }
  const buildId = join(root, '.next/BUILD_ID');
  if (typeof running === 'string') {
    if (existsSync(buildId) && statSync(buildId).mtimeMs >= newestChange(root, files)) {
      console.log(`Using this checkout's preview on :${port}.`);
      return { index: running, server: null };
    }
    throw new Error(
      `The preview on :${port} was built before the step's last change, so its shots would be main's or ` +
        'an older draft. Stop it (it is npm run preview) and run this again; this builds and starts a fresh one.',
    );
  }
  build(root, join(root, '.preview-shots/compare-branch-build.log'));
  const server = await serve(root, port, join(root, '.preview-shots/compare-branch-build.log'));
  return { index: (await galleryIndex(port)) as string, server };
}

/**
 * Main's preview, in a worktree of origin/main kept under the temp folder for
 * this checkout. It is rebuilt only when origin/main has moved since its build.
 */
async function mainPreview(root: string, port: number): Promise<{ index: string; server: ChildProcess | null }> {
  const running = await galleryIndex(port);
  const dir = join(tmpdir(), `ui-guard-main-${createHash('sha1').update(root).digest('hex').slice(0, 10)}`);
  const marker = join(dir, '.next/ui-guard-built');
  spawnSync('git', ['fetch', 'origin', 'main'], { cwd: root, stdio: 'ignore' });
  const sha = git(root, ['rev-parse', 'origin/main']);
  const builtSha = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
  if (typeof running === 'string' && running !== 'not-preview' && builtSha === sha) {
    console.log(`Using main's preview on :${port} (${sha.slice(0, 7)}).`);
    return { index: running, server: null };
  }
  if (running !== null) {
    throw new Error(`Something else answers on :${port}, where main's preview goes. Stop it or set PREVIEW_PORT.`);
  }
  if (!existsSync(dir)) {
    git(root, ['worktree', 'add', '--detach', dir, sha]);
  } else {
    git(dir, ['checkout', '--detach', '--force', sha]);
  }
  // Turbopack refuses a node_modules symlink that points outside the
  // worktree, so it gets a hard-linked copy (screen.md, step 1).
  if (!existsSync(join(dir, 'node_modules'))) {
    const copy = spawnSync('cp', ['-al', join(root, 'node_modules'), join(dir, 'node_modules')]);
    if (copy.status !== 0) throw new Error(`Could not give ${dir} a copy of node_modules.`);
  }
  if (builtSha !== sha) {
    build(dir, join(root, '.preview-shots/compare-main-build.log'));
    writeFileSync(marker, sha);
  }
  const server = await serve(dir, port, join(root, '.preview-shots/compare-main-build.log'));
  return { index: (await galleryIndex(port)) as string, server };
}

/** Shoots `surfaces` from `port` into `out`, with `workers` shooters at once. */
async function shoot(
  root: string,
  surfaces: readonly string[],
  port: number,
  side: 'branch' | 'main',
  out: string,
  workers: number,
  previewPort: number,
): Promise<void> {
  const runs = shares(surfaces, workers).map(
    (share, worker) =>
      new Promise<void>((resolve, reject) => {
        const log = join(root, `.preview-shots/compare-shoot-${side}-${worker}.log`);
        const child = spawn('npx', ['tsx', 'scripts/shoot.ts', ...share], {
          cwd: root,
          env: {
            ...process.env,
            PREVIEW_PORT: String(port),
            SHOOT_PROBE_PORT: String(probePort(previewPort, side, worker)),
            SHOOT_OUT: out,
          },
          stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')],
        });
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`A shooter on ${side} failed; ${log} has why.`)),
        );
      }),
  );
  await Promise.all(runs);
}

/** Removes the shots a surface had, so a missing one is not stood in for by an old one. */
function clearShots(dir: string, surfaces: readonly string[]): void {
  if (!existsSync(dir)) return;
  const prefixes = surfaces.map((s) => `${s}--`);
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.png') && prefixes.some((p) => file.startsWith(p))) rmSync(join(dir, file));
  }
}

/**
 * Shoots `reached` on this checkout and on origin/main and compares each
 * surface's four shots. A surface main's gallery lacks is shot on the branch
 * only and comes back unshot, which is right: a new surface needs the critic.
 */
export async function compareWithMain(input: {
  root: string;
  files: readonly string[];
  reached: readonly string[];
  workers: number;
}): Promise<{ comparisons: ShotComparison[]; newOnBranch: string[]; timings: CompareTimings }> {
  const { root, files, reached, workers } = input;
  const previewPort = Number(process.env.PREVIEW_PORT ?? '3400');
  const mainPort = mainPreviewPort(previewPort);
  mkdirSync(join(root, BEFORE_SHOTS_DIR), { recursive: true });

  const servers: (ChildProcess | null)[] = [];
  try {
    const started = Date.now();
    const branch = await branchPreview(root, previewPort, files);
    servers.push(branch.server);
    const main = await mainPreview(root, mainPort);
    servers.push(main.server);
    const built = Date.now();

    const onMain = servedIds(main.index);
    const onBranch = servedIds(branch.index);
    const branchSurfaces = reached.filter((s) => onBranch.has(s));
    const mainSurfaces = reached.filter((s) => onMain.has(s));
    const newOnBranch = reached.filter((s) => !onMain.has(s));
    clearShots(join(root, '.preview-shots'), reached);
    clearShots(join(root, BEFORE_SHOTS_DIR), reached);
    console.log(
      `Shooting ${branchSurfaces.length} surfaces on this checkout and ${mainSurfaces.length} on main, ` +
        `${workers} shooter${workers === 1 ? '' : 's'} a side.`,
    );
    await Promise.all([
      shoot(root, branchSurfaces, previewPort, 'branch', join(root, '.preview-shots'), workers, previewPort),
      mainSurfaces.length > 0
        ? shoot(root, mainSurfaces, mainPort, 'main', join(root, BEFORE_SHOTS_DIR), workers, previewPort)
        : Promise.resolve(),
    ]);
    const shot = Date.now();

    const read = fileShotReader(root);
    const comparisons: ShotComparison[] = [];
    for (const surface of reached) comparisons.push(await compareSurfaceShots(surface, read));
    const compared = Date.now();
    return {
      comparisons,
      newOnBranch,
      timings: { build: built - started, shoot: shot - built, compare: compared - shot },
    };
  } finally {
    for (const server of servers) stop(server);
  }
}
