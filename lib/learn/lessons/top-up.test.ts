import { describe, expect, it } from 'vitest';
import type { Concept } from '@/lib/learn/graph/model';
import type { LessonPick, TrackNeed } from './choose';
import type { LaidOutUnit } from './lay-out-unit';
import {
  LAYOUT_RESERVE_MS,
  LESSON_HOLD_MS,
  MAX_LAYOUTS_PER_RUN,
  lessonWhy,
  lessonsWanted,
  writeLessonsFor,
  type LessonOutcome,
  type LessonTopUpPorts,
} from './top-up';

/**
 * Filling Learn now with lessons (plan #978): four in five of the cards a
 * top-up is short go to lessons, units are laid out for tracks with none open,
 * a track that cannot be laid out is held for a day, and the why line names
 * the track.
 */

function pick(id: string, subjectId = 'track'): LessonPick {
  return {
    subjectId,
    subjectName: subjectId,
    unitId: `${subjectId}-unit`,
    concept: { id, name: `Concept ${id}`, claim: `${id} holds.`, mastery: [] } as unknown as Concept,
    stepsToOutcome: 0,
  };
}

function need(subjectId: string, because: TrackNeed['because'] = 'no-chain'): TrackNeed {
  return { subjectId, subjectName: subjectId, because, unitId: because === 'no-curriculum' ? null : `${subjectId}-u` };
}

function ports(options: {
  choices: { picks: LessonPick[]; needs: TrackNeed[] }[];
  layOut?: (subjectId: string) => LaidOutUnit;
  write?: (pick: LessonPick) => LessonOutcome;
  now?: () => number;
}) {
  const calls = { choose: 0, layOut: [] as string[], hold: [] as { subjectId: string; until: Date }[], write: [] as string[] };
  const port: LessonTopUpPorts = {
    choose: async () => {
      const choice = options.choices[Math.min(calls.choose, options.choices.length - 1)]!;
      calls.choose += 1;
      return choice;
    },
    layOut: async (_userId, subjectId) => {
      calls.layOut.push(subjectId);
      return options.layOut?.(subjectId) ?? { outcome: 'laid-out', unitId: 'u', goalId: 'g', conceptIds: ['c'] };
    },
    hold: async (_userId, subjectId, until) => {
      calls.hold.push({ subjectId, until });
    },
    write: async (_userId, chosen) => {
      calls.write.push(chosen.concept.id);
      return { outcome: options.write?.(chosen) ?? 'ready' };
    },
    now: options.now ?? (() => 0),
  };
  return { port, calls };
}

const FAR = 10 * 60_000;

describe('how many lessons a top-up asks for', () => {
  it('is four in five of what is short, rounded', () => {
    expect(lessonsWanted(20)).toBe(16);
    expect(lessonsWanted(15)).toBe(12);
    expect(lessonsWanted(5)).toBe(4);
    expect(lessonsWanted(1)).toBe(1);
    expect(lessonsWanted(0)).toBe(0);
    expect(lessonsWanted(-3)).toBe(0);
  });
});

describe('writing lessons', () => {
  it('writes a lesson for each concept chosen', async () => {
    const { port, calls } = ports({ choices: [{ picks: [pick('a'), pick('b'), pick('c')], needs: [] }] });
    const summary = await writeLessonsFor(port, { userId: 'u', wanted: 4, deadline: FAR });
    expect(calls.write).toEqual(['a', 'b', 'c']);
    expect(summary).toMatchObject({ wanted: 4, chosen: 3, written: 3, dropped: [], failed: [] });
    expect(calls.layOut).toEqual([]);
  });

  it('counts dropped and failed lessons apart from written ones', async () => {
    const { port } = ports({
      choices: [{ picks: [pick('a'), pick('b'), pick('c')], needs: [] }],
      write: (chosen) => (chosen.concept.id === 'b' ? 'dropped' : chosen.concept.id === 'c' ? 'failed' : 'ready'),
    });
    const summary = await writeLessonsFor(port, { userId: 'u', wanted: 3, deadline: FAR });
    expect(summary.written).toBe(1);
    expect(summary.dropped).toHaveLength(1);
    expect(summary.failed).toHaveLength(1);
  });

  it('does nothing when no lesson is wanted', async () => {
    const { port, calls } = ports({ choices: [{ picks: [pick('a')], needs: [need('x')] }] });
    const summary = await writeLessonsFor(port, { userId: 'u', wanted: 0, deadline: FAR });
    expect(calls.choose).toBe(0);
    expect(summary.written).toBe(0);
  });

  it('writes nothing once the deadline has passed', async () => {
    const { port, calls } = ports({ choices: [{ picks: [pick('a')], needs: [] }], now: () => 100 });
    const summary = await writeLessonsFor(port, { userId: 'u', wanted: 1, deadline: 50 });
    expect(calls.write).toEqual([]);
    expect(summary.stopped).toBe('deadline');
  });
});

