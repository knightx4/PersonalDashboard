/**
 * Lessons in Learn now (LEARN-LESSONS-SPEC, build step 1; plan #978):
 * migrations-learn/0053_feed_card_lessons.sql.
 *
 * A lesson is a feed card with reason 'lesson' and no section of its own. It
 * names its track, and at most one lesson per concept is kept. The section it
 * cites sits in columns of its own, so two lessons can cite one section while
 * the section cards keep one card per idea. Deleting the track, unit or
 * concept behind a lesson leaves the card in place.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-learn';

const ARTICLE = 'Price ceiling (feed lessons)';

let userId = '';
let subjectId = '';
let unitId = '';
let itemId = '';
let segmentId = '';

async function concept(name: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into concepts (user_id, subject_id, name, claim, basis, origin)
    values (${userId}, ${subjectId}, ${name}, ${name + ' holds.'}, 'Written for a unit.', 'generated')
    returning id`;
  return row.id;
}

async function lesson(conceptId: string | null, extra: { track?: string | null; status?: string; segment?: string | null } = {}) {
  const [row] = await admin<{ id: string }[]>`
    insert into feed_cards (user_id, reason, status, subject_id, concept_id, track_name, unit_id, unit_title,
                            idea_name, summary, why, source_item_id, source_segment_id)
    values (${userId}, 'lesson', ${extra.status ?? 'ready'}, ${subjectId}, ${conceptId},
            ${extra.track === undefined ? 'Economics' : extra.track}, ${unitId}, 'Markets and prices',
            'Price ceilings cause shortages', 'Why it holds.', 'Next in your Economics track.',
            ${extra.segment ? itemId : null}, ${extra.segment ?? null})
    returning id`;
  return row.id;
}

beforeAll(async () => {
  await truncateAll();
  await admin`delete from catalogue_items where external_id = ${ARTICLE}`;
  userId = await createUser('feed-lessons@example.com');

  const [subject] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userId}, 'Economics') returning id`;
  subjectId = subject.id;
  const [unit] = await admin<{ id: string }[]>`
    insert into curriculum_units (user_id, subject_id, ordinal, title, covers, outcome)
    values (${userId}, ${subjectId}, 1, 'Markets and prices', 'Supply, demand and caps.', 'Predict a shortage.')
    returning id`;
  unitId = unit.id;

  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('wikipedia', 'Wikipedia', 'https://en.wikipedia.org', 'CC BY-SA',
            'REST API, no key, section text')
    on conflict (slug) do update set name = excluded.name
    returning id`;
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${provider.id}, ${ARTICLE}, ${ARTICLE}, 'article', 'https://example.org/price-ceiling')
    returning id`;
  itemId = item.id;
  const [segment] = await admin<{ id: string }[]>`
    insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text)
    values (${itemId}, 1, 'Rent_control', 'Rent control', 'Rent control caps rents.')
    returning id`;
  segmentId = segment.id;
});

afterAll(async () => {
  await truncateAll();
  await admin`delete from catalogue_items where external_id = ${ARTICLE}`;
  await closeDb();
});

describe('a lesson card', () => {
  it('needs no section of its own', async () => {
    const id = await lesson(await concept('Ceilings cause shortages'));
    const [row] = await admin<{ reason: string; item_id: string | null }[]>`
      select reason, item_id from feed_cards where id = ${id}`;
    expect(row).toEqual({ reason: 'lesson', item_id: null });
  });

  it('must name its track', async () => {
    const conceptId = await concept('Floors cause gluts');
    await expect(lesson(conceptId, { track: null })).rejects.toThrow(/feed_cards_target_ck/);
    await expect(lesson(conceptId, { track: ' ' })).rejects.toThrow(/feed_cards_target_ck/);
  });

  it('is kept once per concept, dropped or not', async () => {
    const conceptId = await concept('Queues ration by time');
    await lesson(conceptId, { status: 'dropped' });
    await expect(lesson(conceptId)).rejects.toThrow(/feed_cards_lesson_concept_uq/);
  });

  it('can cite a section another lesson cites', async () => {
    await lesson(await concept('Rent control shrinks supply'), { segment: segmentId });
    await lesson(await concept('Rent control keeps tenants'), { segment: segmentId });
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from feed_cards where source_segment_id = ${segmentId}`;
    expect(row.count).toBe(2);
  });

  it('leaves section cards one per idea', async () => {
    await admin`
      insert into feed_cards (user_id, reason, theme_name, item_id, segment_id)
      values (${userId}, 'interest', 'Markets', ${itemId}, ${segmentId})`;
    await expect(admin`
      insert into feed_cards (user_id, reason, theme_name, item_id, segment_id)
      values (${userId}, 'interest', 'Markets', ${itemId}, ${segmentId})`).rejects.toThrow(
      /feed_cards_segment_idea_uq/,
    );
  });

  it('still refuses a section card with no section, and an unknown reason', async () => {
    await expect(admin`
      insert into feed_cards (user_id, reason, theme_name) values (${userId}, 'interest', 'Markets')`).rejects.toThrow(
      /feed_cards_material_ck/,
    );
    await expect(admin`
      insert into feed_cards (user_id, reason, theme_name, item_id, segment_id)
      values (${userId}, 'hunch', 'Markets', ${itemId}, ${segmentId})`).rejects.toThrow(/feed_cards_reason_ck/);
  });

  it('stays when its concept and unit are deleted', async () => {
    const conceptId = await concept('Black markets form');
    const id = await lesson(conceptId);
    await admin`delete from concepts where id = ${conceptId}`;
    await admin`delete from curriculum_units where id = ${unitId}`;
    const [row] = await admin<{ concept_id: string | null; unit_id: string | null; track_name: string }[]>`
      select concept_id, unit_id, track_name from feed_cards where id = ${id}`;
    expect(row).toEqual({ concept_id: null, unit_id: null, track_name: 'Economics' });
  });
});

describe('a held track', () => {
  it('keeps the time its layout is held until', async () => {
    await admin`
      update subjects set lessons_held_until = now() + interval '1 day' where id = ${subjectId}`;
    const [row] = await admin<{ held: boolean }[]>`
      select lessons_held_until > now() as held from subjects where id = ${subjectId}`;
    expect(row.held).toBe(true);
  });
});
