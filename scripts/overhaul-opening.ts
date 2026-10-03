/**
 * Write an approved replacement onto the plan as an overhaul held at its
 * design (plan #1527).
 *
 *   npx tsx scripts/overhaul-opening.ts --user <id> --module <m> --spec docs/X.md \
 *     --title "…" --detail "…" [--done-when "…"] [--workspace "job roles"] \
 *     [--change <spec change id>] [--write]
 *
 * Prints the SQL that writes the overhaul and its three opening rows (the
 * design session, your try-it step, and the step that writes the phases,
 * waiting on the try-it step), the dependencies between them, and the link
 * from the spec change. Pass the printed statements to the Supabase connector
 * in order, or add --write to run them in one transaction over DATABASE_URL.
 *
 * The rows are lib/plan/overhaul-opening.ts; .claude/skills/plan/reference/
 * shaping.md, "From an approved spec change", step 7, is the procedure around
 * it.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { currentSession, sessionStamp } from '../lib/plan/origin';
import { overhaulOpening, overhaulOpeningSql } from '../lib/plan/overhaul-opening';
import { isPlanScope, planScopeOf } from '../lib/plan/projects';

const argv = process.argv.slice(2);
function arg(flag: string): string | null {
  const index = argv.indexOf(flag);
  return index > -1 ? (argv[index + 1] ?? null) : null;
}
function need(flag: string): string {
  const value = arg(flag)?.trim();
  if (!value) {
    console.error(
      `${flag} is required. See the comment at the top of scripts/overhaul-opening.ts.`,
    );
    process.exit(2);
  }
  return value;
}

const moduleArg = arg('--module');
if (moduleArg && !isPlanScope(moduleArg)) {
  console.error(`"${moduleArg}" is not a module or project.`);
  process.exit(2);
}
const scope = planScopeOf(moduleArg);
const userId = need('--user');
const opening = overhaulOpening({
  title: need('--title'),
  detail: need('--detail'),
  acceptance: arg('--done-when'),
  module: scope,
  spec: need('--spec'),
  workspace: arg('--workspace'),
  stamp: sessionStamp({
    session: currentSession(process.env) ?? null,
    date: new Date().toISOString().slice(0, 10),
  }),
  ids: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
});
const statements = overhaulOpeningSql(opening, {
  userId,
  module: scope,
  changeId: arg('--change'),
});

async function write(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL is not set. Run without --write and pass the statements to the connector.',
    );
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql.begin(async (tx) => {
      let last: unknown = null;
      for (const statement of statements) last = await tx.unsafe(statement);
      return last as { number: number; title: string }[];
    });
    for (const row of rows) console.log(`#${row.number} ${row.title}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (argv.includes('--write')) {
  write().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else {
  console.log(statements.join('\n\n'));
}