describe('laying out units', () => {
  it('lays out a track with no chain and chooses again, so its concepts are taught in the same run', async () => {
    const { port, calls } = ports({
      choices: [
        { picks: [pick('a', 'ready')], needs: [need('empty')] },
        { picks: [pick('a', 'ready'), pick('n', 'empty')], needs: [] },
      ],
    });
    const summary = await writeLessonsFor(port, { userId: 'u', wanted: 4, deadline: FAR });
    expect(calls.layOut).toEqual(['empty']);
    expect(calls.choose).toBe(2);
    expect(calls.write).toEqual(['a', 'n']);
    expect(summary.laidOut).toEqual(['empty']);
  });

  it('lays out at most two tracks in a run', async () => {
    const { port, calls } = ports({
      choices: [{ picks: [], needs: [need('one'), need('two'), need('three')] }],
    });
    await writeLessonsFor(port, { userId: 'u', wanted: 4, deadline: FAR });
    expect(calls.layOut).toHaveLength(MAX_LAYOUTS_PER_RUN);
  });

  it('leaves tracks that need a unit written, or a curriculum, to a later step', async () => {
    const { port, calls } = ports({
      choices: [{ picks: [], needs: [need('done', 'all-units-done'), need('bare', 'no-curriculum')] }],
    });
    await writeLessonsFor(port, { userId: 'u', wanted: 4, deadline: FAR });
    expect(calls.layOut).toEqual([]);
    expect(calls.hold).toEqual([]);
  });

  it('holds a track for a day when laying it out fails or finds no unit', async () => {
    const { port, calls } = ports({
      choices: [{ picks: [], needs: [need('broken'), need('full')] }],
      layOut: (subjectId) =>
        subjectId === 'broken' ? { outcome: 'failed', detail: 'The model said no.' } : { outcome: 'no-unit-left' },
      now: () => 1_000,
    });
    const summary = await writeLessonsFor(port, { userId: 'u', wanted: 4, deadline: FAR });
    expect(calls.hold.map((held) => held.subjectId)).toEqual(['broken', 'full']);
    expect(calls.hold[0]!.until.getTime()).toBe(1_000 + LESSON_HOLD_MS);
    expect(summary.held).toEqual(['broken', 'full']);
    expect(summary.failed).toEqual(['broken: The model said no.']);
    // Nothing was laid out, so the first choice stands.
    expect(calls.choose).toBe(1);
  });

  it('lays nothing out when too little time is left', async () => {
    const { port, calls } = ports({ choices: [{ picks: [pick('a')], needs: [need('empty')] }] });
    await writeLessonsFor(port, { userId: 'u', wanted: 4, deadline: LAYOUT_RESERVE_MS - 1 });
    expect(calls.layOut).toEqual([]);
    expect(calls.write).toEqual(['a']);
  });
});

describe('the why line', () => {
  it('names the track', () => {
    expect(lessonWhy('Economics', [])).toBe('Next in your Economics track.');
  });

  it('names what the concept builds on, two at most', () => {
    expect(lessonWhy('Economics', ['Supply'])).toBe('Next in your Economics track. It builds on Supply.');
    expect(lessonWhy('Economics', ['Supply', 'Demand'])).toBe(
      'Next in your Economics track. It builds on Supply and Demand.',
    );
    expect(lessonWhy('Economics', ['Supply', 'Demand', 'Elasticity', 'Tax'])).toBe(
      'Next in your Economics track. It builds on Supply, Demand and 2 more.',
    );
  });
});
