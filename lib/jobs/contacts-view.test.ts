import { describe, expect, it } from 'vitest';
import {
  clearFiltersHref,
  contactColumnFilters,
  contactsHref,
  filterContacts,
  focusSections,
  parseContacts,
  reachedOut,
  type ContactListRow,
} from './contacts-view';

function person(overrides: Partial<ContactListRow>): ContactListRow {
  return {
    id: overrides.fullName ?? 'x',
    fullName: 'Ada',
    title: null,
    relationship: 'cold',
    status: 'to_contact',
    companyName: null,
    companySlug: null,
    companyPriority: null,
    lastTouchAt: null,
    pendingReplies: 0,
    hasOutbound: false,
    potentialLead: false,
    foundByDash: false,
    ...overrides,
  };
}

const now = new Date('2026-09-12T12:00:00.000Z');

const rows = [
  person({ fullName: 'Ada', potentialLead: true, companyPriority: 'backup' }),
  person({ fullName: 'Ben', potentialLead: true, companyPriority: 'target' }),
  person({ fullName: 'Cy', potentialLead: true, status: 'responded', hasOutbound: true }),
  person({
    fullName: 'Di',
    potentialLead: true,
    status: 'contacted',
    hasOutbound: true,
    pendingReplies: 1,
    lastTouchAt: '2026-09-10T00:00:00.000Z',
  }),
  person({
    fullName: 'Ed',
    potentialLead: true,
    status: 'contacted',
    hasOutbound: true,
    pendingReplies: 1,
    lastTouchAt: '2026-08-20T00:00:00.000Z',
  }),
  person({ fullName: 'Flo', potentialLead: true, status: 'met', hasOutbound: true }),
  person({ fullName: 'Gus', relationship: 'recruiter', companySlug: 'acme', companyName: 'Acme' }),
  person({ fullName: 'Hal', status: 'contacted', foundByDash: true }),
];

const names = (list: readonly ContactListRow[]) => list.map((row) => row.fullName);

describe('reachedOut', () => {
  it('counts a send on record or a status past To contact', () => {
    expect(reachedOut(person({}))).toBe(false);
    expect(reachedOut(person({ hasOutbound: true }))).toBe(true);
    expect(reachedOut(person({ status: 'contacted' }))).toBe(true);
  });
});

describe('focusSections', () => {
  const sections = focusSections(rows, now);

  it('puts leads to write to first, someone who replied ahead, then by company priority', () => {
    expect(names(sections.toReach)).toEqual(['Cy', 'Ben', 'Ada']);
  });

  it('splits the leads waiting on a reply at a week', () => {
    expect(names(sections.waiting)).toEqual(['Di']);
    expect(names(sections.quiet)).toEqual(['Ed']);
  });

  it('leaves everyone else, leads first', () => {
    expect(names(sections.rest)).toEqual(['Flo', 'Gus', 'Hal']);
  });
});

describe('filterContacts', () => {
  const shown = (params: Parameters<typeof parseContacts>[0]) =>
    names(filterContacts(rows, parseContacts(params)));

  it('narrows by whether you have reached out', () => {
    expect(shown({ reached: 'no' })).toEqual(['Ada', 'Ben', 'Gus']);
    expect(shown({ reached: 'yes' })).toEqual(['Cy', 'Di', 'Ed', 'Flo', 'Hal']);
  });

  it('narrows by each column', () => {
    expect(shown({ show: 'dash' })).toEqual(['Hal']);
    expect(shown({ company: 'acme' })).toEqual(['Gus']);
    expect(shown({ company: 'none' })).toHaveLength(7);
    expect(shown({ relationship: 'recruiter' })).toEqual(['Gus']);
    expect(shown({ status: 'met' })).toEqual(['Flo']);
    expect(shown({ waiting: '1' })).toEqual(['Di', 'Ed']);
  });
});

describe('addresses', () => {
  it('opens Focused by default and drops the add form on any other link', () => {
    expect(parseContacts({}).view).toBe('focus');
    expect(contactsHref({ add: '1', view: 'table' }, { status: 'met' })).toBe(
      '/jobs/contacts?view=table&status=met',
    );
  });

  it('clears every filter and keeps the view', () => {
    expect(clearFiltersHref({ view: 'table', reached: 'no', q: 'ada' })).toBe(
      '/jobs/contacts?view=table',
    );
  });

  it('offers the reached-out filter from the Status column', () => {
    const filters = contactColumnFilters({}, parseContacts({}), rows);
    const labels = filters.status.choices.map((choice) => choice.label);
    expect(labels).toContain('Reached out · 5');
    expect(labels).toContain('Not reached out · 3');
    const notYet = filters.status.choices.find((choice) => choice.id === 'reached-no');
    expect(notYet?.href).toBe('/jobs/contacts?reached=no');
  });
});
