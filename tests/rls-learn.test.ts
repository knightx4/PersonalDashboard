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
import { admin, asUser, closeDb, createUser, sql, truncateAll } from './helpers/db-learn';

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
      'card_notes',
      'catalogue_course_items',
      'catalogue_items',
      'catalogue_judgements',
      'catalogue_links',
      'catalogue_passages',
      'catalogue_providers',
      'catalogue_segments',
      'concept_edges',
      'concept_mentions',
      'concept_state',
      'concept_subjects',
      'concepts',
      'course_reads',
      'curriculum_units',
      'feed_cards',
      'goals',
      'imports',
      'next_outcomes',
      'opening_questions',
      'opening_sweeps',
      'phrase_explanations',
      'piece_checks',
      'piece_practice',
      'piece_practice_handins',
      'plan_pieces',
      'plan_project_handins',
      'plan_projects',
      'probes',
      'quiz_questions',
      'quiz_sources',
      'quizzes',
      'readings',
      'review_questions',
      'settings',
      'sources',
      'subject_channels',
      'subjects',
      'theme_fields',
      'track_offers',
      'tracks',
      'transcript_calls',
      'video_transcripts',
      'watch_list',
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
  // catalogue_passages (learn 0070) is shared the same way: paragraph cuts of
  // article sections, searched but never anybody's.
  const SHARED = ['catalogue_providers', 'catalogue_items', 'catalogue_segments', 'catalogue_passages'];

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
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into catalogue_passages (segment_id, ordinal, text)
                   values (gen_random_uuid(), 0, 'planted')`,
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

  it("keeps a goal's hidden subject from another user, and from every account but the goal's", async () => {
    // 0084_survey_subject_aims.sql, plan #1384: Practice Flow questions about a
    // goal sit in a survey subject linked by aim_id.
    const [subject] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`
        insert into subjects (user_id, name, survey, aim_id)
        values (${userA}, 'City design and urbanism', true, ${aimA})
        returning id`,
    );

    const own = await asUser(userA, (tx) => tx`select id from subjects where aim_id = ${aimA}`);
    const other = await asUser(userB, (tx) => tx`select id from subjects where aim_id is not null`);
    expect(own.map((r) => r.id)).toEqual([subject.id]);
    expect(other).toHaveLength(0);

    // One subject per goal, and none filed against another account's goal.
    await expect(
      admin`insert into subjects (user_id, name, survey, aim_id)
            values (${userA}, 'A second one', true, ${aimA})`,
    ).rejects.toThrow(/subjects_user_aim_uq/);
    await expect(
      admin`insert into subjects (user_id, name, survey, aim_id)
            values (${userB}, 'Borrowed goal', true, ${aimA})`,
    ).rejects.toThrow(/subjects_aim_fk/);

    await admin`delete from subjects where id = ${subject.id}`;
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
  // 0038_curriculum.sql. A signed-in user may add and read units and never
  // change one directly: a goal's plan moves and removes them only through
  // the functions in 0076 (plan #1144), tested below. The composite
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

describe("the pieces a goal's unit is split into", () => {
  // learn 0073_plan_pieces.sql (plan #1140). The owner reads their pieces and
  // may mark one passed; the composite keys to subjects and to units are what
  // stop a piece landing on someone else's track or unit.
  let subjectA = '';
  let subjectB = '';
  let unitA = '';
  let pieceA = '';

  beforeAll(async () => {
    const [a] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'SaaS metrics') returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userB}, 'Bob plans') returning id`;
    subjectA = a.id;
    subjectB = b.id;
    const [unit] = await admin<{ id: string }[]>`
      insert into curriculum_units (user_id, subject_id, ordinal, title, covers, outcome)
      values (${userA}, ${subjectA}, 1, 'Retention', 'Cohorts and churn.', 'Read a cohort grid.')
      returning id`;
    unitA = unit.id;
    const [piece] = await admin<{ id: string }[]>`
      insert into plan_pieces (user_id, subject_id, unit_id, ordinal, title)
      values (${userA}, ${subjectA}, ${unitA}, 1, 'Reading a cohort grid')
      returning id`;
    pieceA = piece.id;
  });

  it('shows the owner their pieces and another user none of them', async () => {
    const own = await asUser(userA, (tx) => tx`select id from plan_pieces`);
    const other = await asUser(userB, (tx) => tx`select id from plan_pieces`);
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('lets the owner mark a piece passed, and nobody else', async () => {
    await asUser(userB, (tx) => tx`update plan_pieces set passed_at = now() where id = ${pieceA}`);
    const [before] = await admin<{ passed_at: string | null }[]>`
      select passed_at from plan_pieces where id = ${pieceA}`;
    expect(before.passed_at).toBeNull();
    await asUser(userA, (tx) => tx`update plan_pieces set passed_at = now() where id = ${pieceA}`);
    const [after] = await admin<{ passed_at: string | null }[]>`
      select passed_at from plan_pieces where id = ${pieceA}`;
    expect(after.passed_at).not.toBeNull();
  });

  it("refuses a piece on another user's unit", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into plan_pieces (user_id, subject_id, unit_id, ordinal, title)
                   values (${userB}, ${subjectB}, ${unitA}, 2, 'Smuggled')`,
      ),
    ).rejects.toThrow();
  });

  it('does not let a signed-in user delete a piece', async () => {
    await expect(asUser(userA, (tx) => tx`delete from plan_pieces where id = ${pieceA}`)).rejects.toThrow();
  });

  // learn 0074_piece_checks.sql (plan #1141). The owner asks and answers a
  // piece's check; the composite key to the piece stops a check landing on
  // someone else's.
  it("lets the owner ask and answer a piece's check, and shows nobody else", async () => {
    await asUser(
      userA,
      (tx) => tx`insert into piece_checks (user_id, piece_id, question, expected)
                 values (${userA}, ${pieceA}, 'Why does churn compound?', 'Each month loses a share of what is left.')`,
    );
    await asUser(
      userA,
      (tx) => tx`update piece_checks set response = 'It is a share of what remains.', correct = true,
                   marked_why = 'Right.', answered_at = now() where piece_id = ${pieceA}`,
    );
    const own = await asUser(userA, (tx) => tx`select correct from piece_checks`);
    const other = await asUser(userB, (tx) => tx`select id from piece_checks`);
    expect(own).toEqual([{ correct: true }]);
    expect(other).toHaveLength(0);
  });

  it("refuses a check on another user's piece, and a mark without an answer", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into piece_checks (user_id, piece_id, question, expected)
                   values (${userB}, ${pieceA}, 'Smuggled?', 'Yes.')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into piece_checks (user_id, piece_id, question, expected, correct)
                   values (${userA}, ${pieceA}, 'Half marked?', 'No.', true)`,
      ),
    ).rejects.toThrow();
  });

  // learn 0075_piece_practice.sql (plan #1142). The owner's page writes the
  // piece's one task and each marked hand-in; neither is edited afterwards,
  // and the composite keys stop either landing on someone else's piece.
  let practiceA = '';

  it("lets the owner write a piece's practice task and hand it in, and shows nobody else", async () => {
    const [task] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`insert into piece_practice (user_id, piece_id, task, figures, points, worked)
                 values (${userA}, ${pieceA}, 'Work out NRR from the table.', '[{"label": "NRR", "unit": "%"}]'::jsonb,
                         array['NRR is 112%.'], 'NRR = 1,120 / 1,000 = 112%.')
                 returning id`,
    );
    practiceA = task.id;
    await asUser(
      userA,
      (tx) => tx`insert into piece_practice_handins (user_id, practice_id, answer, figures, marks, passed)
                 values (${userA}, ${practiceA}, 'Divided.', '[{"label": "NRR", "value": "112%"}]'::jsonb,
                         '[{"point": "NRR is 112%.", "met": true, "note": "Right."}]'::jsonb, true)`,
    );
    const own = await asUser(userA, (tx) => tx`select passed from piece_practice_handins`);
    expect(own).toEqual([{ passed: true }]);
    expect(await asUser(userB, (tx) => tx`select id from piece_practice`)).toHaveLength(0);
    expect(await asUser(userB, (tx) => tx`select id from piece_practice_handins`)).toHaveLength(0);
  });

  it('refuses a second task for a piece, a task or hand-in on another user\'s, an empty hand-in and an edit', async () => {
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into piece_practice (user_id, piece_id, task, points, worked)
                   values (${userA}, ${pieceA}, 'Again.', array['A point.'], 'Worked.')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into piece_practice (user_id, piece_id, task, points, worked)
                   values (${userB}, ${pieceA}, 'Smuggled.', array['A point.'], 'Worked.')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into piece_practice_handins (user_id, practice_id, answer, marks, passed)
                   values (${userB}, ${practiceA}, 'Smuggled.', '[]'::jsonb, true)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into piece_practice_handins (user_id, practice_id, answer, marks, passed)
                   values (${userA}, ${practiceA}, ' ', '[]'::jsonb, false)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`update piece_practice_handins set passed = true where practice_id = ${practiceA}`),
    ).rejects.toThrow();
  });

  // learn 0078_plan_projects.sql (plan #1146). The owner's plan page writes
  // the track's one final project and each marked hand-in; neither is edited
  // afterwards, and the composite keys stop either landing on someone else's
  // track.
  let projectA = '';

  it("lets the owner write a plan's final project and hand it in, and shows nobody else", async () => {
    const [project] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`insert into plan_projects (user_id, subject_id, title, task, figures, points, worked)
                 values (${userA}, ${subjectA}, 'Retention and payback', 'Work out NRR and CAC payback.',
                         '[{"label": "NRR", "unit": "%"}]'::jsonb, array['NRR is 115%.'], 'NRR = 115%.')
                 returning id`,
    );
    projectA = project.id;
    await asUser(
      userA,
      (tx) => tx`insert into plan_project_handins (user_id, project_id, answer, figures, marks, passed)
                 values (${userA}, ${projectA}, 'Divided.', '[{"label": "NRR", "value": "115%"}]'::jsonb,
                         '[{"point": "NRR is 115%.", "met": true, "note": "Right."}]'::jsonb, true)`,
    );
    const own = await asUser(userA, (tx) => tx`select passed from plan_project_handins`);
    expect(own).toEqual([{ passed: true }]);
    expect(await asUser(userB, (tx) => tx`select id from plan_projects`)).toHaveLength(0);
    expect(await asUser(userB, (tx) => tx`select id from plan_project_handins`)).toHaveLength(0);
  });

  it("refuses a second project for a plan, a project or hand-in on another user's, an empty hand-in and an edit", async () => {
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into plan_projects (user_id, subject_id, title, task, points, worked)
                   values (${userA}, ${subjectA}, 'Again', 'Again.', array['A point.'], 'Worked.')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into plan_projects (user_id, subject_id, title, task, points, worked)
                   values (${userB}, ${subjectA}, 'Smuggled', 'Smuggled.', array['A point.'], 'Worked.')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into plan_project_handins (user_id, project_id, answer, marks, passed)
                   values (${userB}, ${projectA}, 'Smuggled.', '[]'::jsonb, true)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into plan_project_handins (user_id, project_id, answer, marks, passed)
                   values (${userA}, ${projectA}, ' ', '[]'::jsonb, false)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`update plan_project_handins set passed = false where project_id = ${projectA}`),
    ).rejects.toThrow();
  });

  it('goes with its unit and its track', async () => {
    await admin`delete from subjects where id = ${subjectA}`;
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from plan_pieces where id = ${pieceA}`;
    expect(row.count).toBe(0);
    const [checks] = await admin<{ count: number }[]>`
      select count(*)::int as count from piece_checks where piece_id = ${pieceA}`;
    expect(checks.count).toBe(0);
    const [practice] = await admin<{ count: number }[]>`
      select count(*)::int as count from piece_practice where piece_id = ${pieceA}`;
    expect(practice.count).toBe(0);
    const [handIns] = await admin<{ count: number }[]>`
      select count(*)::int as count from piece_practice_handins where practice_id = ${practiceA}`;
    expect(handIns.count).toBe(0);
    const [projects] = await admin<{ count: number }[]>`
      select count(*)::int as count from plan_projects where subject_id = ${subjectA}`;
    expect(projects.count).toBe(0);
    const [projectHandIns] = await admin<{ count: number }[]>`
      select count(*)::int as count from plan_project_handins where project_id = ${projectA}`;
    expect(projectHandIns.count).toBe(0);
  });
});

describe("changing a goal's plan (plan #1144)", () => {
  // learn 0076_plan_unit_edits.sql. Units are moved, removed and added only
  // through the three functions, which check the unit is the caller's and
  // keep the ordinals running 1, 2, 3.
  let subjectA = '';
  let subjectB = '';
  let units: string[] = [];
  let goalA = '';

  const order = async (subjectId: string) =>
    (
      await admin<{ id: string; ordinal: number }[]>`
        select id, ordinal from curriculum_units where subject_id = ${subjectId} order by ordinal`
    ).map((row) => [row.id, row.ordinal]);

  beforeAll(async () => {
    const [a] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Finance') returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userB}, 'Bob finance') returning id`;
    subjectA = a.id;
    subjectB = b.id;
    const rows = await admin<{ id: string }[]>`
      insert into curriculum_units (user_id, subject_id, ordinal, title, covers, outcome)
      values (${userA}, ${subjectA}, 1, 'Accounts', 'c', 'o'),
             (${userA}, ${subjectA}, 2, 'Cash flow', 'c', 'o'),
             (${userA}, ${subjectA}, 3, 'Valuation', 'c', 'o')
      returning id`;
    units = rows.map((row) => row.id);
    const [goal] = await admin<{ id: string }[]>`
      insert into goals (user_id, subject_id, asked, status, unit_id)
      values (${userA}, ${subjectA}, 'Cash flow', 'active', ${units[1]}) returning id`;
    goalA = goal.id;
  });

  it('moves a unit and renumbers the rest', async () => {
    await asUser(userA, (tx) => tx`select move_curriculum_unit(${units[2]}, 1)`);
    expect(await order(subjectA)).toEqual([
      [units[2], 1],
      [units[0], 2],
      [units[1], 3],
    ]);
    await asUser(userA, (tx) => tx`select move_curriculum_unit(${units[2]}, 99)`);
    expect(await order(subjectA)).toEqual([
      [units[0], 1],
      [units[1], 2],
      [units[2], 3],
    ]);
  });

  it("refuses to move or remove another user's unit", async () => {
    await expect(asUser(userB, (tx) => tx`select move_curriculum_unit(${units[0]}, 3)`)).rejects.toThrow();
    await expect(asUser(userB, (tx) => tx`select remove_curriculum_unit(${units[0]})`)).rejects.toThrow();
    await expect(
      asUser(userB, (tx) => tx`select add_curriculum_unit(${subjectA}, 'Smuggled', '', '', null)`),
    ).rejects.toThrow();
    expect(await order(subjectA)).toHaveLength(3);
  });

  it('refuses to remove a unit with a passed piece', async () => {
    await admin`
      insert into plan_pieces (user_id, subject_id, unit_id, ordinal, title, passed_at)
      values (${userA}, ${subjectA}, ${units[0]}, 1, 'Reading a balance sheet', now())`;
    await expect(asUser(userA, (tx) => tx`select remove_curriculum_unit(${units[0]})`)).rejects.toThrow(
      /passed piece/,
    );
    expect(await order(subjectA)).toHaveLength(3);
  });

  it('removes a unit with its pieces, gives up its goal and closes the numbering', async () => {
    await admin`
      insert into plan_pieces (user_id, subject_id, unit_id, ordinal, title)
      values (${userA}, ${subjectA}, ${units[1]}, 1, 'Operating cash flow')`;
    await asUser(userA, (tx) => tx`select remove_curriculum_unit(${units[1]})`);
    expect(await order(subjectA)).toEqual([
      [units[0], 1],
      [units[2], 2],
    ]);
    const [pieces] = await admin<{ count: number }[]>`
      select count(*)::int as count from plan_pieces where unit_id = ${units[1]}`;
    expect(pieces.count).toBe(0);
    const [goal] = await admin<{ status: string; unit_id: string | null }[]>`
      select status, unit_id from goals where id = ${goalA}`;
    expect(goal).toEqual({ status: 'abandoned', unit_id: null });
  });

  it('adds a unit by name at the end of its track', async () => {
    const [row] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`select add_curriculum_unit(${subjectA}, '  Forecasting ', 'c', 'o', null) as id`,
    );
    const [unit] = await admin<{ title: string; ordinal: number; user_id: string }[]>`
      select title, ordinal, user_id from curriculum_units where id = ${row.id}`;
    expect(unit).toEqual({ title: 'Forecasting', ordinal: 3, user_id: userA });
  });

  it('is not callable by anyone signed out', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe('set local role anon');
        return tx`select learn.move_curriculum_unit(${units[0]}, 2)`;
      }),
    ).rejects.toThrow();
    expect(await order(subjectB)).toHaveLength(0);
  });
});

