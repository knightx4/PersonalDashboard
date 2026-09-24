/**
 * One idea per Learn now card (LEARN-NOW-SPEC, "One idea per card"):
 * migrations-learn/0052_feed_card_ideas.sql.
 *
 * A section can carry a card for each of its ideas, numbered by idea_index,
 * and still only one card per idea. Ideas are kept as concepts with an
 * embedding, and learn.nearest_concepts finds one person's ideas nearest a
 * vector, closest first, and never another person's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-learn';

const ARTICLE = 'Startup company (feed ideas)';

let userA = '';
let userB = '';
let itemId = '';
let segmentId = '';

/** A 1024-wide vector pointing mostly along `axis`, tilted towards `toward` by `tilt`. */
function vector(axis: number, toward = axis, tilt = 0): string {
  const values = new Array<number>(1024).fill(0);
  values[axis] = 1;
  values[toward] += tilt;
  return `[${values.join(',')}]`;
}

async function concept(userId: string, subjectId: string, name: string, embedding: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into concepts (user_id, subject_id, name, claim, basis, origin, embedding, embedding_model)
    values (${userId}, ${subjectId}, ${name}, ${name + ' holds.'}, 'From a Learn now card.', 'feed',
            ${embedding}::extensions.vector, 'voyage-4-lite')
    returning id`;
  return row.id;
}

async function card(userId: string, index: number): Promise<void> {
  await admin`
    insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, status, summary, idea_name, idea_index)
    values (${userId}, 'interest', 'Startups', ${itemId}, ${segmentId}, 'ready', 'Why.', ${'Idea ' + index}, ${index})`;
}

beforeAll(async () => {
  await truncateAll();
  await admin`delete from catalogue_items where external_id = ${ARTICLE}`;
  userA = await createUser('feed-ideas-a@example.com');
  userB = await createUser('feed-ideas-b@example.com');

  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
            'REST API, no key, section text')
    on conflict (slug) do update set name = excluded.name
    returning id`;
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${provider.id}, ${ARTICLE}, ${ARTICLE}, 'article', 'https://example.org/startup')
    returning id`;
  itemId = item.id;
  const [segment] = await admin<{ id: string }[]>`
    insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
    values (${itemId}, 1, 'Failure', 'Failure', 'Most startups fail.')
    returning id`;
  segmentId = segment.id;
});

afterAll(async () => {
  await truncateAll();
  await admin`delete from catalogue_items where external_id = ${ARTICLE}`;
  await closeDb();
});

describe('cards on one section', () => {
  it('takes a card for each idea, and refuses a second card for the same idea', async () => {
    await card(userA, 0);
    await card(userA, 1);
    await card(userA, 2);
    await expect(card(userA, 1)).rejects.toThrow(/feed_cards_segment_idea_uq/);

    const rows = await admin<{ idea_index: number }[]>`
      select idea_index from feed_cards where user_id = ${userA} order by idea_index`;
    expect(rows.map((row) => row.idea_index)).toEqual([0, 1, 2]);
  });

  it('numbers a pick as idea 0 when nothing says otherwise', async () => {
    const [row] = await admin<{ idea_index: number }[]>`
      insert into feed_cards (user_id, reason, theme_name, item_id, segment_id)
      values (${userB}, 'interest', 'Startups', ${itemId}, ${segmentId})
      returning idea_index`;
    expect(row.idea_index).toBe(0);
  });
});

describe('learn.nearest_concepts', () => {
  it('returns one person ideas nearest a vector, closest first, above the floor', async () => {
    const [subjectA] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name, survey) values (${userA}, ${ARTICLE}, true) returning id`;
    const [subjectB] = await admin<{ id: string }[]>`
      insert into subjects (user_id, name, survey) values (${userB}, ${ARTICLE}, true) returning id`;

    const exact = await concept(userA, subjectA.id, 'Demand fails before cash', vector(0));
    const near = await concept(userA, subjectA.id, 'Founders blame money', vector(1, 0, 1));
    await concept(userA, subjectA.id, 'Patents cost startups', vector(2));
    await concept(userB, subjectB.id, 'Another person idea', vector(0));

    const rows = await admin<{ concept_id: string; similarity: number; state: string }[]>`
      select concept_id, similarity, state from nearest_concepts(${userA}, ${vector(0)}, 10, 0.5)`;
    expect(rows.map((row) => row.concept_id)).toEqual([exact, near]);
    expect(rows[0].similarity).toBeCloseTo(1, 5);
    expect(rows[1].similarity).toBeCloseTo(Math.SQRT1_2, 5);
    expect(rows[0].state).toBe('unknown');
  });

  it('reports the state the idea is in', async () => {
    const [row] = await admin<{ id: string }[]>`
      select id from concepts where user_id = ${userA} and name = 'Demand fails before cash'`;
    await admin`
      insert into concept_state (concept_id, user_id, state, established, declared_at)
      values (${row.id}, ${userA}, 'known', 'declared', now())`;
    const [nearest] = await admin<{ state: string }[]>`
      select state from nearest_concepts(${userA}, ${vector(0)}, 1, 0.9)`;
    expect(nearest.state).toBe('known');
  });

  it('may not be called by anyone signed out', async () => {
    const [row] = await admin<{ anon: boolean; service: boolean }[]>`
      select
        has_function_privilege('anon', 'learn.nearest_concepts(uuid, text, integer, double precision)', 'execute') as anon,
        has_function_privilege('service_role', 'learn.nearest_concepts(uuid, text, integer, double precision)', 'execute') as service`;
    expect(row).toEqual({ anon: false, service: true });
  });
});
