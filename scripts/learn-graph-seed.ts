/**
 * Put a graph in by hand, so the subject screen has something to show.
 *
 *   npx tsx scripts/learn-graph-seed.ts --email you@example.com
 *   npx tsx scripts/learn-graph-seed.ts --email you@example.com --remove
 *
 * The graph half of the learn module is read-only in its first slice: the
 * store, the pruning rule and the screens are built and proved before anything
 * generates into them, because a generated graph and an unproved view are two
 * ways to be wrong at once with no way to tell them apart. That leaves the
 * screens with nothing to render, and this is the "by hand" the plan step
 * means -- a small, real economics graph with every state in it, so what the
 * pruning rule does is something you can look at rather than only read about.
 *
 * It is a seed, not a fixture: it writes to whichever account you name and
 * `--remove` takes it out again. Nothing else in the module writes to these
 * tables yet.
 *
 * A direct connection rather than lib/db/admin.ts, matching scripts/notes.ts
 * and scripts/share-add.ts: that module is server-only and throws under plain
 * node. Same service-role credentials, and the same responsibility -- every
 * statement below names the user explicitly, because nothing else will.
 */
import postgres from 'postgres';

const SUBJECT = 'Economics';

/**
 * Nodes are claims, not headings. Each one is something you could be wrong
 * about, which is what makes it probeable -- "The Phillips curve" is a chapter
 * title and would not belong in this table.
 */
const CONCEPTS = [
  {
    key: 'scarcity',
    name: 'Opportunity cost',
    claim:
      'The cost of anything is the best thing you gave up to have it, not the money that changed hands.',
    state: 'known' as const,
    established: 'declared' as const,
  },
  {
    key: 'supply',
    name: 'Price as a clearing signal',
    claim:
      'A market price is whatever clears the quantity offered against the quantity wanted; it reports an equilibrium rather than measuring worth.',
    state: 'known' as const,
    established: 'tested' as const,
  },
  {
    key: 'money',
    name: 'Money is a claim on output',
    claim:
      'Holding money is holding a claim on other people’s future output, which is why printing more of it does not create more of that output.',
    state: 'shaky' as const,
    established: 'tested' as const,
  },
  {
    key: 'reserves',
    name: 'Why a bank needs reserves',
    claim:
      'A bank settles with other banks in central bank reserves, so its lending is constrained by what it can settle rather than by the notes in its vault.',
    state: 'unknown' as const,
    established: 'inferred' as const,
  },
  {
    key: 'policy-rate',
    name: 'The policy rate is a price of reserves',
    claim:
      'A central bank sets the rate at which banks borrow and hold reserves overnight, and every other rate is priced off that one.',
    state: 'unknown' as const,
    established: 'inferred' as const,
  },
  {
    key: 'stickiness',
    name: 'Wage stickiness',
    claim:
      'Wages adjust more slowly than prices, so a change in the price level moves real wages before anyone renegotiates.',
    state: 'misconception' as const,
    established: 'tested' as const,
    misconception:
      'Believes wages are sticky because of contracts alone, so expects the stickiness to vanish the moment contracts are short.',
  },
  {
    key: 'tradeoff',
    name: 'The short-run tradeoff',
    claim:
      'While expectations lag, a rise in the price level lowers real wages and raises employment — the tradeoff exists only for as long as the lag does.',
    state: 'unknown' as const,
    established: 'inferred' as const,
  },
  {
    key: 'expectations',
    name: 'Expectations close the gap',
    claim:
      'Once people expect the inflation, they price it into wages, and the employment gain disappears while the inflation stays.',
    state: 'unknown' as const,
    established: 'inferred' as const,
  },
] as const;

