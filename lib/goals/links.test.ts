import { describe, expect, it } from 'vitest';
import { fakeSchemaDb } from '../../tests/stubs/fake-schema-db';
import {
  LISTED_KINDS,
  aimProgressLine,
  groupLists,
  jobWeekLine,
  linkedHref,
  listNameOf,
  parseListName,
  toLink,
  weekInstants,
  type LinkedAim,
  type LinkedRow,
  type ListedKind,
} from '@/lib/goals/links';
import { loadLinkedLists } from '@/lib/goals/links-store';

const aim = (over: Partial<LinkedAim> = {}): LinkedAim => ({
  linkId: 'l1',
  aimId: 'a1',
  name: 'Urban planning basics',
  archived: false,
  level3: null,
  preparation: 'none',
  lens: null,
  nextPiece: null,
  ...over,
});

describe('weekInstants', () => {
  it('runs Monday to Monday at midnight in the account zone', () => {
    // Thursday 24 September 2026; New York is four hours behind UTC then.
    expect(weekInstants('2026-09-24', 'America/New_York')).toEqual({
      from: '2026-09-21T04:00:00.000Z',
      to: '2026-09-28T04:00:00.000Z',
    });
  });

  it('keeps a Sunday in the week that began the Monday before', () => {
    expect(weekInstants('2026-09-27', 'UTC').from).toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('aimProgressLine', () => {
  const lens = { topics: 6, tested: 3, inferred: 2, declared: 0, total: 40 };

  it('says preparation has not run for a subject with no run', () => {
    expect(aimProgressLine(aim())).toBe('Preparation has not run');
  });

  it('reads the subject lens by kind, the preparation and the next piece', () => {
    expect(aimProgressLine(aim({ preparation: 'done', lens }))).toBe('5 of 40 levels held: 3 tested, 2 inferred');
    expect(aimProgressLine(aim({ preparation: 'done', lens, nextPiece: 'Reading a budget' }))).toBe(
      '5 of 40 levels held: 3 tested, 2 inferred. Next: Reading a budget',
    );
    expect(aimProgressLine(aim({ preparation: 'working' }))).toBe('Preparing the subject');
    expect(aimProgressLine(aim({ preparation: 'failed' }))).toBe('Preparation stopped');
    expect(aimProgressLine(aim({ preparation: 'done' }))).toBe('No topics on the lens yet');
  });

  it('gives the Level 3 list its claimed and tested articles', () => {
    expect(aimProgressLine(aim({ level3: { claimed: 40, tested: 12, total: 1000 } }))).toBe(
      '40 of 1000 articles claimed, 12 tested',
    );
  });

  it('says when the aim has left Learn or been archived there', () => {
    expect(aimProgressLine(aim({ name: null }))).toBe('No longer in Learn');
    expect(aimProgressLine(aim({ preparation: 'working', archived: true }))).toBe(
      'Preparing the subject. Archived in Learn',
    );
  });
});

describe('jobWeekLine', () => {
  it('says the week in applications and interviews', () => {
    expect(jobWeekLine({ applied: 3, interviews: 1 })).toBe(
      'This week: 3 applications sent, 1 interview',
    );
    expect(jobWeekLine({ applied: 1, interviews: 0 })).toBe(
      'This week: 1 application sent, 0 interviews',
    );
  });
});

describe('toLink', () => {
  it('reads a row and skips a kind it does not know', () => {
    expect(toLink({ id: 'l', item_id: 'g', kind: 'job_search', target_id: null })).toEqual({
      id: 'l',
      itemId: 'g',
      kind: 'job_search',
      targetId: null,
      listName: null,
    });
    expect(toLink({ id: 'l', item_id: 'g', kind: 'book', target_id: 'x' })).toBeNull();
  });

  it('reads the four listed kinds and their list name (plan #2330.1)', () => {
    for (const kind of LISTED_KINDS) {
      expect(toLink({ id: 'l', item_id: 'g', kind, target_id: 'x', list_name: 'Pantries' })).toMatchObject({
        kind,
        listName: 'Pantries',
      });
    }
  });
});

describe('list names', () => {
  it('trims a typed name and reads a blank one as the kind’s own list', () => {
    expect(parseListName('  Pantries   to  compare ')).toBe('Pantries to compare');
    expect(parseListName('   ')).toBeNull();
    expect(parseListName(null)).toBeNull();
    expect(parseListName('x'.repeat(100))).toHaveLength(80);
  });

  it('names a link’s list, falling back to the kind’s own', () => {
    expect(listNameOf({ kind: 'reading', listName: null })).toBe('Reading');
    expect(listNameOf({ kind: 'event', listName: null })).toBe('Events');
    expect(listNameOf({ kind: 'saved_item', listName: 'Pantries' })).toBe('Pantries');
  });
});

describe('groupLists', () => {
  const linked = (linkId: string, kind: ListedKind, listName: string): LinkedRow =>
    ({ linkId, targetId: `t-${linkId}`, kind, listName, gone: false, href: null }) as LinkedRow;

  it('puts rows sharing a list name in one list, in the order they were linked', () => {
    const lists = groupLists([
      linked('1', 'reading', 'Reading'),
      linked('2', 'saved_item', 'Pantries'),
      linked('3', 'reading', 'reading'),
      linked('4', 'event', 'Pantries'),
    ]);
    expect(lists.map((list) => list.name)).toEqual(['Reading', 'Pantries']);
    expect(lists[0].rows.map((row) => row.linkId)).toEqual(['1', '3']);
    expect(lists[1].kinds).toEqual(['saved_item', 'event']);
  });
});

describe('linkedHref', () => {
  it('opens each row on its own page, and an event on its week', () => {
    expect(linkedHref('reading', 'r1')).toBe('/learn/r/r1');
    expect(linkedHref('saved_item', 's1')).toBe('/shopping/saved/s1');
    expect(linkedHref('contact', 'c1')).toBe('/jobs/contacts/c1');
    expect(linkedHref('event', 'e1', { startsOn: null, startsAt: '2026-11-02T18:00:00Z' })).toBe(
      '/todo/calendar?view=week&date=2026-11-02&event=e1',
    );
  });
});

describe('loadLinkedLists', () => {
  const ME = '00000000-0000-4000-8000-0000000000aa';
  const GOAL = '44444444-4444-4444-8444-444444444444';
  const link = (id: string, kind: string, target: string, extra: Record<string, unknown> = {}) => ({
    id,
    user_id: ME,
    item_id: GOAL,
    kind,
    target_id: target,
    list_name: null,
    archived_at: null,
    created_at: `2026-10-17T00:00:0${id}Z`,
    ...extra,
  });

  it('reads each linked row live from its own workspace, and says when one has gone', async () => {
    const db = fakeSchemaDb({
      'goals.links': [
        link('1', 'reading', 'r1'),
        link('2', 'saved_item', 's1', { list_name: 'Pantries' }),
        link('3', 'event', 'gone'),
        link('4', 'contact', 'c1', { archived_at: '2026-10-17T01:00:00Z' }),
        link('5', 'aim', 'a1'),
      ],
      'learn.readings': [{ id: 'r1', user_id: ME, title: 'The Power Broker', status: 'done', finished_at: '2026-10-16T00:00:00Z' }],
      'public.saved_items': [
        { id: 's1', user_id: ME, title: 'HOMCOM pantry', price_cents: 18999, currency: 'USD', purchased_order_item_id: null },
      ],
      'todo.events': [],
      'job_search.contacts': [{ id: 'c1', user_id: ME, full_name: 'Ana' }],
    });
    const lists = await loadLinkedLists(db('public'), GOAL);
    expect(lists.map((list) => list.name)).toEqual(['Reading', 'Pantries', 'Events']);
    expect(lists[0].rows[0]).toMatchObject({
      kind: 'reading',
      title: 'The Power Broker',
      status: 'done',
      finishedAt: '2026-10-16T00:00:00Z',
      href: '/learn/r/r1',
      gone: false,
    });
    expect(lists[1].rows[0]).toMatchObject({ kind: 'saved_item', priceCents: 18999, bought: false });
    expect(lists[2].rows[0]).toMatchObject({ kind: 'event', gone: true, href: null, title: null });
  });

  it('leaves out the kinds it is not asked to read', async () => {
    const db = fakeSchemaDb({
      'goals.links': [link('1', 'reading', 'r1'), link('2', 'contact', 'c1')],
      'learn.readings': [{ id: 'r1', user_id: ME, title: 'A' }],
      'job_search.contacts': [{ id: 'c1', user_id: ME, full_name: 'Ana' }],
    });
    const lists = await loadLinkedLists(db('public'), GOAL, ['contact']);
    expect(lists.map((list) => list.name)).toEqual(['People']);
  });
});
