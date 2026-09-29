import { describe, expect, it } from 'vitest';
import type { JudgeChannelsResult } from './channel-judge';
import type { FindChannelsResult } from './channel-search';
import { channelState, channelsPressLines, judgeAfterSearch, toView } from './subject-channels';

const found = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, youtubeChannelId: `UC${i}`, title: `Channel ${i}`, handle: null, foundWhy: '' }));

const judged = (over: Partial<Extract<JudgeChannelsResult, { ok: true }>> = {}): JudgeChannelsResult => ({
  ok: true,
  picked: 0,
  transcripts: null,
  sampled: 0,
  kept: 0,
  judged: [],
  settled: null,
  waiting: 0,
  failed: 0,
  quotaUnits: 0,
  stopped: null,
  ...over,
});

describe('channelState', () => {
  it('reads the five states from the verdict and the decision', () => {
    expect(channelState({ verdict: null, decided: null })).toBe('judging');
    expect(channelState({ verdict: 'follow', decided: null })).toBe('retrying');
    expect(channelState({ verdict: 'follow', decided: 'followed' })).toBe('following');
    expect(channelState({ verdict: 'follow', decided: 'unfollowed' })).toBe('unfollowed');
    expect(channelState({ verdict: 'pass', decided: 'passed' })).toBe('passed');
    expect(channelState({ verdict: 'pass', decided: null })).toBe('passed');
  });

  it('counts the picks once they exist', () => {
    const base = { id: 'a', title: 'A', handle: '@a', found_why: 'x', verdict: null, why: null, decided: null };
    expect(toView({ ...base, samples: null, picks: null }).picked).toBeNull();
    expect(toView({ ...base, samples: null, picks: [{}, {}, {}] })).toMatchObject({ picked: 3, samples: [], state: 'judging' });
  });
});

describe('channelsPressLines', () => {
  it('says what a whole press did', () => {
    const search: FindChannelsResult = { ok: true, added: found(5), unresolved: [], quotaUnits: 500 };
    const report = channelsPressLines(
      search,
      judged({
        judged: [
          { id: 'c0', title: 'Channel 0', verdict: 'follow', why: '' },
          { id: 'c1', title: 'Channel 1', verdict: 'pass', why: '' },
        ],
        settled: { followed: [{ id: 'c0', title: 'Channel 0', slug: 'c0', listing: null }], passed: 1, failed: [] },
        kept: 2,
        waiting: 3,
      }),
    );
    expect(report.error).toBeUndefined();
    expect(report.lines).toEqual([
      'Found 5 new channels.',
      '2 channels judged, 1 worth following, 1 channel added to your YouTube library, 2 videos added to your Videos.',
      '3 channels are still waiting on transcripts. The scheduled run finishes judging them.',
    ]);
  });

  it('names what stopped the search and how far it got', () => {
    const search: FindChannelsResult = { ok: false, reason: 'quota', detail: 'YouTube refused the lookup.', added: found(2), quotaUnits: 200 };
    expect(judgeAfterSearch(search)).toBe(true);
    const report = channelsPressLines(search, judged());
    expect(report.error).toBe('The search stopped: YouTube refused the lookup. 2 channels were stored before it stopped.');
  });

  it('does not judge after a missing key', () => {
    const search: FindChannelsResult = { ok: false, reason: 'no-anthropic-key', detail: 'Finding channels needs ANTHROPIC_API_KEY to be set.', added: [], quotaUnits: 0 };
    expect(judgeAfterSearch(search)).toBe(false);
    expect(channelsPressLines(search, null)).toEqual({
      lines: [],
      error: 'The search stopped: Finding channels needs ANTHROPIC_API_KEY to be set.',
    });
  });

  it('shows running out of transcript credits as a stop', () => {
    const search: FindChannelsResult = { ok: false, reason: 'nothing-new', detail: 'Every channel it found is already here.', added: [], quotaUnits: 0 };
    const report = channelsPressLines(
      search,
      judged({
        waiting: 1,
        transcripts: { fetched: 2, none: 0, failed: 0, cached: 0, credits: 2, segments: 0, stopped: { reason: 'budget', detail: 'this month’s credits are spent' } },
      }),
    );
    expect(report.lines?.[0]).toBe('No new channels this time. Every channel it found is already here.');
    expect(report.error).toBe('Transcripts stopped: this month’s credits are spent. The channels waiting on them are judged once they arrive.');
  });
});
