/**
 * Put material in the catalogue, and embed what is in there.
 *
 *   npm run catalogue -- "Marginal utility"
 *   npm run catalogue -- "Marginal utility" "Indifference curve"
 *   npm run catalogue -- --course PLE7DDD91010BC51F8
 *   npm run catalogue -- --course PLE7DDD91010BC51F8 --provider yale-courses
 *   npm run catalogue -- --embed
 *   npm run catalogue -- "Marginal utility" --embed --limit 200
 *
 * One article becomes one `learn.catalogue_items` row and one
 * `learn.catalogue_segments` row per section, each carrying the section's
 * anchor, its heading and its text. Running it again on the same article
 * updates those rows rather than adding more, and drops the sections the
 * article no longer has.
 *
 * `--course` takes a YouTube playlist id and stores the course under it: one
 * item of kind `course`, one of kind `video` per lecture, and
 * `learn.catalogue_course_items` for the order the institution published them
 * in. It needs `YOUTUBE_API_KEY` and costs three quota units of ten thousand
 * for a forty-lecture course. `--provider` says which seeded provider the
 * playlist belongs to, and defaults to MIT OpenCourseWare. For an MIT course
 * each lecture's transcript is read from ocw.mit.edu and cut into timed
 * segments; a lecture with none found there is cut on its chapter markers or
 * kept as one segment, and the run prints how many went each way.
 *
 * Fetching embeds nothing: segments land with a null `embedding`, and
 * `--embed` is the second pass over everything that still has one. That pass
 * is driven by the nulls rather than by what this run fetched, so it finishes
 * whatever an earlier run left behind, and stopping it halfway costs only the
 * chunk it was in.
 *
 * `--embed` spends money on somebody's behalf, and #741 settled whose: the
 * account running the sweep. `--user` names it by id or email, `CATALOGUE_USER`
 * does the same from the environment, and with one account in the database
 * neither is needed. It needs `EMBEDDING_API_KEY` as well as `DATABASE_URL`.
 *
 * Two things about how it is run.
 *
 * `--conditions=react-server`, which is what the npm script adds, is there
 * because the fetch path is a `server-only` module and that package throws on
 * import under plain node. The flag picks its empty build, the same one Next
 * resolves on the server. Without it this script cannot import the one module
 * allowed to reach the web.
 *
 * A direct `postgres` connection rather than lib/db/admin.ts, matching
 * scripts/learn-graph-seed.ts and scripts/notes.ts: that module is server-only
 * too, and wants Drizzle's public-schema types. Same service-role credentials.
 * The catalogue tables carry no user id, so there is nothing here to filter by
 * -- they are reference data, shared by every account, and that is the whole
 * reason the sweeps run privileged. The one row with an owner is the spend row,
 * which is why the account has to be resolved before the sweep starts rather
 * than after it has spent.
 */
import postgres from 'postgres';
import { embedCatalogueSegments } from '../lib/learn/catalogue/embed-sweep';
import {
  DEFAULT_COURSE_PROVIDER,
  sweepWikipediaArticle,
  sweepYouTubeCourse,
} from '../lib/learn/catalogue/sweep';

type Args = {
  titles: string[];
  courses: string[];
  provider: string;
  embed: boolean;
  user: string | null;
  limit: number | null;
};

function parse(argv: string[]): Args {
  const titles: string[] = [];
  const courses: string[] = [];
  let provider = DEFAULT_COURSE_PROVIDER;
  let embed = false;
  let user = process.env.CATALOGUE_USER ?? null;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--embed') embed = true;
    else if (arg === '--user') user = argv[(i += 1)] ?? null;
    else if (arg === '--limit') limit = Number(argv[(i += 1)]);
    else if (arg === '--course') courses.push(argv[(i += 1)] ?? '');
    else if (arg === '--provider') provider = argv[(i += 1)] ?? provider;
    else if (arg.trim() !== '') titles.push(arg);
  }

  return {
    titles,
    courses: courses.filter((id) => id.trim() !== ''),
    provider,
    embed,
    user,
    limit: Number.isFinite(limit) && limit ? limit : null,
  };
}

function db(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

/**
 * Whose ledger the embedding goes on, the same way scripts/plan.ts resolves
 * one: what you named, else the only account there is. Refused rather than
 * guessed when there are two, because the wrong answer here is a bill on
 * somebody else's screen.
 */
async function resolveUser(sql: postgres.Sql, wanted: string | null): Promise<string> {
  if (wanted) {
    const rows = await sql<{ id: string }[]>`
      select id from auth.users
       where id::text like ${`${wanted}%`} or email like ${`${wanted}%`}`;
    if (rows.length === 1) return rows[0].id;
    console.error(
      rows.length === 0 ? `No account matches "${wanted}".` : `"${wanted}" matches ${rows.length} accounts.`,
    );
    process.exit(1);
  }

  const users = await sql<{ id: string }[]>`select id from auth.users`;
  if (users.length === 1) return users[0].id;
  console.error(
    users.length === 0
      ? 'No accounts in this database, so there is nobody to bill the embedding to.'
      : 'More than one account here. Say which the embedding is billed to with --user <id or email>.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { titles, courses, provider, embed, user, limit } = parse(process.argv.slice(2));
  if (titles.length === 0 && courses.length === 0 && !embed) {
    console.error(
      'Usage: npm run catalogue -- "Marginal utility" ["Indifference curve" ...] [--course <playlist id>] [--provider <slug>] [--embed]',
    );
    process.exit(1);
  }

  const sql = db();
  let failed = 0;

  for (const title of titles) {
    const result = await sweepWikipediaArticle(sql, title);
    if (!result.ok) {
      failed += 1;
      console.error(`${title}: ${result.reason} -- ${result.detail}`);
      continue;
    }
    const dropped = result.removed > 0 ? `, ${result.removed} dropped` : '';
    console.log(`${result.title}: ${result.written} segments${dropped}`);
  }

  for (const playlistId of courses) {
    const result = await sweepYouTubeCourse(sql, { providerSlug: provider, playlistId });
    if (!result.ok) {
      failed += 1;
      console.error(`${playlistId}: ${result.reason} -- ${result.detail}`);
      continue;
    }
    const dropped = result.removed > 0 ? `, ${result.removed} dropped` : '';
    console.log(
      `${result.title}: ${result.videos} lectures, ${result.written} segments${dropped}`,
    );
    console.log(
      `  cut from ${result.cutBy.transcript} transcripts, ${result.cutBy.chapters} chapter lists, ` +
        `${result.cutBy.whole} whole videos.`,
    );
  }

  if (embed) {
    const userId = await resolveUser(sql, user);
    const swept = await embedCatalogueSegments(sql, { userId, limit: limit ?? undefined });

    const model = swept.model ? ` by ${swept.model}` : '';
    console.log(
      `Embedded ${swept.embedded} segments${model}, ${swept.tokens} tokens over ${swept.calls} calls.`,
    );
    if (swept.skipped > 0) {
      console.log(`${swept.skipped} segments changed while they were being embedded and were left for the next run.`);
    }
    if (swept.stopped) {
      failed += 1;
      console.error(`Stopped: ${swept.stopped.reason} -- ${swept.stopped.detail}`);
    }
  }

  await sql.end();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