/** prerequisite → dependent. Acyclic, and the database refuses anything else. */
const EDGES: [string, string, string][] = [
  ['scarcity', 'supply', 'You cannot read a price as a tradeoff before you have the idea of a tradeoff.'],
  ['supply', 'money', 'Money as a claim only makes sense once prices are clearing signals.'],
  ['money', 'reserves', 'Bank reserves are a particular kind of money claim.'],
  ['reserves', 'policy-rate', 'The policy rate is the price of the thing reserves are.'],
  ['supply', 'stickiness', 'Stickiness is a statement about how fast prices move, so prices come first.'],
  ['stickiness', 'tradeoff', 'The tradeoff exists because wages lag prices.'],
  ['policy-rate', 'tradeoff', 'The tradeoff is reached through the rate that moves the price level.'],
  ['tradeoff', 'expectations', 'Expectations close a gap you have to have seen open.'],
];

function parse(argv: string[]): { email: string | null; remove: boolean } {
  let email: string | null = null;
  let remove = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') {
      email = argv[i + 1] ?? null;
      i += 1;
    }
    if (argv[i] === '--remove') remove = true;
  }
  return { email, remove };
}

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

async function main(): Promise<void> {
  const { email, remove } = parse(process.argv.slice(2));
  if (!email) {
    console.error('Usage: npx tsx scripts/learn-graph-seed.ts --email you@example.com [--remove]');
    process.exit(1);
  }

  const sql = db();

  const [user] = await sql<{ id: string }[]>`
    select id from auth.users where email = ${email} limit 1`;
  if (!user) {
    console.error(`No account with the email ${email}.`);
    await sql.end();
    process.exit(1);
  }

  if (remove) {
    const removed = await sql<{ id: string }[]>`
      delete from learn.subjects
       where user_id = ${user.id} and name = ${SUBJECT}
       returning id`;
    console.log(
      removed.length > 0
        ? `Removed the ${SUBJECT} graph. Its concepts, edges, goals and probes went with it.`
        : `No ${SUBJECT} graph to remove.`,
    );
    await sql.end();
    return;
  }

  const [existing] = await sql<{ id: string }[]>`
    select id from learn.subjects where user_id = ${user.id} and lower(name) = lower(${SUBJECT})`;
  if (existing) {
    console.error(`${email} already has a subject called ${SUBJECT}. Run with --remove first.`);
    await sql.end();
    process.exit(1);
  }

  const [subject] = await sql<{ id: string }[]>`
    insert into learn.subjects (user_id, name, note)
    values (${user.id}, ${SUBJECT},
            'Seeded by hand, to prove the view before anything generates into it.')
    returning id`;
  const subjectId = subject!.id;

  const ids = new Map<string, string>();
  for (const concept of CONCEPTS) {
    const [row] = await sql<{ id: string }[]>`
      insert into learn.concepts (user_id, subject_id, name, claim, basis, origin)
      values (${user.id}, ${subjectId}, ${concept.name}, ${concept.claim},
              'Written by hand for the first graph slice; not checked against a syllabus.',
              'manual')
      returning id`;
    ids.set(concept.key, row!.id);

    // Only where something is actually claimed. A concept with no state row
    // reads as unknown, which is the truthful default.
    if (concept.state !== 'unknown') {
      await sql`
        insert into learn.concept_state (concept_id, user_id, state, established, misconception, tested_at)
        values (${row!.id}, ${user.id}, ${concept.state}, ${concept.established},
                ${'misconception' in concept ? concept.misconception : null},
                ${concept.established === 'tested' ? sql`now()` : null})`;
    }
  }

  for (const [from, to, basis] of EDGES) {
    await sql`
      insert into learn.concept_edges (user_id, subject_id, prerequisite_id, dependent_id, basis)
      values (${user.id}, ${subjectId}, ${ids.get(from)!}, ${ids.get(to)!}, ${basis})`;
  }

  await sql`
    insert into learn.goals (user_id, subject_id, asked, concept_id, status)
    values (${user.id}, ${subjectId}, 'how raising a policy rate reaches the price of anything',
            ${ids.get('expectations')!}, 'active')`;

  console.log(`Seeded ${SUBJECT}: ${CONCEPTS.length} concepts, ${EDGES.length} edges, one goal.`);
  console.log('Open /learn/know to see it.');
  await sql.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
