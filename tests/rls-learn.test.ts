/**
 * Cross-user isolation for the learn module, written before any feature code.
 *
 * The same rule as build step 2, applied to a fifth schema: a table that
 * arrives without a policy has to fail here, immediately, rather than in
 * production months later. The coverage test below is what forces this file to
 * be updated whenever the schema grows.
 *
 * Two things here are worth more than the usual "can B read A's rows". The
 * first is `tracks.question` -- the thing you were stuck on, in your own
 * words -- which is closer in kind to a vault note than to an order. The
 * second is the composite foreign keys: readings join their two parents on
 * (id, user_id) precisely because a plain foreign key bypasses RLS and would
 * happily accept another account's track. That is a database-level claim and
 * it is asserted rather than assumed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

let userA = '';
let userB = '';
let trackA = '';
let trackB = '';
let sourceA = '';
let sourceB = '';
let readingA = '';

async function seedTrack(userId: string, title: string, question: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into tracks (user_id, title, question)
    values (${userId}, ${title}, ${question})
    returning id`;
  return row.id;
}

async function seedSource(userId: string, title: string, url: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into sources (user_id, title, author, kind, canonical_url, access)
    values (${userId}, ${title}, 'Hayek', 'article', ${url}, 'open')
    returning id`;
  return row.id;
}

async function seedReading(
  userId: string,
  trackId: string,
  sourceId: string,
  basis: string,
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into readings (user_id, track_id, source_id, locator_basis, locator_label)
    values (${userId}, ${trackId}, ${sourceId}, ${basis}, 'Whole essay')
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('learn-a@example.com');
  userB = await createUser('learn-b@example.com');

  trackA = await seedTrack(userA, 'Value and price', 'Why does price break down when endowments differ?');
  trackB = await seedTrack(userB, 'Bob reads things', 'Bob has his own question.');

  sourceA = await seedSource(userA, 'The Use of Knowledge in Society', 'https://example.org/a');
  sourceB = await seedSource(userB, 'The Use of Knowledge in Society', 'https://example.org/b');

  readingA = await seedReading(userA, trackA, sourceA, 'Found verbatim in the fetched page.');
  await seedReading(userB, trackB, sourceB, 'Model knowledge, unconfirmed.');

  await admin`
    insert into imports (user_id, track_id, raw_text, source_hint)
    values (${userA}, ${trackA}, 'Sen, Walzer, Dworkin, Hayek, Weyl', 'claude')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in the schema', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'learn' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  // The graph half of the schema, and the quiz tables, are seeded and checked
  // in rls-learn-graph.test.ts. They are listed here so this assertion keeps
  // doing its job: a table that arrives with no isolation test anywhere breaks
  // this line first.
  it('seeds every table, so a new one cannot skip the isolation check', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'learn' and c.relkind = 'r'
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([
      'aims',
      'area_check_articles',
      'area_domains',
      'area_fields',
      'catalogue_course_items',
      'catalogue_items',
      'catalogue_judgements',
      'catalogue_links',
      'catalogue_providers',
      'catalogue_segments',
      'concept_edges',
      'concept_mentions',
      'concept_state',
      'concept_subjects',
      'concepts',
      'curriculum_units',
      'feed_cards',
      'goals',
      'imports',
      'next_outcomes',
      'opening_questions',
      'opening_sweeps',
      'probes',
      'quiz_questions',
      'quiz_sources',
      'quizzes',
      'readings',
      'sources',
      'subjects',
      'theme_fields',
      'track_offers',
      'tracks',
      'transcript_calls',
      'video_transcripts',
    ]);
  });
});

describe('the areas, which change only by migration', () => {
  // The fixed grid the Know dashboard counts against. Like the catalogue it
  // carries no user_id, so the questions are that everybody can read it, that
  // nobody can write it through the API, and that the seed is the one the spec
  // lists. It survives truncateAll because nothing in it hangs off auth.users.
  it('lets any signed-in user read the grid', async () => {
    const domains = await asUser(userB, (tx) => tx`select slug from area_domains`);
    const fields = await asUser(userB, (tx) => tx`select slug from area_fields`);
    expect(domains.length).toBe(10);
    // 46 from 0027, and World and regional history from 0030.
    expect(fields.length).toBe(47);
  });

  it('does not let a signed-in user add, rename or remove an area', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into area_domains (slug, name, scope, position)
                   values ('planted', 'Planted', 'planted', 99)`,
      ),
    ).rejects.toThrow();

    // The grant is select alone, so these are refused outright.
    await expect(
      asUser(userB, (tx) => tx`update area_fields set name = 'Renamed' where slug = 'physics'`),
    ).rejects.toThrow();
    await expect(
      asUser(userB, (tx) => tx`delete from area_fields where slug = 'physics'`),
    ).rejects.toThrow();
    const [physics] = await admin<{ name: string }[]>`
      select name from area_fields where slug = 'physics'`;
    expect(physics?.name).toBe('Physics');
  });

  it('refuses a placed row that names both a field and a domain, or neither', async () => {
    const [field] = await admin<{ id: string }[]>`select id from area_fields where slug = 'physics'`;
    const [domain] = await admin<{ id: string }[]>`select id from area_domains where slug = 'technology'`;
    await expect(
      admin`insert into area_check_articles (title, section, kind, confidence, basis, placed_at, field_id, domain_id)
            values ('Both', 'x', 'topic', 'clear', 'Both.', now(), ${field.id}, ${domain.id})`,
    ).rejects.toThrow();
    await expect(
      admin`insert into area_check_articles (title, section, kind, confidence, basis, placed_at)
            values ('Neither', 'x', 'topic', 'clear', 'Neither.', now())`,
    ).rejects.toThrow();
  });

  it('does not let a signed-in user write a placement into the check', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into area_check_articles (title, section) values ('Planted', 'Nowhere')`,
      ),
    ).rejects.toThrow();
  });

  it('gives every domain between three and six fields', async () => {
    const rows = await admin<{ slug: string; n: number }[]>`
      select d.slug, count(f.id)::int as n
      from area_domains d
      left join area_fields f on f.domain_id = d.id
      group by d.slug`;
    for (const row of rows) {
      expect(row.n, row.slug).toBeGreaterThanOrEqual(3);
      expect(row.n, row.slug).toBeLessThanOrEqual(6);
    }
  });
});

describe('where a theme sits in the areas', () => {
  // Placements are written by the service role and read by their owner. The
  // composite key to obsidian.themes carries user_id, so a placement cannot
  // point at another account's theme even from the service role.
  let themeA = '';
  let physics = '';

  beforeAll(async () => {
    const [theme] = await admin<{ id: string }[]>`
      insert into obsidian.themes (user_id, name, about)
      values (${userA}, 'Urban design', 'How streets shape travel.')
      returning id`;
    themeA = theme.id;
    const [field] = await admin<{ id: string }[]>`select id from area_fields where slug = 'physics'`;
    physics = field.id;
    await admin`
      insert into theme_fields (user_id, theme_id, field_id, confidence, basis)
      values (${userA}, ${themeA}, ${physics}, 'clear', 'Placed for the test.')`;
  });

  it('shows the owner their placement and another user none of it', async () => {
    const own = await asUser(userA, (tx) => tx`select id from theme_fields`);
    const other = await asUser(userB, (tx) => tx`select id from theme_fields`);
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('lets the owner move a placement and nobody else', async () => {
    await asUser(userB, (tx) => tx`update theme_fields set moved_by_hand = true`);
    const [before] = await admin<{ moved_by_hand: boolean }[]>`
      select moved_by_hand from theme_fields where theme_id = ${themeA}`;
    expect(before.moved_by_hand).toBe(false);

    await asUser(userA, (tx) => tx`update theme_fields set moved_by_hand = true`);
    const [after] = await admin<{ moved_by_hand: boolean }[]>`
      select moved_by_hand from theme_fields where theme_id = ${themeA}`;
    expect(after.moved_by_hand).toBe(true);
  });

  it('refuses a placement filed under one account for another account\'s theme', async () => {
    await expect(
      admin`insert into theme_fields (user_id, theme_id, field_id, confidence, basis)
            values (${userB}, ${themeA}, ${physics}, 'clear', 'Planted.')`,
    ).rejects.toThrow();
  });

  it('does not let a signed-in user write a placement directly', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into theme_fields (user_id, theme_id, confidence, basis)
                   values (${userB}, ${themeA}, 'none', 'Planted.')`,
      ),
    ).rejects.toThrow();
  });
});

describe('where a track sits in the areas', () => {
  // The placement is columns on learn.subjects (0032_subject_fields.sql),
  // written through the owner's session like the rest of the subject.
  let subjectA = '';
  let physics = '';
  let domain = '';

  beforeAll(async () => {
    const [subject] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Placed track') returning id`;
    subjectA = subject.id;
    const [field] = await admin<{ id: string; domain_id: string }[]>`
      select id, domain_id from area_fields where slug = 'physics'`;
    physics = field.id;
    domain = field.domain_id;
  });

  it('lets the owner place their track and nobody else', async () => {
    await asUser(
      userB,
      (tx) => tx`update subjects set field_id = ${physics}, placement_confidence = 'clear',
                 placement_basis = 'Planted.', placed_at = now() where id = ${subjectA}`,
    );
    const [before] = await admin<{ field_id: string | null }[]>`
      select field_id from subjects where id = ${subjectA}`;
    expect(before.field_id).toBeNull();

    await asUser(
      userA,
      (tx) => tx`update subjects set field_id = ${physics}, placement_confidence = 'clear',
                 placement_basis = 'Placed for the test.', placed_at = now() where id = ${subjectA}`,
    );
    const [after] = await admin<{ field_id: string | null }[]>`
      select field_id from subjects where id = ${subjectA}`;
    expect(after.field_id).toBe(physics);
  });

  it('refuses a track placed in a field and a domain at once', async () => {
    await expect(
      admin`update subjects set domain_id = ${domain} where id = ${subjectA}`,
    ).rejects.toThrow();
  });

  it('refuses a field with no basis or no placed_at', async () => {
    await expect(
      admin`insert into subjects (user_id, name, field_id) values (${userA}, 'Half placed', ${physics})`,
    ).rejects.toThrow();
    await expect(
      admin`insert into subjects (user_id, name, field_id, placement_confidence, placed_at)
            values (${userA}, 'No basis', ${physics}, 'clear', now())`,
    ).rejects.toThrow();
  });
});

describe('the catalogue, which belongs to nobody', () => {
  // Four of the five catalogue tables carry no user_id on purpose: a catalogue
  // of forty thousand Wikipedia sections is not forty thousand rows per
  // account. So "can B read A's rows" is the wrong question for them, and the
  // right ones are that everybody can read them and nobody can write them
  // through the API. catalogue_links is the exception -- a link points into
  // one person's graph -- and it gets the usual treatment.
  const SHARED = ['catalogue_providers', 'catalogue_items', 'catalogue_segments'];

  it('lets any signed-in user read the shared catalogue', async () => {
    await admin`
      insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
      values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
              'REST API, no key, section text')
      on conflict do nothing`;

    for (const table of SHARED) {
      const seen = await asUser(userB, (tx) => tx`select 1 from ${tx(table)} limit 1`);
      expect(Array.isArray(seen)).toBe(true);
    }
  });

  it('does not let a signed-in user write to the shared catalogue', async () => {
    // Select is the only policy any of them carries. An insert has nothing to
    // pass, so it is refused rather than silently landing a row everybody sees.
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
                   values ('planted', 'Planted', 'https://example.com', 'none', 'planted')`,
      ),
    ).rejects.toThrow();
  });

  it('lets anyone read the transcript states and the credit ledger, and nobody write them', async () => {
    // Shared like the catalogue (learn 0042): the state of a video's
    // transcript and a record of what a call cost belong to nobody, and only
    // the service role writes them. The ledger is append-only even for it.
    for (const table of ['video_transcripts', 'transcript_calls']) {
      const seen = await asUser(userB, (tx) => tx`select 1 from ${tx(table)} limit 1`);
      expect(Array.isArray(seen)).toBe(true);
    }
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into video_transcripts (video_id, state, requested_by)
                   values ('ZK3O402wf1c', 'queued', 'press')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into transcript_calls (video_id, status, credits, outcome, trigger)
                   values ('ZK3O402wf1c', 200, 0, 'fetched', 'press')`,
      ),
    ).rejects.toThrow();
  });

  it('keeps a catalogue link private to the graph it points into', async () => {
    // The one catalogue table that is somebody's. A link says this segment
    // teaches that claim, which is a fact about one person's graph.
    const rows = await admin<{ n: number }[]>`
      select count(*)::int as n from catalogue_links where user_id = ${userA}`;
    expect(rows[0].n).toBe(0);

    const theirs = await asUser(
      userB,
      (tx) => tx`select id from catalogue_links where user_id = ${userA}`,
    );
    expect(theirs).toHaveLength(0);
  });

  it('keeps what the judge said about a claim private to its graph', async () => {
    // Same reason as a link: a judgement is about one person's claim, and a
    // refusal says what they are trying to learn as plainly as a match does.
    const theirs = await asUser(
      userB,
      (tx) => tx`select id from catalogue_judgements where user_id = ${userA}`,
    );
    expect(theirs).toHaveLength(0);

    await expect(
      asUser(
        userB,
        (tx) => tx`insert into catalogue_judgements
                     (user_id, segment_id, subject_id, similarity, chars, verdict, model, pressed_at)
                   values (${userA}, gen_random_uuid(), gen_random_uuid(), 0.9, 10, 'refused',
                           'x', now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('learning goals, stored as aims', () => {
  // 0044_aims.sql and 0045_aim_placement.sql. Added, edited and archived by
  // their owner through their own session; the table is `aims` because `goals`
  // already holds track concepts.
  let aimA = '';
  let physics = '';
  let domain = '';

  beforeAll(async () => {
    const [field] = await admin<{ id: string; domain_id: string }[]>`
      select id, domain_id from area_fields where slug = 'physics'`;
    physics = field.id;
    domain = field.domain_id;
    const [row] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`
        insert into aims (user_id, name, about, depth)
        values (${userA}, 'City design and urbanism', 'How cities are laid out and why.', 'solid')
        returning id`,
    );
    aimA = row.id;
  });

  it('shows the owner their aims and another user none of them', async () => {
    const own = await asUser(userA, (tx) => tx`select id from aims`);
    const other = await asUser(userB, (tx) => tx`select id from aims`);
    expect(own.map((r) => r.id)).toEqual([aimA]);
    expect(other).toHaveLength(0);
  });

  it('does not let a user file an aim under another account', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into aims (user_id, name) values (${userA}, 'Planted')`,
      ),
    ).rejects.toThrow();
  });

  it('lets the owner edit and archive an aim and nobody else', async () => {
    await asUser(userB, (tx) => tx`update aims set archived_at = now(), depth = 'deep'`);
    await asUser(userB, (tx) => tx`delete from aims`);
    const [before] = await admin<{ archived_at: string | null; depth: string }[]>`
      select archived_at, depth from aims where id = ${aimA}`;
    expect(before).toEqual({ archived_at: null, depth: 'solid' });

    // A placement is written whole (0045_aim_placement.sql, plan #898).
    await asUser(
      userA,
      (tx) => tx`
        update aims
        set field_id = ${physics}, placement_confidence = 'clear',
            placement_basis = 'Placed for the test.', placed_at = now()
        where id = ${aimA}`,
    );
    const [placed] = await admin<{ field_id: string | null }[]>`
      select field_id from aims where id = ${aimA}`;
    expect(placed.field_id).toBe(physics);
  });

  it('refuses a field with no placement, and a placement with no basis', async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into aims (user_id, name) values (${userB}, 'Half placed') returning id`;
    await expect(
      admin`update aims set field_id = ${physics} where id = ${row.id}`,
    ).rejects.toThrow(/aims_placement_complete_ck/);
    await expect(
      admin`update aims set placed_at = now(), placement_confidence = 'clear' where id = ${row.id}`,
    ).rejects.toThrow(/aims_placement_complete_ck/);
    await admin`delete from aims where id = ${row.id}`;
  });

  it('refuses an unknown depth, a field and a domain at once, and a placed list', async () => {
    await expect(
      admin`insert into aims (user_id, name, depth) values (${userA}, 'Too deep', 'expert')`,
    ).rejects.toThrow();
    await expect(
      admin`update aims set domain_id = ${domain} where id = ${aimA}`,
    ).rejects.toThrow();
    await expect(
      admin`insert into aims (user_id, name, list_source, field_id)
            values (${userA}, 'Level 3', 'level3', ${physics})`,
    ).rejects.toThrow();
  });

  it('keeps one active Level 3 aim per person', async () => {
    await admin`insert into aims (user_id, name, list_source) values (${userA}, 'Level 3', 'level3')`;
    await expect(
      admin`insert into aims (user_id, name, list_source) values (${userA}, 'Level 3 again', 'level3')`,
    ).rejects.toThrow();
    await admin`update aims set archived_at = now() where user_id = ${userA} and list_source = 'level3'`;
    await admin`insert into aims (user_id, name, list_source) values (${userA}, 'Level 3 again', 'level3')`;
    await admin`insert into aims (user_id, name, list_source) values (${userB}, 'Level 3', 'level3')`;
  });
});

describe('the cards behind Learn now', () => {
  // Picked and written by the service role (plan #806 and #807), read and
  // updated by their owner when they save, dismiss or open one.
  let cardA = '';
  let themeA = '';

  beforeAll(async () => {
    const [provider] = await admin<{ id: string }[]>`
      insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
      values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
              'REST API, no key, section text')
      on conflict (slug) do update set name = excluded.name
      returning id`;
    const [item] = await admin<{ id: string }[]>`
      insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
      values (${provider.id}, 'Inflation', 'Inflation', 'article', 'https://en.wikipedia.org/wiki/Inflation')
      returning id`;
    const [segment] = await admin<{ id: string }[]>`
      insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
      values (${item.id}, 1, 'Causes', 'Causes', 'Prices rise when...')
      returning id`;
    const [theme] = await admin<{ id: string }[]>`
      insert into obsidian.themes (user_id, name, about)
      values (${userA}, 'Central banks', 'How rates are set.')
      returning id`;
    themeA = theme.id;
    const [card] = await admin<{ id: string }[]>`
      insert into feed_cards (user_id, reason, theme_id, theme_name, item_id, segment_id)
      values (${userA}, 'interest', ${themeA}, 'Central banks', ${item.id}, ${segment.id})
      returning id`;
    cardA = card.id;
  });

  it('shows the owner their cards and another user none of them', async () => {
    const own = await asUser(userA, (tx) => tx`select id from feed_cards`);
    const other = await asUser(userB, (tx) => tx`select id from feed_cards`);
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('lets the owner record what they did with a card and nobody else', async () => {
    await asUser(userB, (tx) => tx`update feed_cards set acted_at = now()`);
    const [before] = await admin<{ acted_at: string | null }[]>`
      select acted_at from feed_cards where id = ${cardA}`;
    expect(before.acted_at).toBeNull();

    await asUser(userA, (tx) => tx`update feed_cards set acted_at = now()`);
    const [after] = await admin<{ acted_at: string | null }[]>`
      select acted_at from feed_cards where id = ${cardA}`;
    expect(after.acted_at).not.toBeNull();
  });

  it('does not let a signed-in user write a card directly', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into feed_cards (user_id, reason, reading_id)
                   values (${userB}, 'queued', ${readingA})`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a card shown before it has a summary', async () => {
    await expect(admin`update feed_cards set status = 'ready' where id = ${cardA}`).rejects.toThrow();
  });

  it('keeps the card and its theme name when the theme goes', async () => {
    await admin`delete from obsidian.themes where id = ${themeA}`;
    const [row] = await admin<{ theme_id: string | null; theme_name: string }[]>`
      select theme_id, theme_name from feed_cards where id = ${cardA}`;
    expect(row).toEqual({ theme_id: null, theme_name: 'Central banks' });
  });

  it('takes a goal card only with the goal named, and keeps the name when the goal goes', async () => {
    // 0046_feed_card_goals.sql. A goal card may have no field, when its goal
    // sits in none.
    const [{ item_id: itemId }] = await admin<{ item_id: string }[]>`
      select item_id from feed_cards where id = ${cardA}`;
    const [segment] = await admin<{ id: string }[]>`
      insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
      values (${itemId}, 2, 'Effects', 'Effects', 'Savers lose...')
      returning id`;
    const [aim] = await admin<{ id: string }[]>`
      insert into aims (user_id, name, depth) values (${userA}, 'Startup finance', 'solid') returning id`;
    await expect(
      admin`insert into feed_cards (user_id, reason, aim_id, item_id, segment_id)
            values (${userA}, 'goal', ${aim.id}, ${itemId}, ${segment.id})`,
    ).rejects.toThrow();
    const [card] = await admin<{ id: string }[]>`
      insert into feed_cards (user_id, reason, aim_id, aim_name, item_id, segment_id)
      values (${userA}, 'goal', ${aim.id}, 'Startup finance', ${itemId}, ${segment.id})
      returning id`;

    await admin`delete from aims where id = ${aim.id}`;
    const [row] = await admin<{ aim_id: string | null; aim_name: string }[]>`
      select aim_id, aim_name from feed_cards where id = ${card.id}`;
    expect(row).toEqual({ aim_id: null, aim_name: 'Startup finance' });
  });
});

describe('the curriculum at the top of a track', () => {
  // 0038_curriculum.sql. Units are written once when a track is made, so a
  // signed-in user may add and read them and never change one; the composite
  // key to subjects is what stops a unit landing on someone else's track.
  let subjectA = '';
  let subjectB = '';
  let unitA = '';

  beforeAll(async () => {
    const [a] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Economics') returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userB}, 'Bob studies') returning id`;
    subjectA = a.id;
    subjectB = b.id;
    const [unit] = await admin<{ id: string }[]>`
      insert into curriculum_units (user_id, subject_id, ordinal, title, covers, outcome)
      values (${userA}, ${subjectA}, 1, 'Price elasticity', 'How demand answers price.',
              'Say which goods are elastic.')
      returning id`;
    unitA = unit.id;
  });

  it('shows the owner their units and another user none of them', async () => {
    const own = await asUser(userA, (tx) => tx`select id from curriculum_units`);
    const other = await asUser(userB, (tx) => tx`select id from curriculum_units`);
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('lets the owner add a unit to their own track', async () => {
    await asUser(
      userB,
      (tx) => tx`insert into curriculum_units (user_id, subject_id, ordinal, title, covers, outcome)
                 values (${userB}, ${subjectB}, 1, 'Bob unit', 'Covers.', 'Outcome.')`,
    );
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from curriculum_units where subject_id = ${subjectB}`;
    expect(row.count).toBe(1);
  });

  it("refuses a unit on another user's track", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into curriculum_units (user_id, subject_id, ordinal, title, covers, outcome)
                   values (${userB}, ${subjectA}, 2, 'Smuggled', 'Covers.', 'Outcome.')`,
      ),
    ).rejects.toThrow();
  });

  it('does not let a signed-in user change a unit once written', async () => {
    await expect(
      asUser(userA, (tx) => tx`update curriculum_units set title = 'Renamed' where id = ${unitA}`),
    ).rejects.toThrow();
  });

  it('goes with its track', async () => {
    await admin`delete from subjects where id = ${subjectA}`;
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from curriculum_units where id = ${unitA}`;
    expect(row.count).toBe(0);
  });
});

describe('cross-user reads', () => {
  it('shows the owner their tracks, sources, readings and imports', async () => {
    const seen = await asUser(userA, async (tx) => ({
      tracks: (await tx`select id from tracks`).length,
      sources: (await tx`select id from sources`).length,
      readings: (await tx`select id from readings`).length,
      imports: (await tx`select id from imports`).length,
    }));
    expect(seen).toEqual({ tracks: 1, sources: 1, readings: 1, imports: 1 });
  });

  it('shows another user none of it', async () => {
    const seen = await asUser(userB, async (tx) => ({
      tracks: (await tx`select id from tracks where id = ${trackA}`).length,
      sources: (await tx`select id from sources where id = ${sourceA}`).length,
      readings: (await tx`select id from readings where id = ${readingA}`).length,
      imports: (await tx`select id from imports where track_id = ${trackA}`).length,
    }));
    expect(seen).toEqual({ tracks: 0, sources: 0, readings: 0, imports: 0 });
  });

  it('does not leak the question behind a track', async () => {
    // The question is the closest thing in this schema to a private note: it
    // is what you did not understand, written in your own words.
    const rows = await asUser(
      userB,
      (tx) => tx`select question from tracks where question ilike '%endowments%'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak what somebody wrote about what they read', async () => {
    await admin`update readings set note = 'This changed my mind about prices.'
                where id = ${readingA}`;

    const rows = await asUser(
      userB,
      (tx) => tx`select note from readings where note is not null`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak a source that only shares a title with your own', async () => {
    // Both users have the Hayek essay. Sources are deduped per user, and a
    // title is not an identifier anyone else can reach a row through.
    const rows = await asUser(
      userB,
      (tx) => tx`select id, canonical_url from sources
                 where title = 'The Use of Knowledge in Society'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe(sourceB);
  });

  it('does not leak the pasted text an import was built from', async () => {
    // A paste can carry a whole conversation's worth of context around it.
    const rows = await asUser(
      userB,
      (tx) => tx`select raw_text from imports where raw_text ilike '%Walzer%'`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('cross-user writes', () => {
  it('does not let another user edit or delete a reading', async () => {
    const edited = await asUser(
      userB,
      (tx) => tx`update readings set status = 'read' where id = ${readingA} returning id`,
    );
    expect(edited).toHaveLength(0);

    const deleted = await asUser(
      userB,
      (tx) => tx`delete from readings where id = ${readingA} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('does not let another user retitle or shelve your track', async () => {
    const affected = await asUser(
      userB,
      (tx) => tx`update tracks set status = 'shelved' where id = ${trackA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user repoint a source at a URL of their choosing', async () => {
    // The attack: change where somebody's Open button goes, and they click it.
    const affected = await asUser(
      userB,
      (tx) => tx`update sources set canonical_url = 'https://mallory.example/payload'
                 where id = ${sourceA} returning id`,
    );
    expect(affected).toHaveLength(0);
  });

  it('does not let another user file a reading into your track', async () => {
    // with check, not just using: putting a reading of your choosing in front
    // of somebody else's eyes is the whole of the attack.
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into readings (user_id, track_id, source_id, locator_basis)
                   values (${userB}, ${trackA}, ${sourceB}, 'planted')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a reading whose track and source belong to different accounts', async () => {
    // Not RLS -- this one is the composite foreign key, and it fires even for
    // the admin connection that bypasses every policy. Foreign keys bypass row
    // level security, so `references tracks (id)` alone would have accepted
    // this row and the policy would never have been asked.
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis)
            values (${userA}, ${trackA}, ${sourceB}, 'mismatched owners')`,
    ).rejects.toThrow();
  });

  it('refuses an import filed against another account\'s track', async () => {
    await expect(
      admin`insert into imports (user_id, track_id, raw_text)
            values (${userA}, ${trackB}, 'not mine')`,
    ).rejects.toThrow();
  });
});

describe('a reading you wrote down yourself', () => {
  it('is allowed to have no source', async () => {
    // The point of the whole change: the first thing you write down is a
    // subject, not a book.
    const [row] = await admin<{ id: string; title: string }[]>`
      insert into readings (user_id, track_id, source_id, title, locator_basis)
      values (${userA}, ${trackA}, null, 'How central banks set rates',
              'You wrote this down yourself.')
      returning id, title`;
    expect(row.title).toBe('How central banks set rates');

    await admin`delete from readings where id = ${row.id}`;
  });

  it('refuses a reading that is about nothing at all', async () => {
    // Neither a source nor a title renders as a blank line you cannot click,
    // delete or explain.
    await expect(
      admin`insert into readings (user_id, track_id, source_id, title, locator_basis)
            values (${userA}, ${trackA}, null, null, 'nothing')`,
    ).rejects.toThrow();

    await expect(
      admin`insert into readings (user_id, track_id, source_id, title, locator_basis)
            values (${userA}, ${trackA}, null, '   ', 'nothing')`,
    ).rejects.toThrow();
  });

  it('lets a source-backed reading carry your own title as well', async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into readings (user_id, track_id, source_id, title, locator_basis)
      values (${userA}, ${trackA}, ${sourceA}, 'the coordination argument', 'fetched')
      returning id`;
    expect(row.id).toBeTruthy();
    await admin`delete from readings where id = ${row.id}`;
  });

  it('stays hidden from another user like any other reading', async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into readings (user_id, track_id, source_id, title, locator_basis)
      values (${userA}, ${trackA}, null, 'A private curiosity', 'typed')
      returning id`;

    const seen = await asUser(userB, (tx) => tx`select id from readings where id = ${row.id}`);
    expect(seen).toHaveLength(0);

    await admin`delete from readings where id = ${row.id}`;
  });
});

describe('deleting', () => {
  it('takes a track\'s readings and its import with it', async () => {
    // The reason there is nothing to clean up in deleteTrack: the foreign keys
    // do it. If they ever stopped, this fails rather than leaving orphans
    // nobody can see or reach.
    const track = await seedTrack(userA, 'Going', 'Does this cascade?');
    const reading = await seedReading(userA, track, sourceA, 'fetched');
    await admin`insert into imports (user_id, track_id, raw_text)
                values (${userA}, ${track}, 'paste')`;

    await admin`delete from tracks where id = ${track}`;

    const left = await admin<{ n: number }[]>`
      select (select count(*) from readings where id = ${reading})
           + (select count(*) from imports where track_id = ${track}) as n`;
    expect(Number(left[0].n)).toBe(0);
  });

  it('leaves the source alone, because another track may still want it', async () => {
    // Sources are deduped across tracks. Deleting one track must not take a
    // work a different track still points at.
    const track = await seedTrack(userA, 'Going too', 'And this?');
    await seedReading(userA, track, sourceA, 'fetched');

    await admin`delete from tracks where id = ${track}`;

    const source = await admin`select id from sources where id = ${sourceA}`;
    expect(source).toHaveLength(1);
  });

  it('does not let another user delete your reading or your track', async () => {
    const deletedReading = await asUser(
      userB,
      (tx) => tx`delete from readings where id = ${readingA} returning id`,
    );
    expect(deletedReading).toHaveLength(0);

    const deletedTrack = await asUser(
      userB,
      (tx) => tx`delete from tracks where id = ${trackA} returning id`,
    );
    expect(deletedTrack).toHaveLength(0);
  });

  it('lets the owner delete their own reading', async () => {
    const id = await seedReading(userA, trackA, sourceA, 'fetched');
    const gone = await asUser(userA, (tx) => tx`delete from readings where id = ${id} returning id`);
    expect(gone).toHaveLength(1);
  });
});

describe('the rules the schema itself enforces', () => {
  it('refuses a locator with no stated basis', async () => {
    // "Never send someone to a page that is not there" is a check constraint,
    // not a convention: a location with no basis is exactly the silent guess
    // the module forbids.
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis)
            values (${userA}, ${trackA}, ${sourceA}, '   ')`,
    ).rejects.toThrow();
  });

  it('refuses a price on a source nobody has to pay for', async () => {
    await expect(
      admin`insert into sources (user_id, title, access, price_cents)
            values (${userA}, 'Free thing', 'open', 1000)`,
    ).rejects.toThrow();
  });

  it('refuses a page range that runs backwards', async () => {
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis, page_from, page_to)
            values (${userA}, ${trackA}, ${sourceA}, 'from a toc', 128, 95)`,
    ).rejects.toThrow();
  });

  it('refuses a non-https open url', async () => {
    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis, open_url)
            values (${userA}, ${trackA}, ${sourceA}, 'fetched', 'http://insecure.example/x')`,
    ).rejects.toThrow();
  });

  it('stamps started_at and finished_at from the status, not from the caller', async () => {
    const id = await seedReading(userA, trackA, sourceA, 'fetched');

    await admin`update readings set status = 'reading' where id = ${id}`;
    const [reading] = await admin<{ started_at: string | null; finished_at: string | null }[]>`
      select started_at, finished_at from readings where id = ${id}`;
    expect(reading.started_at).not.toBeNull();
    expect(reading.finished_at).toBeNull();

    await admin`update readings set status = 'read' where id = ${id}`;
    const [done] = await admin<{ finished_at: string | null }[]>`
      select finished_at from readings where id = ${id}`;
    expect(done.finished_at).not.toBeNull();

    // Reopening it clears the finish. A finished_at outliving the status that
    // justified it is how a progress bar starts lying.
    await admin`update readings set status = 'queued' where id = ${id}`;
    const [reopened] = await admin<{ finished_at: string | null }[]>`
      select finished_at from readings where id = ${id}`;
    expect(reopened.finished_at).toBeNull();

    await admin`delete from readings where id = ${id}`;
  });

  it('finishes an abandoned reading too', async () => {
    // Giving up ends a reading as surely as finishing it does. What separates
    // them is the status, and /learn counts only `read` toward progress.
    const id = await seedReading(userA, trackA, sourceA, 'fetched');
    await admin`update readings set status = 'abandoned' where id = ${id}`;

    const [row] = await admin<{ finished_at: string | null }[]>`
      select finished_at from readings where id = ${id}`;
    expect(row.finished_at).not.toBeNull();

    await admin`delete from readings where id = ${id}`;
  });
});

/**
 * The link a gap-queued reading carries back to the concept it came from.
 *
 * It is what lets the source search read that subject's graph, so it is worth
 * the same scrutiny as the other two parents: keyed on (concept_id, user_id),
 * because a plain foreign key bypasses RLS and would take another account's
 * concept without complaint.
 */
