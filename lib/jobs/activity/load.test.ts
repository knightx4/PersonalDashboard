import { describe, expect, it } from 'vitest';
import { FORWARD_KINDS, activityEntries, groupByDay } from '@/lib/jobs/activity/load';
import { APPLICATION_EVENT_KINDS } from '@/lib/jobs/pipeline';

const role = (id: string, title: string, company: string) => ({
  id,
  title,
  companies: { name: company },
});

const newRole = (id: string, created_at: string) => ({
  id,
  created_at,
  roles: role(`role-${id}`, 'Analyst', 'Kalshi'),
});

const event = (over: {
  id: string;
  created_at: string;
  kind?: string;
  source?: string;
  summary?: string | null;
}) => ({
  id: over.id,
  kind: over.kind ?? 'rejection',
  source: over.source ?? 'email',
  summary: over.summary ?? null,
  created_at: over.created_at,
  applications: { roles: role('r9', 'Engineering Manager', 'Canonical') },
});

describe('the activity feed', () => {
  it('merges new roles and events into one list, newest first', () => {
    const entries = activityEntries({
      newRoles: [newRole('a', '2026-09-02T09:00:00Z')],
      events: [
        event({ id: 'e1', created_at: '2026-09-02T11:00:00Z' }),
        event({ id: 'e2', created_at: '2026-09-01T08:00:00Z' }),
      ],
    });

    expect(entries.map((e) => e.id)).toEqual(['event-e1', 'role-a', 'event-e2']);
  });

  it('names the source a person would recognise', () => {
    const entries = activityEntries({
      newRoles: [],
      events: [
        event({ id: 'mail', created_at: '2026-09-02T11:00:00Z', source: 'email' }),
        event({ id: 'derived', created_at: '2026-09-02T10:00:00Z', source: 'system' }),
        event({ id: 'mine', created_at: '2026-09-02T09:00:00Z', source: 'manual' }),
      ],
    });

    expect(entries.map((e) => e.source)).toEqual(['email', 'auto', 'you']);
  });

  it('tells the sweep apart from the ingestion, both of which write "system"', () => {
    // Only the nightly sweep withdraws anything; the ingestion writes the
    // "submitted" a rejection proves must have happened.
    const entries = activityEntries({
      newRoles: [],
      events: [
        event({
          id: 'cold',
          created_at: '2026-09-02T11:00:00Z',
          source: 'system',
          kind: 'withdrawal',
        }),
        event({
          id: 'inferred',
          created_at: '2026-09-02T10:00:00Z',
          source: 'system',
          kind: 'submitted',
        }),
      ],
    });

    expect(entries.map((e) => e.source)).toEqual(['sweep', 'auto']);
  });

  it('folds the nightly nudges in as the sweep', () => {
    const entries = activityEntries({
      newRoles: [],
      events: [],
      reminders: [
        {
          id: 'n1',
          body: 'Nothing back for 21 days.',
          created_at: '2026-09-02T04:00:00Z',
          applications: { roles: role('r9', 'Engineering Manager', 'Canonical') },
        },
        { id: 'n2', body: 'Write up last night.', created_at: '2026-09-01T04:00:00Z', applications: null },
      ],
    });

    expect(entries.map((e) => e.source)).toEqual(['sweep', 'sweep']);
    expect(entries[0].label).toBe('Nudge');
    expect(entries[0].subject).toBe('Canonical · Engineering Manager');
    expect(entries[0].detail).toBe('Nothing back for 21 days.');
    expect(entries[1].label).toBe('Nudge');
    expect(entries[1].subject).toBeNull();
    expect(entries[1].roleId).toBeNull();
  });

  it('reads an event kind and a new role as a sentence', () => {
    const [fromEvent, fromRole] = activityEntries({
      newRoles: [newRole('a', '2026-09-02T09:00:00Z')],
      events: [
        event({
          id: 'e1',
          created_at: '2026-09-02T11:00:00Z',
          kind: 'interview_scheduled',
          summary: 'Round 2 booked',
        }),
      ],
    });

    expect(fromEvent.label).toBe('interview scheduled');
    expect(fromEvent.subject).toBe('Canonical · Engineering Manager');
    expect(fromEvent.detail).toBe('Round 2 booked');
    expect(fromRole.label).toBe('New role');
    expect(fromRole.subject).toBe('Kalshi · Analyst');
    expect(fromRole.roleId).toBe('role-a');
  });

  it('colours a rejection red, a step forward green, and the rest quietly', () => {
    const entries = activityEntries({
      newRoles: [newRole('a', '2026-09-02T05:00:00Z')],
      events: [
        event({ id: 'r', created_at: '2026-09-02T11:00:00Z', kind: 'rejection' }),
        event({ id: 'i', created_at: '2026-09-02T10:00:00Z', kind: 'interview_scheduled' }),
        event({ id: 'o', created_at: '2026-09-02T09:00:00Z', kind: 'offer' }),
        event({ id: 's', created_at: '2026-09-02T08:00:00Z', kind: 'submitted' }),
        event({ id: 'n', created_at: '2026-09-02T07:00:00Z', kind: 'note' }),
        // Closing a cold lead is a decision, not a rejection.
        event({ id: 'w', created_at: '2026-09-02T06:00:00Z', kind: 'withdrawal' }),
      ],
      reminders: [
        {
          id: 'n1',
          body: 'Nothing back for 21 days.',
          created_at: '2026-09-02T04:00:00Z',
          applications: { roles: role('r9', 'Engineering Manager', 'Canonical') },
        },
      ],
    });

    expect(entries.map((e) => e.tone)).toEqual([
      'bad',
      'good',
      'good',
      'info',
      'muted',
      'muted',
      'info',
      'muted',
    ]);
  });

  it('does not colour a kind it has never heard of', () => {
    const [entry] = activityEntries({
      newRoles: [],
      events: [event({ id: 'x', created_at: '2026-09-02T11:00:00Z', kind: 'invented_later' })],
    });

    expect(entry.tone).toBe('muted');
    expect(entry.label).toBe('invented later');
  });

  it('stops at the limit rather than becoming a second pipeline page', () => {
    const events = Array.from({ length: 60 }, (_, i) =>
      event({ id: `e${i}`, created_at: `2026-09-02T${String(i % 24).padStart(2, '0')}:00:00Z` }),
    );
    expect(activityEntries({ newRoles: [], events, limit: 5 })).toHaveLength(5);
  });
});

