import { describe, expect, it } from 'vitest';
import { agoText, describeRun, viewRun, type SearchRunRow } from './search-runs';

const NOW = new Date('2026-09-30T18:00:00Z');
const row = (over: Partial<SearchRunRow>): SearchRunRow => ({
  id: 'r1',
  kind: 'apply',
  trigger: 'button',
  stage: 'searching',
  started_at: '2026-09-30T17:58:00Z',
  finished_at: null,
  written: 0,
  boards_read: 0,
  candidates: 0,
  error: null,
  ...over,
});

describe('viewRun', () => {
  it('reads an unfinished run as running, then as stopped past the limit', () => {
    expect(viewRun(row({}), NOW).state).toBe('running');
    expect(viewRun(row({ started_at: '2026-09-30T17:50:00Z' }), NOW).state).toBe('stopped');
  });

  it('reads a finished run by its stage', () => {
    expect(viewRun(row({ stage: 'done', finished_at: '2026-09-30T17:59:00Z' }), NOW).state).toBe('done');
    expect(viewRun(row({ stage: 'failed', error: 'x' }), NOW).state).toBe('failed');
  });
});

describe('describeRun', () => {
  it('says what a running search is doing', () => {
    const line = describeRun(viewRun(row({ boards_read: 58, candidates: 12 }), NOW), NOW);
    expect(line).toEqual({
      running: true,
      tone: 'plain',
      text: 'Searching the web… Started 2 minutes ago. Read 58 job boards, 12 postings worth a look. This takes a few minutes.',
    });
  });

  it('says how a finished, failed or stopped search ended', () => {
    const done = viewRun(row({ stage: 'done', finished_at: '2026-09-30T17:59:00Z', written: 3 }), NOW);
    expect(describeRun(done, NOW)?.text).toBe('The search 1 minute ago found 3 new roles.');
    const failed = viewRun(row({ stage: 'failed', finished_at: '2026-09-30T17:59:00Z', error: 'Rate-limited.' }), NOW);
    expect(describeRun(failed, NOW)).toMatchObject({ tone: 'warn', text: 'The search 1 minute ago failed: Rate-limited.' });
    const stopped = viewRun(row({ started_at: '2026-09-30T17:40:00Z', trigger: 'daily' }), NOW);
    expect(describeRun(stopped, NOW)?.text).toContain('The daily search started 20 minutes ago stopped while searching the web');
    expect(describeRun(null, NOW)).toBeNull();
  });
});

describe('agoText', () => {
  it('rounds down to the largest whole unit', () => {
    expect(agoText('2026-09-30T17:59:40Z', NOW)).toBe('just now');
    expect(agoText('2026-09-30T15:00:00Z', NOW)).toBe('3 hours ago');
    expect(agoText('2026-09-28T17:00:00Z', NOW)).toBe('2 days ago');
  });
});
