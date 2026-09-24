/**
 * Claimed Level 3 articles coming back (plan #912):
 * learn.level3_claimed_articles(user, exclude, limit).
 *
 * An article with a Got it and no right tested answer is returned, with when
 * it was claimed, when it was last seen, how many times it has come back and
 * the headings of the cards already had on it. An article already on a card
 * is still returned, unlike the untouched pick. A tested article, one with no
 * evidence, one in the exclude list and another person's article are not.
 * Only the service role may call it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-learn';

const ONCE = 'Metallurgy (plan 912)';
const RETURNED = 'Glacier (plan 912)';
const TESTED = 'Photosynthesis (plan 912)';
const EXCLUDED = 'Opera (plan 912)';
const UNTOUCHED = 'Vaccine (plan 912)';
const ALL = [ONCE, RETURNED, TESTED, EXCLUDED, UNTOUCHED];

let userA = '';
let userB = '';
let providerId = '';

async function cleanShared(): Promise<void> {
  await admin`delete from area_check_articles where title in ${admin(ALL)}`;
  await admin`delete from catalogue_items where external_id in ${admin(ALL)}`;
}

/** A card from one section of an article, made and acted on at the given times. */
async function seedCard(
  userId: string,
  title: string,
  ordinal: number,
  heading: string | null,
  status: string,
  createdAt: string,
): Promise<void> {
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${providerId}, ${title}, ${title}, 'article', ${'https://example.org/' + encodeURIComponent(title)})
    on conflict (provider_id, external_id) do update set title = excluded.title
    returning id`;
  const [segment] = await admin<{ id: string }[]>`
    insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
    values (${item.id}, ${ordinal}, ${heading}, ${heading}, 'Some text.')
    on conflict (item_id, ordinal) do update set text = excluded.text
    returning id`;
  await admin`
    insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, status, summary, created_at, acted_at)
    values (${userId}, 'interest', 'Things', ${item.id}, ${segment.id}, ${status}, 'A summary.',
            ${createdAt}, ${status === 'known' ? createdAt : null})`;
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

type Row = { title: string; claimed_at: Date; last_seen_at: Date; returns: number; earlier: (string | null)[] };

async function claimedFor(userId: string, exclude: string[] = []): Promise<Row[]> {
  const rows = await admin<Row[]>`
    select title, claimed_at, last_seen_at, returns, earlier
      from level3_claimed_articles(${userId}, ${exclude}::text[])`;
  return rows.filter((row) => ALL.includes(row.title)).sort((a, b) => a.title.localeCompare(b.title));
}

beforeAll(async () => {
  await truncateAll();
  await cleanShared();
  userA = await createUser('level3-claimed-a@example.com');
  userB = await createUser('level3-claimed-b@example.com');

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

  await seedCard(userA, ONCE, 0, null, 'known', '2026-09-01T10:00:00Z');
  // Got it on the lead, then back once at another section, not read yet.
  await seedCard(userA, RETURNED, 0, null, 'known', '2026-08-01T10:00:00Z');
  await seedCard(userA, RETURNED, 1, 'Formation', 'picked', '2026-08-09T10:00:00Z');
  await seedCard(userA, TESTED, 0, null, 'known', '2026-08-01T10:00:00Z');
  await seedRightAnswer(userA, TESTED);
  await seedCard(userA, EXCLUDED, 0, null, 'known', '2026-08-01T10:00:00Z');
});

afterAll(async () => {
  await truncateAll();
  await cleanShared();
  await closeDb();
});

describe('learn.level3_claimed_articles', () => {
  it('returns claimed, untested articles with what the return rule needs', async () => {
    const rows = await claimedFor(userA, [EXCLUDED.toUpperCase()]);
    expect(rows.map((row) => row.title)).toEqual([RETURNED, ONCE].sort());
    const returned = rows.find((row) => row.title === RETURNED)!;
    expect(returned).toMatchObject({ returns: 1, earlier: [null, 'Formation'] });
    expect(returned.claimed_at.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    expect(returned.last_seen_at.toISOString()).toBe('2026-08-09T10:00:00.000Z');
    const once = rows.find((row) => row.title === ONCE)!;
    expect(once).toMatchObject({ returns: 0, earlier: [null] });
    expect(once.last_seen_at.toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('leaves out the excluded titles only when asked', async () => {
    expect((await claimedFor(userA)).map((row) => row.title)).toEqual([EXCLUDED, RETURNED, ONCE].sort());
  });

  it('returns nothing for someone with no evidence', async () => {
    expect(await claimedFor(userB)).toEqual([]);
  });

  it('can only be called by the service role', async () => {
    const signature = 'learn.level3_claimed_articles(uuid, text[], integer)';
    const [row] = await admin<{ anon: boolean; authed: boolean; service: boolean }[]>`
      select
        has_function_privilege('anon', ${signature}, 'execute') as anon,
        has_function_privilege('authenticated', ${signature}, 'execute') as authed,
        has_function_privilege('service_role', ${signature}, 'execute') as service`;
    expect(row).toEqual({ anon: false, authed: false, service: true });
  });
});
