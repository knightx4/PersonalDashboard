import { describe, expect, it } from 'vitest';
import type { AgendaEntry, AgendaPile } from '@/lib/todo/agenda/merge';
import type { Task } from '@/lib/todo/tasks/model';
import {
  filterPiles,
  matchesTagFilter,
  parseTagFilter,
  sameTagFilter,
  tagFilterChoices,
  tagFilterQuery,
} from './tag-filter';

function task(id: string, tags: string[] = []): Task {
  return {
    id,
    title: id,
    body: null,
    status: 'open',
    dueOn: null,
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    position: null,
    parentId: null,
    tags,
  };
}

function entry(t: Task, children: Task[] = []): AgendaEntry {
  return { kind: 'task', key: t.id, task: t, children, openChildren: 0, totalChildren: children.length };
}

const borrowed: AgendaEntry = {
  kind: 'item',
  key: 'jobs:r1',
  item: {} as AgendaEntry['item'],
  children: [],
  openChildren: 0,
  totalChildren: 0,
};

const piles: AgendaPile[] = [
  {
    bucket: 'today',
    entries: [entry(task('a', ['now']), [task('a1')]), entry(task('b')), borrowed],
    context: [{ key: 'c', ref: 'todo.events:1', day: '2026-10-18', at: null, label: 'Dentist', detail: null, link: null }],
  },
  { bucket: 'later', entries: [entry(task('c', ['eventually']))], context: [] },
];

describe('parseTagFilter', () => {
  it('reads a tag, normalised as a tag is', () => {
    expect(parseTagFilter({ tag: ' Now ' })).toEqual({ kind: 'tag', tag: 'now' });
  });
  it('reads untagged, and lets a tag win over it', () => {
    expect(parseTagFilter({ untagged: '1' })).toEqual({ kind: 'untagged' });
    expect(parseTagFilter({ untagged: '' })).toEqual({ kind: 'untagged' });
    expect(parseTagFilter({ tag: 'home', untagged: '1' })).toEqual({ kind: 'tag', tag: 'home' });
  });
  it('is no filter when the address names none', () => {
    expect(parseTagFilter({})).toBeNull();
    expect(parseTagFilter({ tag: '  ' })).toBeNull();
    expect(parseTagFilter({ untagged: '0' })).toBeNull();
  });
  it('round-trips through the query it writes', () => {
    for (const filter of [null, { kind: 'tag', tag: 'untagged' }, { kind: 'untagged' }] as const) {
      expect(parseTagFilter(tagFilterQuery(filter))).toEqual(filter);
    }
  });
});

describe('matchesTagFilter and sameTagFilter', () => {
  it('keeps a tag, the untagged, or everything', () => {
    expect(matchesTagFilter(task('x', ['now']), { kind: 'tag', tag: 'now' })).toBe(true);
    expect(matchesTagFilter(task('x', ['home']), { kind: 'tag', tag: 'now' })).toBe(false);
    expect(matchesTagFilter(task('x'), { kind: 'untagged' })).toBe(true);
    expect(matchesTagFilter(task('x', ['now']), { kind: 'untagged' })).toBe(false);
    expect(matchesTagFilter(task('x', ['now']), null)).toBe(true);
  });
  it('tells the chips apart', () => {
    expect(sameTagFilter(null, null)).toBe(true);
    expect(sameTagFilter(null, { kind: 'untagged' })).toBe(false);
    expect(sameTagFilter({ kind: 'tag', tag: 'now' }, { kind: 'tag', tag: 'now' })).toBe(true);
    expect(sameTagFilter({ kind: 'tag', tag: 'now' }, { kind: 'untagged' })).toBe(false);
  });
});

describe('tagFilterChoices', () => {
  it('leads with Now and Eventually and keeps the chosen tag on the row', () => {
    expect(tagFilterChoices(['home', 'now'], null)).toEqual(['now', 'eventually', 'home']);
    expect(tagFilterChoices(['home'], { kind: 'tag', tag: 'gone' })).toEqual(['now', 'eventually', 'home', 'gone']);
  });
});

describe('filterPiles', () => {
  it('leaves the agenda alone with no filter', () => {
    expect(filterPiles(piles, null)).toBe(piles);
  });
  it('keeps the Now todos in their own piles, with their items, and nothing borrowed', () => {
    const now = filterPiles(piles, { kind: 'tag', tag: 'now' });
    expect(now.map((p) => p.bucket)).toEqual(['today']);
    expect(now[0].entries.map((e) => e.key)).toEqual(['a']);
    expect(now[0].entries[0].children.map((t) => t.id)).toEqual(['a1']);
    expect(now[0].context).toEqual([]);
  });
  it('shows the rest under untagged', () => {
    const rest = filterPiles(piles, { kind: 'untagged' });
    expect(rest.flatMap((p) => p.entries.map((e) => e.key))).toEqual(['b']);
  });
  it('leaves no pile when nothing carries the tag', () => {
    expect(filterPiles(piles, { kind: 'tag', tag: 'errands' })).toEqual([]);
  });
});
