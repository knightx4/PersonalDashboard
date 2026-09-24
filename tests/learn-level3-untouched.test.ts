/**
 * The Level 3 goal's untouched pick (plan #910):
 * learn.level3_untouched_articles(user, count, exclude).
 *
 * An article with a Got it, a save or a right tested answer is never
 * returned, nor is one already on a card of the person's, nor one named in
 * the exclude list. Another person's evidence leaves the article untouched
 * for you. Only the service role may call it, since it takes a user id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-learn';

const GOT_IT = 'Metallurgy (plan 910)';
const TESTED = 'Photosynthesis (plan 910)';
const CARDED = 'Glacier (plan 910)';
const EXCLUDED = 'Opera (plan 910)';
const UNTOUCHED = 'Vaccine (plan 910)';
const ALL = [GOT_IT, TESTED, CARDED, EXCLUDED, UNTOUCHED];

let userA = '';
let userB = '';

async function cleanShared(): Promise<void> {
  await admin`delete from area_check_articles where title in ${admin(ALL)}`;
  await admin`delete from catalogue_items where external_id in ${admin(ALL)}`;
}

async function seedCard(userId: string, providerId: string, title: string, status: string): Promise<void> {
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${providerId}, ${title}, ${title}, 'article', ${'https://example.org/' + encodeURIComponent(title)})
    on conflict (provider_id, external_id) do update set title = excluded.title
    returning id`;
  const [segment] = await admin<{ id: string }[]>`
    insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
    values (${item.id}, 0, null, null, 'The lead.')
    on conflict (item_id, ordinal) do update set text = excluded.text
    returning id`;
  await admin`
    insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, status, summary, acted_at)
    values (${userId}, 'interest', 'Things', ${item.id}, ${segment.id}, ${status}, 'A summary.', now())`;
}

async function seedRightAnswer(userId: string, title: string): Promise<void> {
  const [subject] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userId}, ${title}) returning id`;
  const [concept] = await admin<{ id: string }[]>`
    insert into concepts (user_id, subject_id, name, claim, basis)
    values (${userId}, ${subject.id}, 'Light reactions', 'Light splits water.', 'Test me on this.')
    returning id`;
  await admin`
    insert into concept_state (concept_id, user_id, state, established, tested_at)
    values (${concept.id}, ${userId}, 'recognised', 'tested', now())`;
}

/** The seeded titles the pick returns for a user, asking for the whole list. */
async function untouchedFor(userId: string, exclude: string[] = []): Promise<string[]> {
  const rows = await admin<{ title: string }[]>`
    select title from level3_untouched_articles(${userId}, 100000, ${exclude}::text[])`;
  return rows.map((row) => row.title).filter((title) => ALL.includes(title)).sort();
}

beforeAll(async () => {
  await truncateAll();
  await cleanShared();
  userA = await createUser('level3-untouched-a@example.com');
  userB = await createUser('level3-untouched-b@example.com');

  for (const title of ALL) {
    await admin`insert into area_check_articles (title, section) values (${title}, 'Science > Things')`;
  }
  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
            'REST API, no key, section text')
    on conflict (slug) do update set name = excluded.name
    returning id`;

  await seedCard(userA, provider.id, GOT_IT, 'known');
  await seedRightAnswer(userA, TESTED);
  // Picked and not yet read: no evidence, but already shown.
  await seedCard(userA, provider.id, CARDED, 'picked');
});

afterAll(async () => {
  await truncateAll();
  await cleanShared();
  await closeDb();
});

describe('learn.level3_untouched_articles', () => {
  it('leaves out articles with evidence, articles already on a card, and the excluded titles', async () => {
    expect(await untouchedFor(userA, [EXCLUDED.toUpperCase()])).toEqual([UNTOUCHED]);
    expect(await untouchedFor(userA)).toEqual([EXCLUDED, UNTOUCHED].sort());
  });

  it('does not count another user evidence against you', async () => {
    expect(await untouchedFor(userB)).toEqual([...ALL].sort());
  });

  it('returns at most the count asked for, each article once', async () => {
    const rows = await admin<{ id: string }[]>`select id from level3_untouched_articles(${userB}, 3)`;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });

  it('can only be called by the service role', async () => {
    const [row] = await admin<{ anon: boolean; authed: boolean; service: boolean }[]>`
      select
        has_function_privilege('anon', 'learn.level3_untouched_articles(uuid, integer, text[])', 'execute') as anon,
        has_function_privilege('authenticated', 'learn.level3_untouched_articles(uuid, integer, text[])', 'execute') as authed,
        has_function_privilege('service_role', 'learn.level3_untouched_articles(uuid, integer, text[])', 'execute') as service`;
    expect(row).toEqual({ anon: false, authed: false, service: true });
  });
});
