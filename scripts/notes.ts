/**
 * The notes queue: read and update bug reports and feature requests.
 *
 * This is how "go knock out all the notes" is actually executed — one note
 * claimed at a time, closed with a reason and the commit that did it, so the
 * queue always reflects reality rather than intent.
 *
 *   npx tsx scripts/notes.ts list [--all]
 *   npx tsx scripts/notes.ts show <id>          # the note, and the thread under it
 *   npx tsx scripts/notes.ts start <id>
 *   npx tsx scripts/notes.ts done <id> --note "what changed" [--commit <sha>]
 *   npx tsx scripts/notes.ts block <id> --note "the question blocking it"
 *   npx tsx scripts/notes.ts decline <id> --note "why not"
 *   npx tsx scripts/notes.ts priority <id> <1|2|3>
 *   npx tsx scripts/notes.ts laws
 *
 * Ids may be given as the first 8 characters.
 *
 * Notes filed from /dev/surfaces are design notes, not defects in one screen.
 * What reads badly on one surface usually reads badly on several, so they are
 * listed apart from the rest, `laws` prints the standard they are judged
 * against, and closing one requires naming the law it broke. `--law none` is
 * allowed and means the guide is short a law -- which is how 13 to 15 got
 * written.
 */
import { execSync } from 'node:child_process';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { LAWS, RESTRAINT_LAWS, SHAPE_LAWS, SPEND_LAWS } from '../app/dev/ui/laws';
import { checkClose, surfaceOf } from '../lib/feedback/surfaces';
import { feedbackItems } from '../lib/db/schema';

/**
 * A direct connection rather than lib/db/admin.ts: that module is marked
 * server-only and throws under plain node. Same service-role credentials,
 * same responsibility to filter by user_id explicitly.
 */
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. It is needed to read the notes queue.');
    process.exit(1);
  }
  return drizzle(postgres(url, { max: 2, prepare: false }), { schema });
}

type Db = ReturnType<typeof db>;

type Status = 'open' | 'in_progress' | 'blocked' | 'planned' | 'done' | 'declined';

/** Work order: bugs before features, then priority, then oldest first. */
const QUEUE_STATUSES: Status[] = ['open', 'in_progress', 'blocked', 'planned'];

function arg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index > -1 ? (process.argv[index + 1] ?? null) : null;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Every law, in one list, read from the page that renders them. */
const ALL_LAWS = [...LAWS, ...RESTRAINT_LAWS, ...SHAPE_LAWS, ...SPEND_LAWS];

function currentCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * What has been written under a note since it was filed, oldest first.
 *
 * Read before the fix, not after it: half of what a note needs to be
 * understood arrives afterwards -- the answer to a question a run left, the
 * detail the phone was too small for -- and a run that reads only the body is
 * working from the first sentence anybody wrote about it.
 *
 * Raw SQL because `dev_comments` is not in lib/db/schema.ts, which mirrors the
 * migrations the app itself reads.
 */
type ThreadRow = { author: string; body: string; created_at: Date };

async function threadOf(database: Db, noteId: string): Promise<ThreadRow[]> {
  return database.execute<ThreadRow>(
    sql`select author, body, created_at from dev_comments
        where feedback_item_id = ${noteId}
        order by created_at`,
  );
}

async function findOne(database: Db, idPrefix: string) {
  const rows = await database
    .select()
    .from(feedbackItems)
    .where(sql`${feedbackItems.id}::text like ${`${idPrefix}%`}`);
  if (rows.length === 0) {
    console.error(`No note starting with ${idPrefix}.`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`${idPrefix} matches ${rows.length} notes. Use more characters.`);
    process.exit(1);
  }
  return rows[0]!;
}

/** One note as a single line. Returned rather than printed so it can be indented. */
function rowLine(row: typeof feedbackItems.$inferSelect, width = 72): string {
  return [
    shortId(row.id),
    row.kind === 'bug' ? 'BUG ' : 'FEAT',
    `p${row.priority}`,
    row.status.padEnd(11),
    row.body.replace(/\s+/g, ' ').slice(0, width),
  ].join('  ');
}

