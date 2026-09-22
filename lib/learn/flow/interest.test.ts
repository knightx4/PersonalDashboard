import { describe, expect, it } from 'vitest';
import {
  isExploreTurn,
  LEAST_WEIGHT,
  MOST_WEIGHT,
  nearness,
  offerLean,
  STOPPED_WEIGHT,
  trackToAsk,
  trackWeight,
  trackWeights,
  weightReason,
  type TrackActivity,
} from './interest';

/**
 * How much each track is asked about, and how the new-track offer leans
 * (plan #780).
 */

function activity(input: Partial<TrackActivity>): TrackActivity {
  return { answered: 0, skipped: 0, pushedAside: 0, answeredBefore: 0, ...input };
}

describe('a track’s weight', () => {
  it('is 1 with no history', () => {
    expect(trackWeight(activity({}), false)).toEqual({ weight: 1, stopped: false });
  });

  it('rises with answers and falls with skips and Not now', () => {
    expect(trackWeight(activity({ answered: 3 }), false).weight).toBe(4);
    expect(trackWeight(activity({ answered: 1, skipped: 2, pushedAside: 1 }), false).weight).toBe(
      0.5,
    );
  });

  it('is held between a quarter and four', () => {
    expect(trackWeight(activity({ answered: 40 }), false).weight).toBe(MOST_WEIGHT);
    expect(trackWeight(activity({ skipped: 40 }), false).weight).toBe(LEAST_WEIGHT);
  });

  it('drops when you answered it before and only other tracks lately', () => {
    expect(trackWeight(activity({ answeredBefore: 8 }), true)).toEqual({
      weight: STOPPED_WEIGHT,
      stopped: true,
    });
  });

  it('does not drop when you were away from every track', () => {
    expect(trackWeight(activity({ answeredBefore: 8 }), false).weight).toBe(1);
  });

  it('knows which tracks were answered elsewhere', () => {
    const weights = trackWeights(
      new Map([
        ['a', activity({ answered: 5 })],
        ['b', activity({ answeredBefore: 3 })],
      ]),
    );
    expect(weights.get('a')?.weight).toBe(MOST_WEIGHT);
    expect(weights.get('b')).toEqual({ weight: STOPPED_WEIGHT, stopped: true });
  });
});

describe('the line on the track’s page', () => {
  it('names the counts behind a heavy track', () => {
    const row = activity({ answered: 12, skipped: 1 });
    expect(weightReason(row, trackWeight(row, false))).toBe(
      'Practice Flow asks about this track about 4 times as often as a new one, because in the last four weeks you answered 12 of its questions and skipped 1.',
    );
  });

  it('names skips and Not now behind a light one', () => {
    const row = activity({ skipped: 2, pushedAside: 1 });
    expect(weightReason(row, trackWeight(row, false))).toBe(
      'Practice Flow asks about this track about 25% as often as a new one, because in the last four weeks you answered none of its questions, skipped 2 and pushed 1 idea aside with Not now.',
    );
  });

  it('says when nothing has happened', () => {
    expect(weightReason(undefined, undefined)).toBe(
      'Practice Flow asks about this track as often as a new one, because you have not answered or skipped any of its questions in the last four weeks.',
    );
  });

  it('says when you stopped', () => {
    const row = activity({ answeredBefore: 4 });
    expect(weightReason(row, trackWeight(row, true))).toBe(
      'Practice Flow asks about this track about 50% as often as a new one, because in the last four weeks you answered questions from other tracks and none from this one.',
    );
  });
});

describe('the track a question comes from', () => {
  const shares = [
    { subjectId: 'liked', weight: 4, asked: 0 },
    { subjectId: 'skipped', weight: 0.25, asked: 0 },
    { subjectId: 'new', weight: 1, asked: 0 },
  ];

  it('is the heaviest when nothing has been asked', () => {
    expect(trackToAsk(['skipped', 'new', 'liked'], shares, false)).toBe('liked');
  });

  it('is only one that has something to ask', () => {
    expect(trackToAsk(['skipped'], shares, false)).toBe('skipped');
    expect(trackToAsk([], shares, false)).toBeNull();
  });

  it('is the one asked least on an explore turn', () => {
    const asked = [
      { subjectId: 'liked', weight: 4, asked: 9 },
      { subjectId: 'new', weight: 1, asked: 2 },
    ];
    expect(trackToAsk(['liked', 'new'], asked, true)).toBe('new');
  });

  it('shares a run of questions in proportion to weight, one in five kept for the least asked', () => {
    // As the weights came about: ten answered, six skipped, nothing yet.
    const run = [
      { subjectId: 'liked', weight: 4, asked: 10 },
      { subjectId: 'skipped', weight: 0.25, asked: 6 },
      { subjectId: 'new', weight: 1, asked: 0 },
    ];
    const count = new Map<string, number>();
    for (let answered = 0; answered < 40; answered += 1) {
      const id = trackToAsk(['liked', 'skipped', 'new'], run, isExploreTurn(answered))!;
      count.set(id, (count.get(id) ?? 0) + 1);
      run.find((share) => share.subjectId === id)!.asked += 1;
    }
    expect(count.get('liked')!).toBeGreaterThan(count.get('new')!);
    expect(count.get('new')!).toBeGreaterThan(count.get('skipped')!);
    expect(count.get('skipped')!).toBeGreaterThan(0);
  });

  it('comes around once in every five', () => {
    expect([0, 1, 2, 3, 4, 5, 6].filter(isExploreTurn)).toEqual([1, 6]);
  });
});

describe('the lean on new-track offers', () => {
  const notes = (...ids: string[]) => new Set(ids);

  it('measures nearness as the share of notes in common', () => {
    expect(nearness(notes('a', 'b'), notes('b', 'c'))).toBeCloseTo(1 / 3);
    expect(nearness(notes('a'), notes())).toBe(0);
  });

  it('lifts a theme near a track you answer and lowers one near a track you skip', () => {
    const lean = offerLean(
      [
        { id: 'near-liked', notes: notes('n1', 'n2') },
        { id: 'near-skipped', notes: notes('n3', 'n4') },
        { id: 'far', notes: notes('n9') },
      ],
      [
        { themeId: 'liked', pull: 4, notes: notes('n1', 'n2') },
        { themeId: 'skipped', pull: 0.25, notes: notes('n3', 'n4') },
      ],
    );
    expect(lean.get('near-liked')).toBe(4);
    expect(lean.get('near-skipped')).toBe(0.25);
    expect(lean.get('far')).toBe(1);
  });

  it('changes nothing with no history', () => {
    const lean = offerLean(
      [{ id: 't', notes: notes('n1') }],
      [{ themeId: 'a', pull: 1, notes: notes('n1') }],
    );
    expect(lean.get('t')).toBe(1);
  });
});
