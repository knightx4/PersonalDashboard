import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LinkedInArchive } from '@/lib/linkedin/archive';
import { applyPlan, planImport, ref } from './engine';
import { importLinkedIn } from './linkedin';
import { memoryStore } from './memory-store';
import type { ImportMapper } from './types';

// The import engine against a store held in memory (plan #2432.2): a first
// run, a rerun of the same export, a newer export, and a row the person
// edited between runs.

interface Person {
  slug: string;
  name: string;
  company: string | null;
  connectedOn: string;
}
interface Note {
  id: string;
  slug: string;
  body: string;
}
interface Export {
  people: Person[];
  notes?: Note[];
}

const PEOPLE = 'core.people_test';
const NOTES = 'core.notes_test';

const people: ImportMapper<Export> = {
  kind: 'people',
  table: PEOPLE,
  columns: { name: 'text', company: 'text', connected_at: 'timestamptz', meta: 'jsonb' },
  records: (e) =>
    e.people.map((p) =>
      p.slug
        ? { key: p.slug, values: { name: p.name, company: p.company, connected_at: p.connectedOn, meta: { slug: p.slug, via: 'linkedin' } } }
        : { key: `nameless:${p.name}`, skip: 'No profile link.' },
    ),
};

const notes: ImportMapper<Export> = {
  kind: 'notes',
  table: NOTES,
  columns: { person_id: 'uuid', body: 'text' },
  records: (e) => (e.notes ?? []).map((n) => ({ key: n.id, values: { person_id: ref('people', n.slug), body: n.body } })),
};

const first: Export = {
  people: [
    { slug: 'ada', name: 'Ada Lovelace', company: 'Analytical', connectedOn: '2025-07-01T10:00:00.000Z' },
    { slug: 'alan', name: 'Alan Turing', company: null, connectedOn: '2024-01-15T00:00:00.000Z' },
    { slug: '', name: 'No Link', company: null, connectedOn: '2024-01-15T00:00:00.000Z' },
  ],
  notes: [{ id: 'n1', slug: 'ada', body: 'Met at the meetup' }],
};

async function run(store: ReturnType<typeof memoryStore>, input: Export, mappers = [people, notes]) {
  const plan = await planImport(store, 'linkedin', mappers, input);
  await applyPlan(store, plan, { archiveDate: '2026-10-19' });
  return plan;
}

