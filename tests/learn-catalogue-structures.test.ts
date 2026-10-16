/**
 * Structure documents in the catalogue (plan #2247.1, learn 0160):
 * storeStructure, readStructure and nearestStructureUnits in
 * lib/learn/catalogue/structure-store.ts.
 *
 * A structure item is written with its licence mode, raw text, hash and
 * ordered units and read back the same; a re-pull of the same text rewrites
 * nothing and keeps the units' vectors; a changed text clears the vector of a
 * unit whose text changed; units are embedded by the existing sweep's store
 * and found by vector through learn.nearest_structure_units, while the claim
 * search leaves them out.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb } from './helpers/db-learn';
import example from '@/lib/learn/providers/fixtures/structure/store-example.json';
import { segmentStore, vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { structureContentHash, type StructureDocumentInput } from '@/lib/learn/catalogue/structure';
import {
  nearestStructureUnits,
  readStructure,
  storeStructure,
  structureIsStored,
} from '@/lib/learn/catalogue/structure-store';

const doc = example as unknown as StructureDocumentInput;
const SLUG = doc.providerSlug;

/** A unit vector along one axis, so similarity is 1 to itself and 0 to the others. */
function axis(i: number): number[] {
  const v = new Array<number>(1024).fill(0);
  v[i] = 1;
  return v;
}

async function cleanUp() {
  await admin`delete from catalogue_items i using catalogue_providers p
               where p.id = i.provider_id and p.slug = ${SLUG}`;
  await admin`delete from catalogue_providers where slug = ${SLUG}`;
}

beforeAll(async () => {
  await cleanUp();
  await admin`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values (${SLUG}, 'Structure store test', 'https://example.edu', 'Test', 'Test')`;
});

afterAll(async () => {
  await cleanUp();
  await closeDb();
});

describe('storeStructure and readStructure', () => {
  let itemId = '';

  it('writes a structure item with its licence mode, raw text, hash and units, and reads it back', async () => {
    const stored = await storeStructure(admin, doc);
    expect(stored).toMatchObject({ unchanged: false, written: 3, removed: 0 });
    itemId = stored.itemId;

    const [item] = await admin<{ kind: string }[]>`select kind::text from catalogue_items where id = ${itemId}`;
    expect(item.kind).toBe('structure');

    const read = await readStructure(admin, itemId);
    expect(read).toMatchObject({
      providerSlug: SLUG,
      externalId: doc.externalId,
      title: doc.title,
      sourceUrl: doc.sourceUrl,
      author: 'A. Instructor',
      institution: 'Example University',
      courseCode: 'HIS 315K',
      term: 'Fall 2024',
      licenceMode: 'structure_only',
      rawText: doc.rawText,
      contentHash: structureContentHash(doc.rawText),
      textbooks: doc.textbooks,
      outcomes: doc.outcomes,
      prerequisites: [],
    });
    expect(read!.units.map((unit) => [unit.ordinal, unit.label, unit.heading, unit.embedded])).toEqual([
      [0, 'Week 1', 'Colonial societies', false],
      [1, 'Week 2', 'The imperial crisis', false],
      [2, 'Week 3', 'The French alliance and the war for independence', false],
    ]);
    expect(read!.units[2].topics).toEqual(['Treaty of Alliance 1778', 'Saratoga']);
    expect(read!.units[2].readings).toEqual(doc.units[2].readings);
    expect(await structureIsStored(admin, SLUG, doc.externalId, doc.rawText)).toBe(true);
    expect(await structureIsStored(admin, SLUG, doc.externalId, `${doc.rawText}!`)).toBe(false);
  });

  it('embeds the units through the catalogue sweep and finds a week by what it covers', async () => {
    const pending = await segmentStore(admin).unembedded(100);
    const ours = (await readStructure(admin, itemId))!.units;
    const ids = new Set(ours.map((unit) => unit.segmentId));
    const mine = pending.filter((row) => ids.has(row.id));
    expect(mine).toHaveLength(3);

    await segmentStore(admin).store(
      mine.map((row) => {
        const ordinal = ours.find((unit) => unit.segmentId === row.id)!.ordinal;
        return { ...row, vector: axis(ordinal), model: 'voyage-test' };
      }),
    );

    const near = await nearestStructureUnits(admin, axis(2), { minSimilarity: 0.9 });
    expect(near.map((unit) => [unit.itemId, unit.label, unit.licenceMode, unit.courseCode])).toEqual([
      [itemId, 'Week 3', 'structure_only', 'HIS 315K'],
    ]);

    // The claim search never offers a syllabus week as material.
    const claim = await admin<{ item_id: string }[]>`
      select item_id from nearest_catalogue_segments(${vectorLiteral(axis(2))}, 40, 0.0)`;
    expect(claim.filter((row) => row.item_id === itemId)).toEqual([]);
  });

  it('rewrites nothing when the raw text is unchanged, keeping the vectors', async () => {
    const again = await storeStructure(admin, doc);
    expect(again).toEqual({ itemId, unchanged: true, written: 0, removed: 0 });
    const read = await readStructure(admin, itemId);
    expect(read!.units.every((unit) => unit.embedded)).toBe(true);
  });

  it('on a changed text rewrites the units, clears a changed unit\'s vector and drops the units past the end', async () => {
    const changed: StructureDocumentInput = {
      ...doc,
      rawText: `${doc.rawText}Revised.\n`,
      licenceMode: 'show',
      units: [doc.units[0], { ...doc.units[1], topics: ['Stamp Act', 'Boston Massacre'] }],
    };
    const stored = await storeStructure(admin, changed);
    expect(stored).toMatchObject({ itemId, unchanged: false, written: 2, removed: 1 });

    const read = await readStructure(admin, itemId);
    expect(read!.licenceMode).toBe('show');
    expect(read!.contentHash).toBe(structureContentHash(changed.rawText));
    expect(read!.units.map((unit) => [unit.ordinal, unit.embedded])).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(read!.units[1].topics).toEqual(['Stamp Act', 'Boston Massacre']);
  });
});

describe('the catalogue_structures table', () => {
  it('refuses a structure row on an item that is not of kind structure', async () => {
    const [provider] = await admin<{ id: string }[]>`select id from catalogue_providers where slug = ${SLUG}`;
    const [article] = await admin<{ id: string }[]>`
      insert into catalogue_items (provider_id, external_id, title, kind, canonical_url)
      values (${provider.id}, 'not-a-structure', 'An article', 'article', 'https://example.edu/a')
      returning id`;
    await expect(
      admin`insert into catalogue_structures (item_id, licence_mode, source_url, raw_text, content_hash)
            values (${article.id}, 'show', 'https://example.edu/a', 'text', ${structureContentHash('text')})`,
    ).rejects.toThrow(/kind structure/);
  });

  it('refuses a licence mode outside the three', async () => {
    const stored = await storeStructure(admin, { ...doc, externalId: 'licence-check' });
    await expect(
      admin`update catalogue_structures set licence_mode = 'open' where item_id = ${stored.itemId}`,
    ).rejects.toThrow(/licence_mode/);
  });
});
