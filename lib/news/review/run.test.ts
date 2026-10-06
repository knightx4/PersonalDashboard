import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { QuickIssue } from '@/lib/news/quick/next';
import { REVIEW_WINDOW_MS, type ReviewInput } from './choose';
import { readReviewReply, reviewPrompt } from './reply';
import { reviewClock, runReviewFor, type ReviewPorts, type ReviewRow } from './run';

const person = { userId: 'u1', timezone: 'America/New_York' };
// 8:30pm in New York on 6 October 2026 (EDT, UTC-4).
const evening = new Date('2026-10-07T00:30:00Z');
const eightPm = new Date('2026-10-07T00:00:00Z');

function issue(id: string, receivedAt: string, headlines: string[]): QuickIssue {
  return {
    id,
    senderId: 's1',
    subject: `Issue ${id}`,
    receivedAt,
    summary: 'A summary.',
    stories: headlines.map((headline, i) => ({ headline, summary: `${headline} happened.`, rating: 90 - i })),
  };
}

const usage = { input_tokens: 100, output_tokens: 50 } as unknown as SpendReport['usage'];

function fakePorts(over: {
  issues?: QuickIssue[];
  has?: boolean;
  write?: ReviewPorts['write'];
}) {
  const saved: ReviewRow[] = [];
  const ledger: SpendReport[] = [];
  const windows: [Date, Date][] = [];
  const write = vi.fn<ReviewPorts['write']>(
    over.write ??
      (async (picks, onSpend) => {
        onSpend({ model: 'sonnet', usage });
        return { overview: 'A busy day.', lines: picks.map((p) => `Line for ${p.headline}.`) };
      }),
  );
  const ports: ReviewPorts = {
    hasReview: async () => over.has ?? false,
    async inputs(_userId, since, until): Promise<Omit<ReviewInput, 'until'>> {
      windows.push([since, until]);
      return {
        issues: over.issues ?? [],
        senders: [{ id: 's1', email: 'p@paper.com', name: 'The Paper', muted: false }],
        groups: [],
        hidden: [],
      };
    },
    write,
    ledger: async (_userId, report) => {
      ledger.push(report);
    },
    save: async (row) => {
      saved.push(row);
    },
  };
  return { ports, saved, ledger, write, windows };
}

describe('reviewClock', () => {
  it('waits until 8pm in the person’s own zone', () => {
    expect(reviewClock('America/New_York', new Date('2026-10-06T23:59:00Z'))).toBeNull();
    expect(reviewClock('Europe/London', new Date('2026-10-06T18:59:59Z'))).toBeNull();
  });

  it('gives the local day and 8pm that day as the end of the window', () => {
    expect(reviewClock('America/New_York', evening)).toEqual({ day: '2026-10-06', until: eightPm });
    const late = reviewClock('America/New_York', new Date('2026-10-07T03:59:12.345Z'));
    expect(late).toEqual({ day: '2026-10-06', until: eightPm });
  });
});

describe('runReviewFor', () => {
  it('does nothing before 8pm', async () => {
    const { ports, saved, write } = fakePorts({ issues: [issue('a', '2026-10-06T12:00:00Z', ['One'])] });
    const result = await runReviewFor(ports, person, new Date('2026-10-06T20:00:00Z'), REVIEW_WINDOW_MS);
    expect(result).toEqual({ status: 'not-yet' });
    expect(write).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('makes no call and writes no row on a day with no newsletters', async () => {
    const { ports, saved, write, ledger } = fakePorts({});
    expect(await runReviewFor(ports, person, evening, REVIEW_WINDOW_MS)).toEqual({
      status: 'no-news',
      day: '2026-10-06',
    });
    expect(write).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(ledger).toEqual([]);
  });

  it('skips a day that already has a review', async () => {
    const { ports, write } = fakePorts({ has: true, issues: [issue('a', '2026-10-06T12:00:00Z', ['One'])] });
    expect((await runReviewFor(ports, person, evening, REVIEW_WINDOW_MS)).status).toBe('already');
    expect(write).not.toHaveBeenCalled();
  });

  it('writes the day with one call, its spend and a line per story', async () => {
    const { ports, saved, write, ledger, windows } = fakePorts({
      issues: [issue('a', '2026-10-06T12:00:00Z', ['One', 'Two'])],
    });
    const result = await runReviewFor(ports, person, evening, REVIEW_WINDOW_MS);
    expect(result).toEqual({ status: 'written', day: '2026-10-06', stories: 2 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(ledger).toEqual([{ model: 'sonnet', usage }]);
    expect(windows).toEqual([[new Date(eightPm.getTime() - REVIEW_WINDOW_MS), eightPm]]);
    expect(saved).toEqual([
      {
        user_id: 'u1',
        day: '2026-10-06',
        overview: 'A busy day.',
        items: [
          { issue_id: 'a', story_index: 0, headline: 'One', line: 'Line for One.', sources: 1 },
          { issue_id: 'a', story_index: 1, headline: 'Two', line: 'Line for Two.', sources: 1 },
        ],
        written_at: evening.toISOString(),
        error: null,
      },
    ]);
  });

  it('leaves out a newsletter that arrived after 8pm', async () => {
    const { ports, write } = fakePorts({ issues: [issue('a', '2026-10-07T00:10:00Z', ['Late'])] });
    expect((await runReviewFor(ports, person, evening, REVIEW_WINDOW_MS)).status).toBe('no-news');
    expect(write).not.toHaveBeenCalled();
  });

  it('stores the error when the call fails, and still records its spend', async () => {
    const { ports, saved, ledger } = fakePorts({
      issues: [issue('a', '2026-10-06T12:00:00Z', ['One'])],
      write: async (_picks, onSpend) => {
        onSpend({ model: 'sonnet', usage });
        throw new Error('Dash wrote no overview.');
      },
    });
    const result = await runReviewFor(ports, person, evening, REVIEW_WINDOW_MS);
    expect(result).toEqual({ status: 'failed', day: '2026-10-06', error: 'Dash wrote no overview.' });
    expect(ledger).toHaveLength(1);
    expect(saved).toMatchObject([{ overview: null, items: [], error: 'Dash wrote no overview.' }]);
  });

  it('writes nothing when there is no model to ask', async () => {
    const { ports, saved } = fakePorts({
      issues: [issue('a', '2026-10-06T12:00:00Z', ['One'])],
      write: async () => null,
    });
    expect((await runReviewFor(ports, person, evening, REVIEW_WINDOW_MS)).status).toBe('no-key');
    expect(saved).toEqual([]);
  });
});

describe('the reply', () => {
  const picks = [
    { issueId: 'a', storyIndex: 0, headline: 'One', summary: 'One happened.', sources: 2 },
    { issueId: 'a', storyIndex: 1, headline: 'Two', summary: ' Two  happened. ', sources: 1, local: true as const },
  ];

  it('numbers the stories from one and marks the local one', () => {
    expect(reviewPrompt(picks)).toBe(
      '1. One [in 2 newsletters]: One happened.\n2. (local) Two:  Two  happened. ',
    );
  });

  it('reads the lines by number and keeps the summary for a story left out', () => {
    expect(
      readReviewReply({ overview: ' A day. ', lines: [{ number: 1, line: 'First.' }, { number: 9, line: 'x' }] }, picks),
    ).toEqual({ overview: 'A day.', lines: ['First.', 'Two happened.'] });
  });

  it('refuses a reply with no overview', () => {
    expect(() => readReviewReply({ overview: '  ', lines: [] }, picks)).toThrow('Dash wrote no overview.');
  });
});
