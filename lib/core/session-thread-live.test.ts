import { describe, expect, it } from 'vitest';
import {
  heardThreadOf,
  latestSessionLine,
  listWithHeard,
  mergeReports,
  mergeThreadMessages,
  progressReportOf,
  sessionLines,
  threadWithHeard,
} from './session-thread-live';
import type { SessionMessage, SessionThread } from './session-threads-model';

function message(fields: Partial<SessionMessage> & Pick<SessionMessage, 'id' | 'author' | 'createdAt'>): SessionMessage {
  return { kind: 'text', body: 'x', options: null, artifactUrl: null, attachment: null, answer: null, answeredAt: null, ...fields };
}

const thread: SessionThread = {
  id: 't1',
  title: 'A thread',
  projectId: null,
  projectLabel: 'This app',
  sessionId: null,
  state: 'queued',
  lastAt: '2026-11-05T10:00:00Z',
  updatedAt: '2026-11-05T10:00:00Z',
};

describe('mergeThreadMessages', () => {
  it('appends a heard message once, in order', () => {
    const a = message({ id: 'a', author: 'person', createdAt: '2026-11-05T10:00:00Z' });
    const b = message({ id: 'b', author: 'session', createdAt: '2026-11-05T10:01:00.123456+00:00' });
    expect(mergeThreadMessages([a], [b, a]).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('takes a heard answer, and keeps the server file name', () => {
    const q = message({ id: 'q', author: 'session', kind: 'question', createdAt: '2026-11-05T10:00:00Z', attachment: { name: 'f.pdf', href: '/f' } });
    const answered = { ...q, answer: 'Yes', answeredAt: '2026-11-05T10:02:00Z', attachment: { name: 'raw', href: null } };
    const [merged] = mergeThreadMessages([q], [answered]);
    expect(merged.answer).toBe('Yes');
    expect(merged.attachment?.name).toBe('f.pdf');
  });
});

describe('progress reports', () => {
  it('reads a row and keeps each rewrite as its own report', () => {
    const one = progressReportOf({ id: 'p', state: 'working', action: 'Reading the code', needs: null, updated_at: '2026-11-05T10:01:00Z' });
    const two = progressReportOf({ id: 'p', state: 'working', action: 'Running the tests', needs: null, updated_at: '2026-11-05T10:02:00Z' });
    expect(one && two).toBeTruthy();
    expect(mergeReports([one!], [two!, one!]).map((r) => r.action)).toEqual(['Reading the code', 'Running the tests']);
    expect(progressReportOf({ id: 'p', state: 'bogus', action: 'x', updated_at: 'now' })).toBeNull();
  });
});

describe('sessionLines', () => {
  it('draws status lines and reports since your last message, without repeats', () => {
    const messages = [
      message({ id: 's0', author: 'session', kind: 'status', body: 'Old', createdAt: '2026-11-05T09:59:00Z' }),
      message({ id: 'y', author: 'person', createdAt: '2026-11-05T10:00:00Z' }),
      message({ id: 's1', author: 'session', kind: 'status', body: 'Reading the code', createdAt: '2026-11-05T10:01:00Z' }),
    ];
    const reports = [
      progressReportOf({ id: 'p', state: 'working', action: 'Reading the code', updated_at: '2026-11-05T10:01:01Z' })!,
      progressReportOf({ id: 'p', state: 'working', action: 'Running the tests', updated_at: '2026-11-05T10:03:00Z' })!,
    ];
    const lines = sessionLines('t1', messages, reports);
    expect(lines.map((l) => l.body)).toEqual(['Reading the code', 'Running the tests']);
    expect(latestSessionLine(messages, reports)).toBe('Running the tests');
    expect(latestSessionLine(messages, [])).toBe('Reading the code');
  });
});

describe('thread state', () => {
  it('lays a newer heard row over the server read, and ignores an older one', () => {
    const newer = heardThreadOf({ state: 'working', session_id: 'cse_1', updated_at: '2026-11-05T10:05:00Z' });
    expect(threadWithHeard(thread, newer)).toMatchObject({ state: 'working', sessionId: 'cse_1' });
    const older = heardThreadOf({ state: 'idle', session_id: null, updated_at: '2026-11-05T09:00:00Z' });
    expect(threadWithHeard(thread, older).state).toBe('queued');
    expect(threadWithHeard(null, newer)).toBeNull();
  });
});

describe('listWithHeard', () => {
  const other: SessionThread = { ...thread, id: 't2', lastAt: '2026-11-05T11:00:00Z' };
  it('moves a thread that moved to the top and marks it until it is opened', () => {
    const heard = new Map([['t1', { state: 'waiting' as const, at: '2026-11-05T12:00:00Z' }]]);
    const list = listWithHeard([other, thread], heard, null);
    expect(list[0]).toMatchObject({ id: 't1', state: 'waiting', moved: true });
    expect(listWithHeard([other, thread], heard, 't1')[0].moved).toBe(false);
    const seen = new Map([['t1', '2026-11-05T12:00:00Z']]);
    expect(listWithHeard([other, thread], heard, null, seen)[0].moved).toBe(false);
  });
});
