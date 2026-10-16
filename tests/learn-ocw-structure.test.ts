/**
 * An MIT OpenCourseWare course in the structure store (plan #2247.3):
 * storeStructure with storeStructureMaterial, as `npm run catalogue -- --ocw
 * 15.431` writes them, over the course parsed from the pages fetched live in
 * lib/learn/providers/fixtures/structure/ocw/.
 *
 * The calendar lands as ordered units with their readings, the lecture notes
 * as items of kind page listed under the document in session order, and a
 * second pull of the same pages rewrites neither.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { admin, closeDb } from './helpers/db-learn';
import { readStructure, storeStructure } from '@/lib/learn/catalogue/structure-store';
import { readStructureMaterial, storeStructureMaterial } from '@/lib/learn/catalogue/structure-material';

vi.mock('server-only', () => ({}));
const { courseStructureFromPages } = await import('@/lib/learn/providers/ocw-structure');

const fixture = (name: string) =>
  readFileSync(new URL(`../lib/learn/providers/fixtures/structure/ocw/${name}`, import.meta.url), 'utf8');

const FINANCE = 'https://ocw.mit.edu/courses/15-431-entrepreneurial-finance-spring-2011/';
const SLUG = 'ocw-structure-test';

const parsed = courseStructureFromPages({
  courseUrl: FINANCE,
  course: fixture('15-431-course.html'),
  syllabus: fixture('15-431-syllabus.html'),
  calendar: fixture('15-431-calendar.html'),
  readings: fixture('15-431-readings.html'),
  lectureNotes: fixture('15-431-lecture-notes.html'),
})!;
// A provider of its own, so the test never touches the seeded mit-ocw row.
const document = { ...parsed.document, providerSlug: SLUG };

async function cleanUp() {
  await admin`delete from catalogue_items i using catalogue_providers p
               where p.id = i.provider_id and p.slug = ${SLUG}`;
  await admin`delete from catalogue_providers where slug = ${SLUG}`;
}

beforeAll(async () => {
  await cleanUp();
  await admin`
    insert into catalogue_providers (slug, name, home_url, licence, ingest_note)
    values (${SLUG}, 'OCW structure test', 'https://ocw.mit.edu', 'CC BY-NC-SA 4.0', 'Test')`;
});

afterAll(async () => {
  await cleanUp();
  await closeDb();
});

describe('15.431 in the structure store', () => {
  let itemId = '';

  it('stores the calendar as ordered units with their readings', async () => {
    const stored = await storeStructure(admin, document);
    expect(stored).toMatchObject({ unchanged: false, written: 23, removed: 0 });
    itemId = stored.itemId;

    const read = (await readStructure(admin, itemId))!;
    expect(read).toMatchObject({
      courseCode: '15.431',
      term: 'Spring 2011',
      licenceMode: 'show',
      institution: 'Massachusetts Institute of Technology',
      author: 'Prof. Antoinette Schoar',
    });
    expect(read.units.map((u) => u.ordinal)).toEqual([...Array(23).keys()]);
    expect(read.units[2]).toMatchObject({
      label: 'Session 3',
      heading: 'Discounted cash flow (DCF) and the venture capital method',
      topics: ['Business Valuation'],
    });
    expect(read.units[2].readings[0].title).toMatch(/^Kaplan, Steven N\., and Antoinette Schoar/);
    expect(read.units[2].readings[1]).toEqual({
      title: 'Lecture notes',
      detail: 'PDF',
      url: `${FINANCE}resources/mit15_431s11_lec01/`,
    });
  });

  it('lists the lecture notes as material under the document, in session order', async () => {
    const stored = await storeStructureMaterial(admin, {
      structureItemId: itemId,
      providerSlug: SLUG,
      material: parsed.material,
    });
    expect(stored.written).toBe(7);

    const listed = await readStructureMaterial(admin, itemId);
    expect(listed.map((m) => m.label)).toEqual([
      'Session 3',
      'Session 5',
      'Session 8',
      'Session 10',
      'Session 20',
      'Session 21',
      'Session 23',
    ]);
    expect(listed[0]).toMatchObject({
      position: 0,
      title: '15.431 lecture notes, session 3: Discounted cash flow (DCF) and the venture capital method',
      canonicalUrl: `${FINANCE}resources/mit15_431s11_lec01/`,
      licence: null,
    });
    expect(listed[4].licence).toBe('Courtesy of Michael Szeto. Used with permission.');

    const kinds = await admin<{ kind: string }[]>`
      select i.kind::text as kind from catalogue_items i where i.id = any(${stored.itemIds}::uuid[])`;
    expect(new Set(kinds.map((k) => k.kind))).toEqual(new Set(['page']));
  });

  it('a second pull of the same pages rewrites nothing and keeps one list', async () => {
    const again = await storeStructure(admin, document);
    expect(again).toMatchObject({ itemId, unchanged: true, written: 0 });
    await storeStructureMaterial(admin, { structureItemId: itemId, providerSlug: SLUG, material: parsed.material });
    expect(await readStructureMaterial(admin, itemId)).toHaveLength(7);
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from catalogue_items i
        join catalogue_providers p on p.id = i.provider_id
       where p.slug = ${SLUG}`;
    expect(count).toBe(8);
  });
});
