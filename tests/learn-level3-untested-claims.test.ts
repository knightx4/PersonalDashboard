/**
 * Practice Flow's Level 3 pick and its tested count (plan #1386):
 * learn.level3_untested_claims(limit), read as the person.
 *
 * A claimed article with no right answer is returned and a tested one is
 * skipped, the longest claimed first, and only your own. Then a right answer
 * filed as Practice Flow files it -- the idea in the goal's hidden subject,
 * cross-listed under the article's subject -- raises the tested count by one
 * and takes the article out of the pick, with no change to article_evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

const CLAIMED = 'Metallurgy (plan 1386)';
const LATER = 'Glacier (plan 1386)';
const TESTED = 'Photosynthesis (plan 1386)';
const ALL = [CLAIMED, LATER, TESTED];

let userA = '';
let userB = '';
let providerId = '';

async function cleanShared(): Promise<void> {
  await admin`delete from area_check_articles where title in ${admin(ALL)}`;
  await admin`delete from catalogue_items where external_id in ${admin(ALL)}`;
}

async function seedGotIt(userId: string, title: string, at: string): Promise<void> {
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${providerId}, ${title}, ${title}, 'article', ${'https://example.org/' + encodeURIComponent(title)})
    on conflict (provider_id, external_id) do update set title = excluded.title
    returning id`;
  const [segment] = await admin<{ id: string }[]>`
    insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
    values (${item.id}, 0, null, null, 'Some text.')
    on conflict (item_id, ordinal) do update set text = excluded.text
    returning id`;
  await admin`
    insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, status, summary, created_at, acted_at)
    values (${userId}, 'interest', 'Things', ${item.id}, ${segment.id}, 'known', 'A summary.', ${at}, ${at})`;
}

/** A right answer on an idea in `homeId`, cross-listed under `articleId` when given. */
async function seedRightAnswer(
  userId: string,
  homeId: string,
  articleId: string | null,
): Promise<void> {
  const [concept] = await admin<{ id: string }[]>`
    insert into concepts (user_id, subject_id, name, claim, basis)
    values (${userId}, ${homeId}, ${'An idea ' + Math.random()}, 'A claim.', 'From the card.')
    returning id`;
  if (articleId) {
    await admin`
      insert into concept_subjects (user_id, concept_id, subject_id, basis)
      values (${userId}, ${concept.id}, ${articleId}, 'Asked about in Practice Flow.')`;
  }
  await admin`
    insert into concept_state (concept_id, user_id, state, established, tested_at)
    values (${concept.id}, ${userId}, 'recognised', 'tested', now())`;
}

async function pickFor(userId: string): Promise<string[]> {
  const rows = await asUser(
    userId,
    (tx) => tx<{ title: string }[]>`
    select title from level3_untested_claims()`,
  );
  return rows.map((row) => row.title).filter((title) => ALL.includes(title));
}

async function testedFor(userId: string): Promise<number> {
  const [row] = await asUser(
    userId,
    (tx) => tx<{ tested: string }[]>`
    select tested from level3_evidence_counts()`,
  );
  return Number(row.tested);
}

beforeAll(async () => {
  await truncateAll();
  await cleanShared();
  userA = await createUser('level3-untested-a@example.com');
  userB = await createUser('level3-untested-b@example.com');

  for (const title of ALL) {
    await admin`insert into area_check_articles (title, section) values (${title}, 'Science > Things')`;
  }
  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
            'REST API, no key, section text')
    on conflict (slug) do update set name = excluded.name
    returning id`;
  providerId = provider.id;

  await seedGotIt(userA, CLAIMED, '2026-08-01T10:00:00Z');
  await seedGotIt(userA, LATER, '2026-09-01T10:00:00Z');
  await seedGotIt(userA, TESTED, '2026-07-01T10:00:00Z');
  const [tested] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userA}, ${TESTED}) returning id`;
  await seedRightAnswer(userA, tested.id, null);
});

afterAll(async () => {
  await truncateAll();
  await cleanShared();
  await closeDb();
});

describe('learn.level3_untested_claims', () => {
  it('skips an article already tested and puts the longest claimed first', async () => {
    expect(await pickFor(userA)).toEqual([CLAIMED, LATER]);
  });

  it("returns nothing of another person's", async () => {
    expect(await pickFor(userB)).toEqual([]);
  });

  it('can be called by a signed-in person and not by anon', async () => {
    const signature = 'learn.level3_untested_claims(integer)';
    const [row] = await admin<{ anon: boolean; authed: boolean }[]>`
      select has_function_privilege('anon', ${signature}, 'execute') as anon,
             has_function_privilege('authenticated', ${signature}, 'execute') as authed`;
    expect(row).toEqual({ anon: false, authed: true });
  });

  it("counts a right answer filed as Practice Flow files it as the article's test", async () => {
    const before = await testedFor(userA);
    const [aim] = await admin<{ id: string }[]>`
      insert into aims (user_id, name, list_source, depth)
      values (${userA}, 'Every Level 3 vital article', 'level3', 'familiar')
      returning id`;
    const [goal] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name, survey, aim_id)
      values (${userA}, 'Every Level 3 vital article', true, ${aim.id}) returning id`;
    const [article] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name, survey) values (${userA}, ${CLAIMED}, true) returning id`;

    await seedRightAnswer(userA, goal.id, article.id);

    expect(await testedFor(userA)).toBe(before + 1);
    expect(await pickFor(userA)).toEqual([LATER]);
  });
});
