/**
 * The passage backfill for articles stored before passages existed (plan
 * #1133): storeMissingPassages in lib/learn/catalogue/store.ts.
 *
 * It cuts every searchable article section that has no passages from the text
 * already stored, leaves stub sections and link lists alone, and a second run
 * writes nothing and keeps the vectors the first run's passages were given.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb } from './helpers/db-learn';
import { storeMissingPassages } from '@/lib/learn/catalogue/store';
import { cutPassages } from '@/lib/learn/catalogue/passages';

const EXTERNAL = 'passage-backfill-test';

const LONG = [
  'Heat engines turn a flow of heat into work. '.repeat(12).trim(),
  'The Carnot cycle sets the upper bound on that efficiency. '.repeat(12).trim(),
].join('\n');

let longId = '';
let stubId = '';
let listId = '';

beforeAll(async () => {
  await admin`delete from catalogue_items where external_id = ${EXTERNAL}`;
  const [provider] = await admin<{ id: string }[]>`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values ('passage-backfill-test', 'Wikipedia test', 'https://en.wikipedia.org', 'CC BY-SA', 'Test')
    on conflict (slug) do update set name = excluded.name
    returning id`;
  const [item] = await admin<{ id: string }[]>`
    insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
    values (${provider.id}, ${EXTERNAL}, 'Heat engine', 'article', 'https://en.wikipedia.org/wiki/Heat_engine')
    returning id`;
  const rows = await admin<{ id: string; ordinal: number }[]>`
    insert into catalogue_segments (item_id, ordinal, section_anchor, heading, text, searchable)
    values (${item.id}, 0, 'Efficiency', 'Efficiency', ${LONG}, true),
           (${item.id}, 1, 'Stub', 'Stub', 'Too short to match.', false),
           (${item.id}, 2, 'See_also', 'See also', ${'Carnot cycle\n'.repeat(40)}, false)
    returning id, ordinal`;
  longId = rows.find((row) => row.ordinal === 0)!.id;
  stubId = rows.find((row) => row.ordinal === 1)!.id;
  listId = rows.find((row) => row.ordinal === 2)!.id;
});

afterAll(async () => {
  await admin`delete from catalogue_items where external_id = ${EXTERNAL}`;
  await admin`delete from catalogue_providers where slug = 'passage-backfill-test'`;
  await closeDb();
});

async function passagesOf(segmentId: string) {
  return admin<{ ordinal: number; text: string; embedding_model: string | null }[]>`
    select ordinal, text, embedding_model from catalogue_passages
     where segment_id = ${segmentId} order by ordinal`;
}

describe('storeMissingPassages', () => {
  it('cuts searchable sections that have no passages, from the stored text', async () => {
    const result = await storeMissingPassages(admin);
    expect(result.items).toBeGreaterThanOrEqual(1);

    const stored = await passagesOf(longId);
    expect(stored.map((row) => row.text)).toEqual(cutPassages(LONG));
    expect(stored.length).toBeGreaterThan(1);
    expect(await passagesOf(stubId)).toEqual([]);
    expect(await passagesOf(listId)).toEqual([]);
  });

  it('writes nothing on a second run and keeps the vectors already given', async () => {
    await admin`
      update catalogue_passages
         set embedding = array_fill(0.01::real, array[1024])::extensions.vector,
             embedding_model = 'voyage-test', embedded_at = now()
       where segment_id = ${longId}`;

    const again = await storeMissingPassages(admin);
    expect(again).toMatchObject({ written: 0, removed: 0 });

    const stored = await passagesOf(longId);
    expect(stored).toHaveLength(cutPassages(LONG).length);
    expect(stored.every((row) => row.embedding_model === 'voyage-test')).toBe(true);
  });
});