function printRow(row: typeof feedbackItems.$inferSelect, verbose = false): void {
  console.log(rowLine(row, verbose ? 400 : 72));
  if (verbose) {
    if (row.pagePath) console.log(`        page: ${row.pagePath}`);
    if (row.resolutionNote) console.log(`        note: ${row.resolutionNote}`);
    if (row.commitSha) console.log(`        commit: ${row.commitSha}`);
    console.log(`        created: ${row.createdAt.toISOString().slice(0, 16)}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'list';

  // Before the connection, because it needs none -- and because DATABASE_URL is
  // unset in Claude Code on the web, which the skill calls the normal case for a
  // scheduled run. A standard readable only when the database happens to be
  // reachable is a standard that goes unread exactly while it is being applied.
  if (command === 'laws') {
    for (const law of ALL_LAWS) {
      console.log(`${String(law.n).padStart(2)}. ${law.title}`);
      console.log(`    ${law.body.replace(/\s+/g, ' ')}\n`);
    }
    console.log('Rendered, with worked examples: /dev/ui — app/dev/ui/laws.ts is the source.');
    return;
  }

  const database = db();

  if (command === 'list') {
    const all = process.argv.includes('--all');
    const rows = await database
      .select()
      .from(feedbackItems)
      .where(all ? sql`true` : inArray(feedbackItems.status, QUEUE_STATUSES))
      .orderBy(
        // Bugs first, then priority, then oldest — the order to work them in.
        sql`case when ${feedbackItems.kind} = 'bug' then 0 else 1 end`,
        feedbackItems.priority,
        feedbackItems.createdAt,
      );

    if (rows.length === 0) {
      console.log(all ? 'No notes at all.' : 'Queue is empty — nothing open.');
      return;
    }

    // Two lists, not one. A design note read in isolation gets fixed in
    // isolation, and the pattern across five of them is the actual defect.
    // Grouped, "these are all law 13" is visible before any of them is claimed.
    const ordinary = rows.filter((row) => !surfaceOf(row.pagePath));
    const design = rows.filter((row) => surfaceOf(row.pagePath));

    for (const row of ordinary) printRow(row);

    if (design.length > 0) {
      const bySurface = new Map<string, typeof design>();
      for (const row of design) {
        const key = surfaceOf(row.pagePath)!;
        bySurface.set(key, [...(bySurface.get(key) ?? []), row]);
      }
      console.log(
        `\n── ${design.length} surface note(s) across ${bySurface.size} surface(s) ──\n` +
          'Read all of them before starting. The unit of work is the law, not\n' +
          'the note: cluster them, fix each law everywhere, close the cluster\n' +
          'together. `notes.ts laws` prints the standard.\n',
      );
      for (const [surface, notes] of bySurface) {
        console.log(`  ${surface}`);
        for (const row of notes) console.log(`    ${rowLine(row, 64)}`);
      }
    }

    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `\n${rows.length} note(s): ` +
        Object.entries(counts)
          .map(([status, count]) => `${count} ${status}`)
          .join(', '),
    );
    if (counts.blocked) {
      console.log('Blocked notes are waiting on an answer — surface them to the user.');
    }
    return;
  }

  const idPrefix = process.argv[3];
  if (!idPrefix) {
    console.error('Give a note id (first 8 characters is enough).');
    process.exit(1);
  }
  const row = await findOne(database, idPrefix);

  if (command === 'show') {
    printRow(row, true);
    console.log(`\n${row.body}`);

    const thread = await threadOf(database, row.id);
    if (thread.length > 0) {
      console.log('\nWritten under it since:');
      for (const comment of thread) {
        const who = comment.author === 'claude' ? 'claude' : 'user';
        const when = new Date(comment.created_at).toISOString().slice(0, 10);
        console.log(`  ${who} ${when}: ${comment.body.replace(/\s+/g, ' ')}`);
      }
    }
    return;
  }

  if (command === 'priority') {
    const value = Number(process.argv[4]);
    if (![1, 2, 3].includes(value)) {
      console.error('Priority must be 1 (next), 2 (normal) or 3 (someday).');
      process.exit(1);
    }
    await database
      .update(feedbackItems)
      .set({ priority: value })
      .where(eq(feedbackItems.id, row.id));
    console.log(`${shortId(row.id)} priority ${value}`);
    return;
  }

  const note = arg('--note');

  if (command === 'start') {
    await database
      .update(feedbackItems)
      .set({ status: 'in_progress' })
      .where(and(eq(feedbackItems.id, row.id), eq(feedbackItems.userId, row.userId)));
    console.log(`${shortId(row.id)} in_progress`);
    return;
  }

  // Closing a note always records why. A status with no reason is how a queue
  // becomes untrustworthy.
  if (command === 'done' || command === 'block' || command === 'decline') {
    if (!note) {
      console.error(`--note is required for ${command}: say what happened.`);
      process.exit(1);
    }
    const status: Status =
      command === 'done' ? 'done' : command === 'block' ? 'blocked' : 'declined';

    // The rule itself lives in lib/feedback/surfaces.ts, with tests. This
    // command only reports what it decides.
    const decision = checkClose({
      pagePath: row.pagePath,
      command,
      note,
      law: arg('--law'),
      lawNumbers: ALL_LAWS.map((law) => law.n),
    });
    if (!decision.ok) {
      console.error(decision.error);
      process.exit(1);
    }
    const resolution = decision.resolution;

    await database
      .update(feedbackItems)
      .set({
        status,
        resolutionNote: resolution,
        commitSha: command === 'done' ? (arg('--commit') ?? currentCommit()) : null,
        // Blocked notes are not finished, so they get no completion time.
        completedAt: command === 'block' ? null : new Date(),
      })
      .where(and(eq(feedbackItems.id, row.id), eq(feedbackItems.userId, row.userId)));
    console.log(`${shortId(row.id)} ${status}: ${resolution}`);
    return;
  }

  console.error(`Unknown command "${command}".`);
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