describe('review questions on passed ideas (plan #1145)', () => {
  // learn 0077_idea_reviews.sql. The schedule is two columns on concept_state;
  // the questions are rows keyed on (concept_id, user_id), so one cannot land
  // on somebody else's idea.
  let conceptA = '';

  beforeAll(async () => {
    const [subject] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Review subject') returning id`;
    const [concept] = await admin<{ id: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userA}, ${subject.id}, 'Churn compounds', 'Each month loses a share of what is left.',
              'Written by hand for this test.')
      returning id`;
    conceptA = concept.id;
    await admin`insert into concept_state (concept_id, user_id, state, established, tested_at)
                values (${conceptA}, ${userA}, 'known', 'tested', now())`;
  });

  it("lets the owner schedule an idea and ask and answer a question on it, and shows nobody else", async () => {
    await asUser(
      userA,
      (tx) => tx`update concept_state set review_interval_days = 1, review_due_on = current_date
                 where concept_id = ${conceptA}`,
    );
    await asUser(
      userA,
      (tx) => tx`insert into review_questions (user_id, concept_id, question, expected)
                 values (${userA}, ${conceptA}, 'Why does a steady rate lose less each month?', 'It is a share of a smaller base.')`,
    );
    await asUser(
      userA,
      (tx) => tx`update review_questions set response = 'The base shrinks.', correct = true,
                   marked_why = 'Right.', answered_at = now() where concept_id = ${conceptA}`,
    );
    expect(await asUser(userA, (tx) => tx`select correct from review_questions`)).toEqual([{ correct: true }]);
    expect(await asUser(userB, (tx) => tx`select id from review_questions`)).toHaveLength(0);
    await asUser(userB, (tx) => tx`update concept_state set review_interval_days = 35 where concept_id = ${conceptA}`);
    const [state] = await admin<{ review_interval_days: number }[]>`
      select review_interval_days from concept_state where concept_id = ${conceptA}`;
    expect(state.review_interval_days).toBe(1);
  });

  it("refuses a question on another user's idea, a mark without an answer, and a gap without a date", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into review_questions (user_id, concept_id, question, expected)
                   values (${userB}, ${conceptA}, 'Smuggled?', 'Yes.')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into review_questions (user_id, concept_id, question, expected, correct)
                   values (${userA}, ${conceptA}, 'Half marked?', 'No.', true)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`update concept_state set review_interval_days = 3, review_due_on = null where concept_id = ${conceptA}`,
      ),
    ).rejects.toThrow();
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

describe('notes on cards and ideas', () => {
  // 0061_card_notes.sql (plan #1058). Written by their owner on a Learn now
  // card or an idea's page, kept against the card and its idea, and kept on
  // the idea when the card goes.
  let cardA = '';
  let conceptA = '';
  let noteA = '';

  beforeAll(async () => {
    const [provider] = await admin<{ id: string }[]>`
      insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
      values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
              'REST API, no key, section text')
      on conflict (slug) do update set name = excluded.name
      returning id`;
    const [item] = await admin<{ id: string }[]>`
      insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
      values (${provider.id}, 'Deflation', 'Deflation', 'article', 'https://en.wikipedia.org/wiki/Deflation')
      returning id`;
    const [segment] = await admin<{ id: string }[]>`
      insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
      values (${item.id}, 1, 'Causes', 'Causes', 'Prices fall when...')
      returning id`;
    const [subject] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Notes subject') returning id`;
    const [concept] = await admin<{ id: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userA}, ${subject.id}, 'Deflation', 'Falling prices can deepen a slump.',
              'Written by hand for this test.')
      returning id`;
    conceptA = concept.id;
    const [card] = await admin<{ id: string }[]>`
      insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, concept_id)
      values (${userA}, 'interest', 'Prices', ${item.id}, ${segment.id}, ${conceptA})
      returning id`;
    cardA = card.id;
    const [note] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`
        insert into card_notes (user_id, card_id, concept_id, body)
        values (${userA}, ${cardA}, ${conceptA}, 'Like 1930s America?')
        returning id`,
    );
    noteA = note.id;
  });

  it('shows the owner their notes and another user none of them', async () => {
    const own = await asUser(userA, (tx) => tx`select id from card_notes`);
    const other = await asUser(userB, (tx) => tx`select id from card_notes`);
    expect(own.map((r) => r.id)).toEqual([noteA]);
    expect(other).toHaveLength(0);
  });

  it('does not let a user file a note under another account', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into card_notes (user_id, concept_id, body)
                   values (${userA}, ${conceptA}, 'Planted')`,
      ),
    ).rejects.toThrow();
  });

  it("does not let a user pin their own note to another account's card or idea", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into card_notes (user_id, card_id, body)
                   values (${userB}, ${cardA}, 'On your card')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into card_notes (user_id, concept_id, body)
                   values (${userB}, ${conceptA}, 'On your idea')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses an empty note', async () => {
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into card_notes (user_id, concept_id, body)
                   values (${userA}, ${conceptA}, '   ')`,
      ),
    ).rejects.toThrow();
  });

  it('lets only the owner delete a note', async () => {
    await asUser(userB, (tx) => tx`delete from card_notes`);
    const left = await admin`select id from card_notes where id = ${noteA}`;
    expect(left).toHaveLength(1);
  });

  it('keeps the note on its idea when the card goes', async () => {
    await admin`delete from feed_cards where id = ${cardA}`;
    const [row] = await admin<{ card_id: string | null; concept_id: string | null; body: string }[]>`
      select card_id, concept_id, body from card_notes where id = ${noteA}`;
    expect(row).toEqual({ card_id: null, concept_id: conceptA, body: 'Like 1930s America?' });
  });
});

describe('phrases explained on cards', () => {
  // 0062_phrase_explanations.sql (plan #1057). A phrase selected on a Learn
  // now card, Dash's explanation of it, and the card it was made into.
  let cardA = '';
  let rowA = '';

  beforeAll(async () => {
    const [provider] = await admin<{ id: string }[]>`
      insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
      values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
              'REST API, no key, section text')
      on conflict (slug) do update set name = excluded.name
      returning id`;
    const [item] = await admin<{ id: string }[]>`
      insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
      values (${provider.id}, 'AlphaGo', 'AlphaGo', 'article', 'https://en.wikipedia.org/wiki/AlphaGo')
      returning id`;
    const [segment] = await admin<{ id: string }[]>`
      insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
      values (${item.id}, 1, 'Algorithm', 'Algorithm', 'AlphaGo uses a Monte Carlo tree search...')
      returning id`;
    const [card] = await admin<{ id: string }[]>`
      insert into feed_cards (user_id, reason, theme_name, item_id, segment_id)
      values (${userA}, 'interest', 'Games', ${item.id}, ${segment.id})
      returning id`;
    cardA = card.id;
    const [row] = await asUser(
      userA,
      (tx) => tx<{ id: string }[]>`
        insert into phrase_explanations (user_id, card_id, phrase, explanation, article, model)
        values (${userA}, ${cardA}, 'tree search', 'Searching a tree of moves.', 'Monte Carlo tree search', 'test')
        returning id`,
    );
    rowA = row.id;
  });

  it('shows the owner their explanations and another user none of them', async () => {
    const own = await asUser(userA, (tx) => tx`select id from phrase_explanations`);
    const other = await asUser(userB, (tx) => tx`select id from phrase_explanations`);
    expect(own.map((r) => r.id)).toEqual([rowA]);
    expect(other).toHaveLength(0);
  });

  it("does not let a user explain a phrase on another account's card", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into phrase_explanations (user_id, card_id, phrase, explanation, model)
                   values (${userB}, ${cardA}, 'self-play', 'Playing itself.', 'test')`,
      ),
    ).rejects.toThrow();
  });

  it('keeps one explanation per phrase on a card, whatever its case', async () => {
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into phrase_explanations (user_id, card_id, phrase, explanation, model)
                   values (${userA}, ${cardA}, 'Tree Search', 'Again.', 'test')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses an asked card with no phrase', async () => {
    await expect(
      admin`insert into feed_cards (user_id, reason, item_id, segment_id, idea_index)
            select ${userA}, 'asked', item_id, segment_id, 5 from feed_cards where id = ${cardA}`,
    ).rejects.toThrow();
  });

  it('goes with the card it was selected on', async () => {
    await admin`delete from feed_cards where id = ${cardA}`;
    const left = await admin`select id from phrase_explanations where id = ${rowA}`;
    expect(left).toHaveLength(0);
  });
});