describe('grouping the feed by day', () => {
  it('keeps day order and puts every entry under its own day', () => {
    const entries = activityEntries({
      newRoles: [],
      events: [
        event({ id: 'a', created_at: '2026-09-02T11:00:00Z' }),
        event({ id: 'b', created_at: '2026-09-02T09:00:00Z' }),
        event({ id: 'c', created_at: '2026-08-31T09:00:00Z' }),
      ],
    });

    const days = groupByDay(entries);
    expect(days.map((d) => d.day)).toEqual(['2026-09-02', '2026-08-31']);
    expect(days[0].entries).toHaveLength(2);
    expect(days[1].entries).toHaveLength(1);
  });

  it('has nothing to group when nothing happened', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('the "moved forward" headline', () => {
  it('counts exactly the kinds the feed shows as a step forward', () => {
    const green = APPLICATION_EVENT_KINDS.filter(
      (kind) =>
        activityEntries({
          newRoles: [],
          events: [event({ id: kind, created_at: '2026-09-02T09:00:00Z', kind })],
        })[0].tone === 'good',
    );

    expect([...FORWARD_KINDS].sort()).toEqual([...green].sort());
  });

  it('leaves out the two that only look like progress', () => {
    expect(FORWARD_KINDS).not.toContain('submitted');
    expect(FORWARD_KINDS).not.toContain('confirmation');
  });
});
