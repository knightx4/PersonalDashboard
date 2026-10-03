import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import type { AgendaItem } from '@/lib/todo/agenda/sources';

/**
 * Threads on the agenda (plan #1473): one where Dash spoke last and asked
 * something is on you, and your reply takes it off.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: {} }));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn() }));

const { lastQuestion, threadItems, withoutCoveredThreads } = await import('./threads');

const REF = 'job_search.roles:r1';

function turn(id: string, author: string, body: string, at: string, ref = REF) {
  return { id, ref, author, body, created_at: at };
}

describe('lastQuestion', () => {
  it.each([
    ['Should I send it?', 'Should I send it?'],
    ['I drafted it.\n\nWhich do you want, A or B? I would take A.', 'Which do you want, A or B?'],
    ['Done (is that right?)', 'Done (is that right?'],
  ])('finds the question in %j', (body, expected) => {
    expect(lastQuestion(body)).toBe(expected);
  });

  it.each([
    ['Is it worth it? Yes.\n\nI applied the change.'],
    ['The row (What does it do below 1024?), is done.'],
    ['See https://example.com/runs?per_page=1'],
    ['Who is the CBO?\n\t[profile](https://example.com)'],
    [''],
  ])('finds no question in %j', (body) => {
    expect(lastQuestion(body)).toBeNull();
  });
});

describe('threadItems', () => {
  const asked = [
    turn('t1', 'me', 'Can you look at the salary?', '2026-10-01T09:00:00.000Z'),
    turn('t2', 'claude', 'It is below the range. Do you want me to draft a reply?', '2026-10-01T10:00:00.000Z'),
  ];

  it('lists a thread whose last turn is Dash asking', () => {
    const titles = new Map([[REF, { title: 'Analyst at Acme', href: '/jobs/roles/r1', missing: false }]]);
    const [item] = threadItems(asked, titles);
    expect(item).toMatchObject({
      key: 'threads:t2',
      source: 'threads',
      ref: REF,
      title: 'Do you want me to draft a reply?',
      detail: 'Dash asked on Analyst at Acme',
      onYouSince: '2026-10-01T10:00:00.000Z',
      link: { href: '/jobs/roles/r1', label: 'Reply' },
      completable: false,
    });
    expect(parseRef(item.ref)).not.toBeNull();
  });

  it('drops it once you reply', () => {
    expect(threadItems([...asked, turn('t3', 'me', 'Yes please.', '2026-10-01T11:00:00.000Z')])).toEqual([]);
  });

  it('drops it when Dash spoke last without asking', () => {
    expect(threadItems([turn('t1', 'claude', 'Moved it to Friday.', '2026-10-01T09:00:00.000Z')])).toEqual([]);
  });

  it('drops a thread whose row is gone', () => {
    const titles = new Map([[REF, { title: 'no longer there', href: null, missing: true }]]);
    expect(threadItems(asked, titles)).toEqual([]);
  });
});

describe('withoutCoveredThreads', () => {
  const item = (source: AgendaItem['source'], ref: string): AgendaItem => ({
    key: `${source}:${ref}`,
    source,
    ref,
    title: ref,
    day: null,
    at: null,
    link: null,
    action: null,
    detail: null,
    completable: false,
  });

  it('keeps a row once, as its own source lists it', () => {
    const items = [
      item('raised', 'public.raised_items:r1'),
      item('threads', 'public.raised_items:r1'),
      item('threads', 'public.ideas:i1'),
    ];
    expect(withoutCoveredThreads(items).map((entry) => entry.key)).toEqual([
      'raised:public.raised_items:r1',
      'threads:public.ideas:i1',
    ]);
  });
});
