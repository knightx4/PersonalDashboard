/**
 * The Level 3 goal's two counts (plan #906): learn.level3_evidence_counts().
 *
 * A Got it on one Level 3 article and a right tested answer on another make
 * 2 claimed and 1 tested. More evidence on an article already counted adds
 * nothing, and another user's evidence is not yours.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

const CLAIMED = 'Metallurgy (plan 906)';
const TESTED = 'Photosynthesis (plan 906)';

let userA = '';
let userB = '';

type Counts = { claimed: string; tested: string; total: string };

async function cleanShared(): Promise<void> {
  await admin`delete from area_check_articles where title in (${CLAIMED}, ${TESTED})`;
  await admin`delete from catalogue_items where external_id in (${CLAIMED}, ${TESTED})`;
}

async function seedGotIt(userId: string, providerId: string, title: string): Promise<void> {
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${providerId}, ${title}, ${title}, 'article', ${'https://example.org/' + encodeURIComponent(title)})
    returning id`;
  // Two cards from the same article, both Got it: one article claimed.
  for (const ordinal of [1, 2]) {
    const [segment] = await admin<{ id: string }[]>`
      insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
      values (${item.id}, ${ordinal}, ${'s' + ordinal}, ${'Section ' + ordinal}, 'Ores are...')
      returning id`;
    await admin`
      insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, status, summary, acted_at)
      values (${userId}, 'interest', 'Metals', ${item.id}, ${segment.id}, 'known', 'A summary.', now())`;
  }
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

async function countsFor(userId: string): Promise<{ claimed: number; tested: number; total: number }> {
  const [row] = await asUser(userId, (tx) => tx<Counts[]>`
    select claimed, tested, total from level3_evidence_counts()`);
  return { claimed: Number(row.claimed), tested: Number(row.tested), total: Number(row.total) };
}

beforeAll(async () => {
  await truncateAll();
  await cleanShared();
  userA = await createUser('level3-counts-a@example.com');
  userB = await createUser('level3-counts-b@example.com');

  await admin`
    insert into area_check_articles (title, section) values
      (${CLAIMED}, 'Technology > Materials'),
      (${TESTED}, 'Science > Biology')`;
  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
            'REST API, no key, section text')
    on conflict (slug) do update set name = excluded.name
    returning id`;

  await seedGotIt(userA, provider.id, CLAIMED);
  await seedRightAnswer(userA, TESTED);
});

afterAll(async () => {
  await truncateAll();
  await cleanShared();
  await closeDb();
});

describe('learn.level3_evidence_counts', () => {
  it('counts a Got it and a right answer as 2 claimed and 1 tested', async () => {
    const [list] = await admin<{ n: string }[]>`select count(*) as n from area_check_articles`;
    expect(await countsFor(userA)).toEqual({ claimed: 2, tested: 1, total: Number(list.n) });
  });

  it('gives another user none of it', async () => {
    const counts = await countsFor(userB);
    expect([counts.claimed, counts.tested]).toEqual([0, 0]);
  });

  it('cannot be called without signing in', async () => {
    const [row] = await admin<{ allowed: boolean }[]>`
      select has_function_privilege('anon', 'learn.level3_evidence_counts()', 'execute') as allowed`;
    expect(row.allowed).toBe(false);
  });
});
