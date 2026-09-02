import { describe, expect, it } from 'vitest';
import { activityEntries, groupByDay } from '@/lib/jobs/activity/load';

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
    expect(entries[0].headline).toBe('Nudge — Canonical · Engineering Manager');
    expect(entries[0].detail).toBe('Nothing back for 21 days.');
    expect(entries[1].headline).toBe('Nudge raised');
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

    expect(fromEvent.headline).toBe('interview scheduled — Canonical · Engineering Manager');
    expect(fromEvent.detail).toBe('Round 2 booked');
    expect(fromRole.headline).toBe('New role — Kalshi · Analyst');
    expect(fromRole.roleId).toBe('role-a');
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
