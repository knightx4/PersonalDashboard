import { describe, expect, it } from 'vitest';
import { RUN_QUIET_MS } from '@/lib/goals/shaping';
import {
  GOAL_RUNS_SHOWN,
  goalRunRows,
  runDuration,
  runMeta,
  runOutcome,
  toRunListings,
  type RunRowWithItem,
} from '@/lib/goals/runs';

function row(overrides: Partial<RunRowWithItem>): RunRowWithItem {
  return {
    id: 'r1',
    job: 'goal',
    status: 'done',
    created_at: '2026-09-20T10:00:00Z',
    ended_at: '2026-09-20T10:12:00Z',
    summary: 'Mapped the goal.',
    error: null,
    item: { id: 'g1', title: 'Run a marathon', level: 'goal' },
    ...overrides,
  };
}

describe('toRunListings', () => {
  it('keeps every run, failed ones with their reason, newest first', () => {
    const listings = toRunListings([
      row({ id: 'old' }),
      row({
        id: 'failed',
        status: 'failed',
        created_at: '2026-09-22T08:00:00Z',
        ended_at: '2026-09-22T08:00:01Z',
        summary: null,
        error: 'Routine token rejected',
      }),
      row({ id: 'daily', job: 'daily', item: null, created_at: '2026-09-21T07:00:00Z' }),
    ]);
    expect(listings.map((r) => r.id)).toEqual(['failed', 'daily', 'old']);
    expect(listings[0]).toMatchObject({ status: 'failed', error: 'Routine token rejected' });
    expect(listings[1]).toMatchObject({ job: 'daily', item: null });
  });

  it('keeps the area an area run was on', () => {
    const [listing] = toRunListings([
      row({ job: 'area', item: null, area: { id: 'a1', name: 'The city' } }),
    ]);
    expect(listing).toMatchObject({ job: 'area', item: null, area: { id: 'a1', name: 'The city' } });
    expect(toRunListings([row({})])[0].area).toBeNull();
  });

  it('reads anything that is not a goal as a step', () => {
    const [listing] = toRunListings([row({ item: { id: 's1', title: 'Buy shoes', level: 'step' } })]);
    expect(listing.item).toEqual({ id: 's1', title: 'Buy shoes', level: 'step' });
  });
});

describe('runOutcome', () => {
  const created = '2026-09-20T10:00:00Z';
  const start = Date.parse(created);

  it('says a started run is running inside the quiet window and silent past it', () => {
    expect(runOutcome({ status: 'started', createdAt: created }, start + 1000)).toBe('running');
    expect(runOutcome({ status: 'started', createdAt: created }, start + RUN_QUIET_MS + 1)).toBe('silent');
  });

  it('counts the quiet window from the last report', () => {
    const seen = new Date(start + 2 * 60 * 60 * 1000).toISOString();
    const later = Date.parse(seen) + 10 * 60 * 1000;
    expect(runOutcome({ status: 'started', createdAt: created, lastSeenAt: seen }, later)).toBe('running');
    expect(runOutcome({ status: 'started', createdAt: created, lastSeenAt: seen }, later + RUN_QUIET_MS)).toBe(
      'silent',
    );
  });

  it('passes done and failed through', () => {
    expect(runOutcome({ status: 'done', createdAt: created }, start)).toBe('done');
    expect(runOutcome({ status: 'failed', createdAt: created }, start)).toBe('failed');
  });
});

describe('runDuration', () => {
  const createdAt = '2026-09-20T10:00:00Z';

  it('is null until the run ends', () => {
    expect(runDuration({ createdAt, endedAt: null })).toBeNull();
  });

  it('reads seconds, minutes, then hours and minutes', () => {
    expect(runDuration({ createdAt, endedAt: '2026-09-20T10:00:42Z' })).toBe('42s');
    expect(runDuration({ createdAt, endedAt: '2026-09-20T10:12:00Z' })).toBe('12 min');
    expect(runDuration({ createdAt, endedAt: '2026-09-20T11:05:00Z' })).toBe('1 h 5 min');
    expect(runDuration({ createdAt, endedAt: '2026-09-20T12:00:00Z' })).toBe('2 h');
  });
});

describe('runMeta', () => {
  it('says where a running run has got to (plan #1002)', () => {
    const [running] = toRunListings([
      row({
        status: 'started',
        ended_at: null,
        summary: null,
        last_seen_at: '2026-09-20T10:17:00Z',
        now_on: 'Find three running clubs',
      }),
    ]);
    const { outcome, meta } = runMeta(running, Date.parse('2026-09-20T10:20:00Z'), 'UTC');
    expect(outcome).toBe('running');
    expect(meta.startsWith('Still running · on Find three running clubs, 3 minutes ago · ')).toBe(true);
  });
});

describe('goalRunRows', () => {
  const now = Date.parse('2026-09-25T09:00:00Z');

  it('lists a goal with three past runs as three rows with their summaries, newest first', () => {
    const rows = goalRunRows(
      toRunListings([
        row({ id: 'first', created_at: '2026-09-01T08:00:00Z', ended_at: '2026-09-01T08:20:00Z', summary: 'Mapped it.' }),
        row({ id: 'third', job: 'reshape', created_at: '2026-09-24T07:40:00Z', ended_at: '2026-09-24T07:52:00Z', summary: 'Asked which card.' }),
        row({ id: 'second', created_at: '2026-09-10T08:00:00Z', ended_at: '2026-09-10T08:05:00Z', summary: 'Added two steps.' }),
      ]),
      now,
      'UTC',
    );
    expect(rows.map((r) => [r.id, r.label, r.text])).toEqual([
      ['third', 'After your answers', 'Asked which card.'],
      ['second', 'Work on this', 'Added two steps.'],
      ['first', 'Work on this', 'Mapped it.'],
    ]);
    expect(rows[0].meta).toContain('Finished');
    expect(rows[0].meta).toContain('took 12 min');
  });

  it('shows a failed run with its error, and keeps only the latest ten', () => {
    const [failed] = goalRunRows(
      toRunListings([row({ status: 'failed', summary: null, error: 'Token rejected' })]),
      now,
      'UTC',
    );
    expect(failed).toMatchObject({ failed: true, text: 'Token rejected' });

    const many = toRunListings(
      Array.from({ length: 12 }, (_, i) =>
        row({ id: `r${i}`, created_at: `2026-09-${String(i + 1).padStart(2, '0')}T08:00:00Z`, ended_at: null }),
      ),
    );
    const rows = goalRunRows(many, now, 'UTC');
    expect(rows).toHaveLength(GOAL_RUNS_SHOWN);
    expect(rows[0].id).toBe('r11');
  });
});