describe('teach-backs and Learn settings', () => {
  // 0064_teach_back.sql (plan #1054). A teach-back is a card about an idea
  // already kept, with no section; learn.settings holds how often they come.
  let conceptA = '';

  beforeAll(async () => {
    const [subject] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Teach-back subject') returning id`;
    const [concept] = await admin<{ id: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userA}, ${subject.id}, 'Tree search', 'Searching ahead beats judging a position alone.',
              'Written by hand for this test.')
      returning id`;
    conceptA = concept.id;
    await asUser(userA, (tx) => tx`insert into settings (user_id, teach_back_every) values (${userA}, 20)`);
  });

  it('takes a teach-back card with an idea and no section', async () => {
    const [card] = await admin<{ id: string }[]>`
      insert into feed_cards (user_id, reason, status, concept_id, idea_name, summary, why, context, hook)
      values (${userA}, 'teach_back', 'ready', ${conceptA}, 'Tree search', 'claim', 'why', 'context', 'Explain it')
      returning id`;
    await admin`update feed_cards set teach_back = '{"stage": "follow_up"}'::jsonb where id = ${card.id}`;
    const [row] = await admin<{ teach_back: { stage: string } }[]>`
      select teach_back from feed_cards where id = ${card.id}`;
    expect(row.teach_back.stage).toBe('follow_up');
  });

  it('refuses a teach-back with no idea, and teach-back marks on any other card', async () => {
    await expect(
      admin`insert into feed_cards (user_id, reason, status, idea_name, summary, why, context, hook)
            values (${userA}, 'teach_back', 'ready', 'Tree search', 'claim', 'why', 'context', 'Explain it')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into feed_cards (user_id, reason, reading_id, teach_back)
            values (${userA}, 'queued', null, '{}'::jsonb)`,
    ).rejects.toThrow();
  });

  it('shows the owner their settings and another user none', async () => {
    const own = await asUser(userA, (tx) => tx`select teach_back_every from settings`);
    const other = await asUser(userB, (tx) => tx`select teach_back_every from settings`);
    expect(own.map((r) => r.teach_back_every)).toEqual([20]);
    expect(other).toHaveLength(0);
  });

  it("does not let a user write another account's settings", async () => {
    await expect(
      asUser(userB, (tx) => tx`insert into settings (user_id, teach_back_every) values (${userA}, 5)`),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update settings set teach_back_every = 0`);
    const [row] = await admin<{ teach_back_every: number }[]>`
      select teach_back_every from settings where user_id = ${userA}`;
    expect(row.teach_back_every).toBe(20);
  });

  it('refuses a rate of one in one', async () => {
    await expect(
      asUser(userA, (tx) => tx`update settings set teach_back_every = 1`),
    ).rejects.toThrow();
  });
});