describe('a reading queued from a gap', () => {
  async function seedConcept(userId: string, name: string): Promise<string> {
    const [subject] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userId}, ${`${name} subject`})
      returning id`;
    const [concept] = await admin<{ id: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userId}, ${subject.id}, ${name}, 'A claim you can be wrong about.',
              'Written by hand for this test.')
      returning id`;
    return concept.id;
  }

  it('refuses a concept belonging to somebody else', async () => {
    const conceptB = await seedConcept(userB, 'bob concept');

    await expect(
      admin`insert into readings (user_id, track_id, source_id, locator_basis, concept_id)
            values (${userA}, ${trackA}, ${sourceA}, 'from a gap', ${conceptB})`,
    ).rejects.toThrow();
  });

  it('survives the concept being deleted, with the link cleared', async () => {
    // A reading lives in a track and is yours to read whatever happens to the
    // graph it came from. Losing the rooting is the cost; losing the row would
    // be the queue tidying itself away behind you.
    const conceptA = await seedConcept(userA, 'alice concept');

    const [row] = await admin<{ id: string }[]>`
      insert into readings (user_id, track_id, source_id, locator_basis, concept_id)
      values (${userA}, ${trackA}, ${sourceA}, 'from a gap', ${conceptA})
      returning id`;

    await admin`delete from concepts where id = ${conceptA}`;

    const [after] = await admin<{ concept_id: string | null }[]>`
      select concept_id from readings where id = ${row.id}`;
    expect(after).toBeDefined();
    expect(after.concept_id).toBeNull();

    await admin`delete from readings where id = ${row.id}`;
  });
});

