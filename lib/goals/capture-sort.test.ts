import { describe, expect, it } from 'vitest';
import { captureMessage, type CaptureContext } from '@/lib/goals/capture';
import {
  CAPTURE_MOVE_LABELS,
  CAPTURE_MOVES,
  CAPTURE_SORT_QUESTION,
  captureHintLine,
  captureSortState,
  isCaptureMove,
} from '@/lib/goals/capture-sort';

const context: CaptureContext = {
  goals: [
    { ref: 'g1', id: 'goal-1', title: 'Pay off student debt', areaName: 'Money', unit: '$', target: 0 },
    { ref: 'g2', id: 'goal-2', title: 'Know ten people', areaName: 'City', unit: null, target: null },
  ],
  steps: [
    {
      ref: 's1',
      id: 'step-1',
      goalRef: 'g1',
      goalTitle: 'Pay off student debt',
      title: 'Turn on autopay',
      kind: 'mine',
      depth: 1,
      rhythm: null,
    },
    {
      ref: 's2',
      id: 'step-2',
      goalRef: 'g2',
      goalTitle: 'Know ten people',
      title: 'Attend one event a week',
      kind: 'rhythm',
      depth: 1,
      rhythm: null,
    },
  ],
};

describe('the capture sort question', () => {
  it('offers exactly the five moves capture files, each with a label', () => {
    expect(CAPTURE_MOVES).toEqual(['close', 'count', 'note', 'reading', 'add']);
    expect(Object.keys(CAPTURE_SORT_QUESTION.options)).toEqual(CAPTURE_MOVES);
    for (const move of CAPTURE_MOVES) expect(CAPTURE_MOVE_LABELS[move]).toBeTruthy();
    expect(isCaptureMove('close')).toBe(true);
    expect(isCaptureMove('toString')).toBe(false);
  });

  it('shows Jev the sentence and an outline with no refs or ids', () => {
    const state = captureSortState('  turned on autopay ', context);
    expect(state).toEqual({
      sentence: 'turned on autopay',
      goals: [
        { goal: 'Pay off student debt', tracked_number: '$', steps: ['Turn on autopay'] },
        { goal: 'Know ten people', steps: ['Attend one event a week (rhythm)'] },
      ],
    });
    expect(JSON.stringify(state)).not.toMatch(/goal-1|step-1|"g1"|"s1"/);
  });

  it('sends the sentence alone when the outline could not be read', () => {
    expect(captureSortState('x', null)).toEqual({ sentence: 'x' });
  });
});

describe('the hint in the filing message', () => {
  it('goes before the sentence when there is one, and not at all otherwise', () => {
    const hint = captureHintLine('close', true);
    expect(hint).toContain('The person says');
    expect(captureHintLine('count', false)).toContain('confident');

    const withHint = captureMessage(context, 'turned on autopay', '2026-09-29', hint);
    expect(withHint.indexOf(hint)).toBeGreaterThan(0);
    expect(withHint.indexOf(hint)).toBeLessThan(withHint.indexOf('What happened'));
    expect(captureMessage(context, 'turned on autopay', '2026-09-29')).not.toContain('mainly');
  });
});