describe('your list of videos', () => {
  // 0065_watch_list.sql (plan #1065). One row per person and video, read from
  // the playlist in learn.settings by the service role, and theirs alone.
  const video = 'dQw4w9WgXcQ';

  beforeAll(async () => {
    await admin`insert into watch_list (user_id, video_id) values (${userA}, ${video})`;
  });

  it('shows the owner their list and another user none', async () => {
    const own = await asUser(userA, (tx) => tx`select video_id, came_from from watch_list`);
    const other = await asUser(userB, (tx) => tx`select video_id from watch_list`);
    expect(own).toEqual([{ video_id: video, came_from: 'playlist' }]);
    expect(other).toHaveLength(0);
  });

  it("does not let a user add to or mark another account's list", async () => {
    await expect(
      asUser(userB, (tx) => tx`insert into watch_list (user_id, video_id) values (${userA}, 'aaaaaaaaaaa')`),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update watch_list set watched_at = now()`);
    const [row] = await admin<{ watched_at: Date | null }[]>`
      select watched_at from watch_list where user_id = ${userA} and video_id = ${video}`;
    expect(row.watched_at).toBeNull();
  });

  it('holds one row per video, and refuses a verdict or stretch that cannot be', async () => {
    await expect(admin`insert into watch_list (user_id, video_id) values (${userA}, ${video})`).rejects.toThrow();
    await expect(
      admin`update watch_list set verdict = 'maybe' where user_id = ${userA}`,
    ).rejects.toThrow();
    await expect(
      admin`update watch_list set best_start_seconds = 300, best_end_seconds = 60 where user_id = ${userA}`,
    ).rejects.toThrow();
    await expect(
      admin`update watch_list set verdict_by = 'you' where user_id = ${userA}`,
    ).rejects.toThrow();
  });

  it('takes a video kept from a channel Learn found, and no other origin', async () => {
    await admin`insert into watch_list (user_id, video_id, came_from) values (${userA}, 'bbbbbbbbbbb', 'channel search')`;
    await expect(
      admin`insert into watch_list (user_id, video_id, came_from) values (${userA}, 'ccccccccccc', 'somewhere')`,
    ).rejects.toThrow();
  });

  it('keeps the playlist in settings, and only as an id', async () => {
    await admin`update settings set youtube_playlist_id = 'PLabcdefghij1234' where user_id = ${userA}`;
    await expect(
      admin`update settings set youtube_playlist_id = 'https://youtube.com/x' where user_id = ${userA}`,
    ).rejects.toThrow();
  });
});

describe('the channels found for a subject', () => {
  // 0080_subject_channels.sql (plan #1194). One row per subject and channel,
  // written by the channel search and the judge, and theirs alone.
  const channel = 'UCYO_jab_esuFRV4b17AJtAw';
  let subjectA = '';

  beforeAll(async () => {
    const [a] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Linear algebra') returning id`;
    subjectA = a.id;
    await asUser(
      userA,
      (tx) => tx`insert into subject_channels (user_id, subject_id, youtube_channel_id, title, handle, found_why)
                 values (${userA}, ${subjectA}, ${channel}, '3Blue1Brown', '@3blue1brown', 'Recommended for intuition.')`,
    );
  });

  it('shows the owner their channels and another user none', async () => {
    const own = await asUser(userA, (tx) => tx`select title, verdict, samples from subject_channels`);
    const other = await asUser(userB, (tx) => tx`select id from subject_channels`);
    expect(own).toEqual([{ title: '3Blue1Brown', verdict: null, samples: [] }]);
    expect(other).toHaveLength(0);
  });

  it("does not let a user file a channel on another account's subject", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into subject_channels (user_id, subject_id, youtube_channel_id, title)
                   values (${userB}, ${subjectA}, ${channel}, 'Stolen')`,
      ),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update subject_channels set decided = 'passed', decided_at = now()`);
    const [row] = await admin<{ decided: string | null }[]>`
      select decided from subject_channels where subject_id = ${subjectA}`;
    expect(row.decided).toBeNull();
  });

  it('holds a channel once per subject, and refuses a verdict or decision that cannot be', async () => {
    await expect(
      admin`insert into subject_channels (user_id, subject_id, youtube_channel_id, title)
            values (${userA}, ${subjectA}, ${channel}, 'Again')`,
    ).rejects.toThrow();
    await expect(
      admin`insert into subject_channels (user_id, subject_id, youtube_channel_id, title)
            values (${userA}, ${subjectA}, 'not-a-channel', 'Bad id')`,
    ).rejects.toThrow();
    await expect(
      admin`update subject_channels set verdict = 'follow' where subject_id = ${subjectA}`,
    ).rejects.toThrow();
    await expect(
      admin`update subject_channels set decided = 'maybe', decided_at = now() where subject_id = ${subjectA}`,
    ).rejects.toThrow();
    await admin`
      update subject_channels
      set verdict = 'follow', why = 'Builds each idea from pictures, at your level.', judged_at = now(),
          samples = '[{"video_id": "fNk_zzaMoSs", "title": "Vectors", "verdict": "card", "line": "Clear."}]'::jsonb,
          decided = 'followed', decided_at = now()
      where subject_id = ${subjectA}`;
  });

  it('goes with the subject', async () => {
    await admin`delete from subjects where id = ${subjectA}`;
    const left = await admin`select id from subject_channels where subject_id = ${subjectA}`;
    expect(left).toHaveLength(0);
  });
});