describe('what you did with a row on Learn next', () => {
  /** A claim of this user's own, in a subject of their own. */
  async function seedOwnConcept(userId: string, name: string): Promise<string> {
    const [subject] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userId}, ${`${name} subject`})
      returning id`;
    const [concept] = await admin<{ id: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userId}, ${subject.id}, ${name}, 'A claim you can be wrong about.',
              'Written by hand for this test.')
      returning id`;
    return concept.id;
  }

  it('does not let another user read what you have been getting through', async () => {
    // What you have finished and what you have pushed aside is a record of
    // what you are avoiding, which is closer to the misconception column than
    // to a reading list.
    const concept = await seedOwnConcept(userA, 'alice claim');
    await admin`insert into next_outcomes (user_id, kind, concept_id, outcome)
                values (${userA}, 'ready', ${concept}, 'answered')`;
    await admin`insert into next_outcomes (user_id, kind, reading_id, outcome)
                values (${userA}, 'reading', ${readingA}, 'not_now')`;

    const mine = await asUser(userA, (tx) => tx`select id from next_outcomes`);
    const theirs = await asUser(userB, (tx) => tx`select id from next_outcomes`);

    expect(mine.length).toBeGreaterThan(0);
    expect(theirs).toHaveLength(0);
  });

  it('does not let another user record something against your reading', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into next_outcomes (user_id, kind, reading_id, outcome)
                   values (${userA}, 'reading', ${readingA}, 'read')`,
      ),
    ).rejects.toThrow();
  });

  it("refuses a row against another account's claim", async () => {
    // The composite foreign key rather than the policy, and it fires on the
    // admin connection that bypasses every policy.
    const conceptB = await seedOwnConcept(userB, 'bob claim');

    await expect(
      admin`insert into next_outcomes (user_id, kind, concept_id, outcome)
            values (${userA}, 'ready', ${conceptB}, 'answered')`,
    ).rejects.toThrow();
  });

  it('refuses a row that names both a claim and a reading', async () => {
    const concept = await seedOwnConcept(userA, 'both claim');

    await expect(
      admin`insert into next_outcomes (user_id, kind, concept_id, reading_id, outcome)
            values (${userA}, 'ready', ${concept}, ${readingA}, 'answered')`,
    ).rejects.toThrow();
  });

  it('refuses an answer recorded against a reading', async () => {
    // Answering is something you do to a claim. A kind and an outcome that
    // disagree is a row nothing downstream could read.
    await expect(
      admin`insert into next_outcomes (user_id, kind, reading_id, outcome)
            values (${userA}, 'reading', ${readingA}, 'answered')`,
    ).rejects.toThrow();
  });

  it('counts a reading as finished once, however many times it is marked', async () => {
    const reading = await seedReading(userA, trackA, sourceA, 'Finished twice.');

    await admin`insert into next_outcomes (user_id, kind, reading_id, outcome)
                values (${userA}, 'reading', ${reading}, 'read')`;
    await expect(
      admin`insert into next_outcomes (user_id, kind, reading_id, outcome)
            values (${userA}, 'reading', ${reading}, 'read')`,
    ).rejects.toThrow();

    // Pushing the same row aside twice, months apart, is two separate things
    // you did and is allowed.
    await admin`insert into next_outcomes (user_id, kind, reading_id, outcome)
                values (${userA}, 'reading', ${reading}, 'not_now')`;
    await admin`insert into next_outcomes (user_id, kind, reading_id, outcome)
                values (${userA}, 'reading', ${reading}, 'not_now')`;

    const rows = await admin<{ id: string }[]>`
      select id from next_outcomes where reading_id = ${reading}`;
    expect(rows).toHaveLength(3);
  });

  it('goes when the claim it is about goes', async () => {
    const concept = await seedOwnConcept(userA, 'deleted claim');
    await admin`insert into next_outcomes (user_id, kind, concept_id, outcome)
                values (${userA}, 'recheck', ${concept}, 'answered')`;

    await admin`delete from concepts where id = ${concept}`;

    const left = await admin<{ id: string }[]>`
      select id from next_outcomes where concept_id = ${concept}`;
    expect(left).toHaveLength(0);
  });
});

describe('account deletion', () => {
  it('takes the whole module with it, on the foreign keys', async () => {
    // The delete-account route ends at auth.admin.deleteUser(). Four more
    // tables must not be four more things for it to remember.
    const doomed = await createUser('learn-doomed@example.com');
    const track = await seedTrack(doomed, 'Going away', 'Does this survive?');
    const source = await seedSource(doomed, 'Doomed source', 'https://example.org/doomed');
    await seedReading(doomed, track, source, 'fetched');
    await admin`insert into imports (user_id, track_id, raw_text)
                values (${doomed}, ${track}, 'paste')`;

    await admin`delete from auth.users where id = ${doomed}`;

    const left = await admin<{ n: number }[]>`
      select (select count(*) from tracks where user_id = ${doomed})
           + (select count(*) from sources where user_id = ${doomed})
           + (select count(*) from readings where user_id = ${doomed})
           + (select count(*) from imports where user_id = ${doomed}) as n`;
    expect(Number(left[0].n)).toBe(0);
  });
});