describe('the import engine', () => {
  it('adds every record on the first run, with its key, and skips what the mapper skips', async () => {
    const store = memoryStore();
    const plan = await run(store, first);
    expect(plan.kinds[0].counts).toEqual({ added: 2, updated: 0, unchanged: 0, kept: 0, skipped: 1 });
    expect(plan.kinds[1].counts).toMatchObject({ added: 1 });
    expect(store.rows(PEOPLE).map((r) => r.name)).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(store.keys.size).toBe(3);

    const ada = store.rows(PEOPLE).find((r) => r.name === 'Ada Lovelace')!;
    expect(store.rows(NOTES)[0].person_id).toBe(ada.id);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ status: 'applied', meta: { archiveDate: '2026-10-19' } });
    expect(store.runs[0].counts.people.added).toBe(2);
  });

  it('reports everything unchanged on a rerun of the same export, and writes nothing', async () => {
    const store = memoryStore();
    await run(store, first);
    const again = await run(store, first);
    expect(again.writes).toEqual([]);
    expect(again.totals).toEqual({ added: 0, updated: 0, unchanged: 3, kept: 0, skipped: 1 });
    expect(store.rows(PEOPLE)).toHaveLength(2);
  });

  it('counts a value the database spells differently as unchanged', async () => {
    const store = memoryStore();
    await run(store, first);
    // How Postgres hands back a timestamptz and a jsonb.
    const ada = store.rows(PEOPLE).find((r) => r.name === 'Ada Lovelace')!;
    store.tables.get(PEOPLE)!.set(String(ada.id), {
      ...ada,
      connected_at: '2025-07-01T10:00:00+00:00',
      meta: { via: 'linkedin', slug: 'ada' },
    });
    const again = await planImport(store, 'linkedin', [people], first);
    expect(again.kinds[0].counts.unchanged).toBe(2);
  });

  it('adds only the new records from a newer export, and updates one LinkedIn changed', async () => {
    const store = memoryStore();
    await run(store, first);
    const newer: Export = {
      people: [
        { ...first.people[0], company: 'Babbage & Co' },
        first.people[1],
        { slug: 'grace', name: 'Grace Hopper', company: 'Navy', connectedOn: '2026-10-01T00:00:00.000Z' },
      ],
      notes: first.notes,
    };
    const plan = await run(store, newer);
    expect(plan.kinds[0].counts).toEqual({ added: 1, updated: 1, unchanged: 1, kept: 0, skipped: 0 });
    expect(plan.kinds[0].records.find((r) => r.key === 'ada')).toMatchObject({ outcome: 'updated', changed: ['company'] });
    expect(store.rows(PEOPLE).map((r) => r.company)).toEqual(['Babbage & Co', null, 'Navy']);
  });

  it('keeps a field the person edited between runs and counts it as kept, on the same and a newer export', async () => {
    const store = memoryStore();
    await run(store, first);
    const alan = store.rows(PEOPLE).find((r) => r.name === 'Alan Turing')!;
    store.edit(PEOPLE, String(alan.id), { company: 'Bletchley Park' });

    const same = await run(store, first);
    expect(same.kinds[0].counts).toMatchObject({ kept: 1, unchanged: 1 });
    expect(same.kinds[0].records.find((r) => r.key === 'alan')).toMatchObject({ outcome: 'kept', rowId: alan.id });

    const newer = await run(store, { people: [{ ...first.people[1], name: 'Alan M. Turing' }] });
    expect(newer.kinds[0].counts.kept).toBe(1);
    expect(store.tables.get(PEOPLE)!.get(String(alan.id))).toMatchObject({ name: 'Alan Turing', company: 'Bletchley Park' });
    expect(store.runs.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
  });

  it('leaves a row the person removed removed, and skips what belonged to it', async () => {
    const store = memoryStore();
    await run(store, first);
    const ada = store.rows(PEOPLE).find((r) => r.name === 'Ada Lovelace')!;
    store.remove(PEOPLE, String(ada.id));
    const plan = await run(store, { ...first, notes: [...first.notes!, { id: 'n2', slug: 'ada', body: 'Coffee' }] });
    expect(plan.kinds[0].records.find((r) => r.key === 'ada')).toMatchObject({ outcome: 'kept' });
    expect(plan.kinds[1].records.find((r) => r.key === 'n2')).toMatchObject({ outcome: 'skipped' });
    expect(store.rows(PEOPLE)).toHaveLength(1);
  });

  it('joins a row the person already has, filling only its empty columns', async () => {
    const mine = { id: '00000000-0000-4000-8000-000000000001', name: 'Ada L.', company: null, connected_at: null, meta: null };
    const store = memoryStore({ [PEOPLE]: [mine] });
    const joining: ImportMapper<Export> = {
      ...people,
      match: async (pending) => new Map(pending.filter((p) => p.key === 'ada').map((p) => [p.key, mine.id])),
    };
    const plan = await run(store, first, [joining]);
    expect(plan.kinds[0].records.find((r) => r.key === 'ada')).toMatchObject({ outcome: 'updated', rowId: mine.id });
    expect(store.tables.get(PEOPLE)!.get(mine.id)).toMatchObject({ name: 'Ada L.', company: 'Analytical' });

    // Later exports leave the joined row alone, since the person wrote it.
    const newer = await run(store, { people: [{ ...first.people[0], name: 'Ada King' }] }, [joining]);
    expect(newer.kinds[0].records[0]).toMatchObject({ outcome: 'kept' });
  });

  it('writes nothing on a dry run', async () => {
    const store = memoryStore();
    const plan = await planImport(store, 'linkedin', [people, notes], first);
    expect(plan.totals.added).toBe(3);
    expect(store.rows(PEOPLE)).toEqual([]);
    expect(store.runs).toEqual([]);
  });

  it('marks the run failed and keeps the batches already written when a write fails', async () => {
    const store = memoryStore();
    const plan = await planImport(store, 'linkedin', [people], first);
    plan.writes.push({ ...plan.writes[0] });
    await expect(applyPlan(store, plan)).rejects.toThrow(/duplicate/);
    expect(store.runs[0].status).toBe('failed');
    expect(store.rows(PEOPLE)).toEqual([]);
  });
});

describe('the LinkedIn pipeline', () => {
  const zip = new Uint8Array(readFileSync(join(__dirname, '../linkedin/archive/fixtures/export.zip')));
  const connections: ImportMapper<LinkedInArchive> = {
    kind: 'connections',
    table: PEOPLE,
    columns: { name: 'text', company: 'text' },
    records: (a) =>
      a.connections.map((c) => ({ key: c.key, values: { name: [c.firstName, c.lastName].filter(Boolean).join(' '), company: c.company } })),
  };

  it('reads the zip, writes rows the first time and reports them unchanged the second', async () => {
    const store = memoryStore();
    const dry = await importLinkedIn(store, zip, { dryRun: true, mappers: [connections] });
    const count = dry.archive.connections.length;
    expect(count).toBeGreaterThan(0);
    expect(dry.runId).toBeNull();
    expect(store.rows(PEOPLE)).toEqual([]);

    const once = await importLinkedIn(store, zip, { dryRun: false, mappers: [connections] });
    expect(once.plan.totals.added).toBe(count);
    expect(store.rows(PEOPLE)).toHaveLength(count);

    const twice = await importLinkedIn(store, zip, { dryRun: false, mappers: [connections] });
    expect(twice.plan.totals).toMatchObject({ added: 0, unchanged: count });
  });
});
