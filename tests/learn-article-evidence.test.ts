/**
 * Every sign you know a Level 3 article (plan #904): learn.article_evidence.
 *
 * The view is what the Level 3 goal counts from, so what it takes in and what
 * it leaves out are both asserted: a Got it, a save and a right tested answer
 * are evidence; a card marked "need to work on this", an idea not yet answered
 * right, and a card on an article off the list are not. It runs with the
 * caller's RLS, so another user sees none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-learn';

const ON_LIST = 'Urbanization (plan 904)';
const OFF_LIST = 'Garden gnome (plan 904)';

let userA = '';
let userB = '';
let articleId = '';
let gotItCard = '';
let savedCard = '';
let rightConcept = '';

type Row = { article_id: string; article_title: string; kind: string; at: Date | null; source_id: string };

async function cleanShared(): Promise<void> {
  await admin`delete from area_check_articles where title in (${ON_LIST}, ${OFF_LIST})`;
  await admin`delete from catalogue_items where external_id in (${ON_LIST}, ${OFF_LIST})`;
}

async function seedItem(providerId: string, title: string): Promise<string> {
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${providerId}, ${title}, ${title}, 'article', ${'https://example.org/' + encodeURIComponent(title)})
    returning id`;
  return item.id;
}

// One card per section: a user is never shown the same section twice.
let ordinal = 0;

async function seedCard(
  userId: string,
  itemId: string,
  status: string,
  savedReadingId: string | null = null,
): Promise<string> {
  ordinal += 1;
  const [segment] = await admin<{ id: string }[]>`
    insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
    values (${itemId}, ${ordinal}, ${'s' + ordinal}, ${'Section ' + ordinal}, 'Cities grow when...')
    returning id`;
  const material = { item: itemId, segment: segment.id };
  const [card] = await admin<{ id: string }[]>`
    insert into feed_cards (user_id, reason, theme_name, item_id, segment_id, status, summary,
                            acted_at, saved_reading_id)
    values (${userId}, 'interest', 'Cities', ${material.item}, ${material.segment}, ${status},
            'A summary.', now(), ${savedReadingId})
    returning id`;
  return card.id;
}

async function seedConcept(userId: string, subjectId: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into concepts (user_id, subject_id, name, claim, basis)
    values (${userId}, ${subjectId}, ${name}, ${name + ' is a claim.'}, 'Test me on this.')
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  await cleanShared();
  userA = await createUser('evidence-a@example.com');
  userB = await createUser('evidence-b@example.com');

  const [article] = await admin<{ id: string }[]>`
    insert into area_check_articles (title, section) values (${ON_LIST}, 'Society > Cities')
    returning id`;
  articleId = article.id;

  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
            'REST API, no key, section text')
    on conflict (slug) do update set name = excluded.name
    returning id`;
  const onList = await seedItem(provider.id, ON_LIST);
  const offList = await seedItem(provider.id, OFF_LIST);

  // A save needs a reading on the list to point at.
  const [track] = await admin<{ id: string }[]>`
    insert into tracks (user_id, title, question) values (${userA}, 'Reading list', 'What to read?')
    returning id`;
  const [source] = await admin<{ id: string }[]>`
    insert into sources (user_id, title, author, kind, canonical_url, access)
    values (${userA}, ${ON_LIST}, 'Wikipedia', 'article', 'https://example.org/urbanization', 'open')
    returning id`;
  const [reading] = await admin<{ id: string }[]>`
    insert into readings (user_id, track_id, source_id, locator_basis, locator_label)
    values (${userA}, ${track.id}, ${source.id}, 'The card it was saved from.', 'Causes')
    returning id`;

  gotItCard = await seedCard(userA, onList, 'known');
  // Test me moves a saved card on to 'tested'; it is still saved.
  savedCard = await seedCard(userA, onList, 'tested', reading.id);
  await seedCard(userA, onList, 'review');
  await seedCard(userA, onList, 'dismissed');
  await seedCard(userA, offList, 'known');

  // Test me files its ideas under a subject named after the article, in
  // whatever case the card gave it.
  const [subject] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userA}, ${ON_LIST.toLowerCase()})
    returning id`;
  rightConcept = await seedConcept(userA, subject.id, 'Pull factors');
  const wrongConcept = await seedConcept(userA, subject.id, 'Push factors');
  const untestedConcept = await seedConcept(userA, subject.id, 'Primate cities');
  await admin`
    insert into concept_state (concept_id, user_id, state, established, tested_at) values
      (${rightConcept}, ${userA}, 'recognised', 'tested', now()),
      (${wrongConcept}, ${userA}, 'shaky', 'tested', now()),
      (${untestedConcept}, ${userA}, 'known', 'declared', null)`;

  // An idea on a subject that is not a Level 3 article counts for nothing.
  const [elsewhere] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userA}, ${OFF_LIST}) returning id`;
  const offConcept = await seedConcept(userA, elsewhere.id, 'Gnome hats');
  await admin`
    insert into concept_state (concept_id, user_id, state, established, tested_at)
    values (${offConcept}, ${userA}, 'known', 'tested', now())`;
});

afterAll(async () => {
  await truncateAll();
  await cleanShared();
  await closeDb();
});

describe('learn.article_evidence', () => {
  it('counts a Got it, a save and a right tested answer, and nothing else', async () => {
    const rows = await asUser(userA, (tx) => tx<Row[]>`
      select article_id, article_title, kind, at, source_id
      from article_evidence order by kind`);

    expect(rows.map((r) => [r.kind, r.source_id])).toEqual([
      ['got_it', gotItCard],
      ['saved', savedCard],
      ['tested', rightConcept],
    ]);
    for (const row of rows) {
      expect(row.article_id).toBe(articleId);
      expect(row.article_title).toBe(ON_LIST);
      expect(row.at).not.toBeNull();
    }
  });

  it('shows nothing for a card on an article off the list', async () => {
    const rows = await asUser(userA, (tx) => tx<Row[]>`
      select article_title from article_evidence where article_title = ${OFF_LIST}`);
    expect(rows).toEqual([]);
  });

  it('shows another user none of it', async () => {
    const rows = await asUser(userB, (tx) => tx`select 1 from article_evidence`);
    expect(rows).toHaveLength(0);
  });

  it('is read with the caller’s own row security', async () => {
    const [row] = await admin<{ options: string[] | null }[]>`
      select c.reloptions as options
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'learn' and c.relname = 'article_evidence'`;
    expect(row.options).toContain('security_invoker=true');
  });
});
