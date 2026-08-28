/**
 * The notes queue: read and update bug reports and feature requests.
 *
 * This is how "go knock out all the notes" is actually executed — one note
 * claimed at a time, closed with a reason and the commit that did it, so the
 * queue always reflects reality rather than intent.
 *
 *   npx tsx scripts/notes.ts list [--all]
 *   npx tsx scripts/notes.ts show <id>
 *   npx tsx scripts/notes.ts start <id>
 *   npx tsx scripts/notes.ts done <id> --note "what changed" [--commit <sha>]
 *   npx tsx scripts/notes.ts block <id> --note "the question blocking it"
 *   npx tsx scripts/notes.ts decline <id> --note "why not"
 *   npx tsx scripts/notes.ts priority <id> <1|2|3>
 *
 * Ids may be given as the first 8 characters.
 */
import { execSync } from 'node:child_process';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
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

function currentCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
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

function printRow(row: typeof feedbackItems.$inferSelect, verbose = false): void {
  const flag = row.kind === 'bug' ? 'BUG ' : 'FEAT';
  const line = [
    shortId(row.id),
    flag,
    `p${row.priority}`,
    row.status.padEnd(11),
    row.body.replace(/\s+/g, ' ').slice(0, verbose ? 400 : 72),
  ].join('  ');
  console.log(line);
  if (verbose) {
    if (row.pagePath) console.log(`        page: ${row.pagePath}`);
    if (row.resolutionNote) console.log(`        note: ${row.resolutionNote}`);
    if (row.commitSha) console.log(`        commit: ${row.commitSha}`);
    console.log(`        created: ${row.createdAt.toISOString().slice(0, 16)}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'list';
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
    for (const row of rows) printRow(row);

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

    await database
      .update(feedbackItems)
      .set({
        status,
        resolutionNote: note,
        commitSha: command === 'done' ? (arg('--commit') ?? currentCommit()) : null,
        // Blocked notes are not finished, so they get no completion time.
        completedAt: command === 'block' ? null : new Date(),
      })
      .where(and(eq(feedbackItems.id, row.id), eq(feedbackItems.userId, row.userId)));
    console.log(`${shortId(row.id)} ${status}: ${note}`);
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
