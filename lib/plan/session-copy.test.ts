import { describe, expect, it } from 'vitest';
import { decideCopy, stateFor, summaryLine } from './session-copy';

describe('summaryLine', () => {
  it('makes one line and cuts it at 300 characters', () => {
    expect(summaryLine('  Built the\n export   page ', 'x')).toBe('Built the export page');
    expect(summaryLine('a'.repeat(400), 'x')).toHaveLength(300);
    expect(summaryLine('   ', 'The session is running.')).toBe('The session is running.');
    expect(summaryLine(null, 'fallback')).toBe('fallback');
  });
});

describe('stateFor', () => {
  it('maps what get_session says to a progress state', () => {
    expect(stateFor('running', 'run')).toBe('working');
    expect(stateFor('idle', 'run')).toBe('working');
    expect(stateFor('idle', 'thread')).toBe('done');
    expect(stateFor('ended', 'thread')).toBe('stopped');
    expect(stateFor('archived', 'run')).toBe('stopped');
  });
});

describe('decideCopy', () => {
  const base = { origin: 'run' as const, status: 'running' as const, summary: 'Editing the page' };

  it('writes the summary when the session has no row', () => {
    expect(decideCopy({ ...base, activityAt: '2026-11-05T10:00:00Z', rowUpdatedAt: null })).toEqual({
      kind: 'write',
      state: 'working',
      action: 'Editing the page',
    });
  });

  it('writes the summary when the session moved on after its row', () => {
    const d = decideCopy({ ...base, activityAt: '2026-11-05T10:05:00Z', rowUpdatedAt: '2026-11-05T10:00:00Z' });
    expect(d.kind).toBe('write');
  });

  it('only touches a row the session reported after its last activity', () => {
    expect(decideCopy({ ...base, activityAt: '2026-11-05T10:00:00Z', rowUpdatedAt: '2026-11-05T10:01:00Z' })).toEqual({
      kind: 'touch',
    });
  });

  it('writes when the activity time is unknown', () => {
    expect(decideCopy({ ...base, activityAt: null, rowUpdatedAt: '2026-11-05T10:01:00Z' }).kind).toBe('write');
  });

  it('records an ended session as stopped', () => {
    expect(decideCopy({ ...base, status: 'ended', summary: null, activityAt: null, rowUpdatedAt: null })).toEqual({
      kind: 'write',
      state: 'stopped',
      action: 'The session has ended.',
    });
  });
});