describe('courses read in from a transcript', () => {
  // 0086_course_reads.sql (plan #1389). One row per course from the vault's
  // Education tab that has been read into Learn, with the track it went into.
  let transcriptA = '';
  let courseA = '';
  let subjectA = '';

  async function seedCourse(userId: string, transcriptId: string, title: string): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into obsidian.courses (user_id, transcript_id, school, title, position)
      values (${userId}, ${transcriptId}, 'State University', ${title}, 0)
      returning id`;
    return row.id;
  }

  beforeAll(async () => {
    const [t] = await admin<{ id: string }[]>`
      insert into obsidian.transcripts (user_id, school, file_name, storage_path, mime_type, size_bytes)
      values (${userA}, 'State University', 'record.pdf', ${`${userA}/${crypto.randomUUID()}-record.pdf`},
              'application/pdf', 1000)
      returning id`;
    transcriptA = t.id;
    courseA = await seedCourse(userA, transcriptA, 'Principles of Economics');
    const [s] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name) values (${userA}, 'Economics') returning id`;
    subjectA = s.id;
    await asUser(
      userA,
      (tx) => tx`insert into course_reads (user_id, course_id, subject_id, concepts_added)
                 values (${userA}, ${courseA}, ${subjectA}, 7)`,
    );
  });

  it('shows the owner their records and another user none', async () => {
    const own = await asUser(userA, (tx) => tx`select course_id, concepts_added from course_reads`);
    const other = await asUser(userB, (tx) => tx`select id from course_reads`);
    expect(own).toEqual([{ course_id: courseA, concepts_added: 7 }]);
    expect(other).toHaveLength(0);
  });

  it("does not let a user record another account's course, or change a record of theirs", async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`insert into course_reads (user_id, course_id) values (${userB}, ${courseA})`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into course_reads (user_id, course_id) values (${userB}, ${courseA})`,
      ),
    ).rejects.toThrow();
    await asUser(userB, (tx) => tx`update course_reads set concepts_added = 0`);
    await asUser(userB, (tx) => tx`delete from course_reads`);
    const [row] = await admin<{ concepts_added: number }[]>`
      select concepts_added from course_reads where course_id = ${courseA}`;
    expect(row.concepts_added).toBe(7);
  });

  it('holds a course once, and refuses a negative count', async () => {
    await expect(
      admin`insert into course_reads (user_id, course_id) values (${userA}, ${courseA})`,
    ).rejects.toThrow();
    await expect(
      admin`update course_reads set concepts_added = -1 where course_id = ${courseA}`,
    ).rejects.toThrow();
  });

  it('keeps the record when its track is deleted, and drops it with the course', async () => {
    await admin`delete from subjects where id = ${subjectA}`;
    const [kept] = await admin<{ subject_id: string | null }[]>`
      select subject_id from course_reads where course_id = ${courseA}`;
    expect(kept.subject_id).toBeNull();

    await admin`delete from obsidian.courses where id = ${courseA}`;
    expect(await admin`select id from course_reads where course_id = ${courseA}`).toHaveLength(0);
  });

  it('drops the record with the transcript its course came from', async () => {
    const course = await seedCourse(userA, transcriptA, 'Calculus I');
    await admin`insert into course_reads (user_id, course_id) values (${userA}, ${course})`;
    await admin`delete from obsidian.transcripts where id = ${transcriptA}`;
    expect(await admin`select id from course_reads where course_id = ${course}`).toHaveLength(0);
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
