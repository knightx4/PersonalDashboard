import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { captureMessage, type CaptureContext } from '@/lib/goals/capture';
import { askCaptureModel } from '@/lib/goals/capture-model';
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
    expect(CAPTURE_MOVES).toEqual(['close', 'count', 'progress', 'reading', 'add']);
    expect(CAPTURE_MOVE_LABELS.progress).toBe('Log progress');
    expect(isCaptureMove('note')).toBe(false);
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

describe('partial work is progress, not a close (plan #1275)', () => {
  it('describes a close as the whole step finished, and partial work as progress', () => {
    expect(CAPTURE_SORT_QUESTION.options.close).not.toMatch(/moved/);
    expect(CAPTURE_SORT_QUESTION.options.close).toMatch(/whole/);
    expect(CAPTURE_SORT_QUESTION.options.progress).toMatch(/some of the bags/);
  });

  it('never lets a hint force a close over part of a step', () => {
    for (const move of CAPTURE_MOVES) {
      expect(captureHintLine(move, true)).toContain('never a close');
    }
  });

  it('tells Haiku that part of a step is progress and offers the progress move', async () => {
    let sent: { system?: unknown; tools?: { input_schema: unknown }[] } = {};
    const client = {
      messages: {
        create: async (params: typeof sent) => {
          sent = params;
          return { content: [], usage: { input_tokens: 0, output_tokens: 0 } };
        },
      },
    } as unknown as Anthropic;
    await askCaptureModel(
      { apiKey: 'test', captureId: 'capture-1', today: '2026-09-30', client },
      'I just moved two bags',
      async () => ({ ok: false, error: 'not filed in this test' }),
    );
    const system = JSON.stringify(sent.system).replace(/(\s|\\n)+/g, ' ');
    expect(system).toContain("part of a step's work");
    expect(system).toContain('is progress on that step, never a close');
    expect(system).toContain('Close a step only when the sentence says the whole step is finished');
    const tools = (sent.tools ?? []) as unknown as { name: string; input_schema: unknown }[];
    expect(tools.map((t) => t.name)).toContain('file_progress');
    expect(tools.map((t) => t.name)).not.toContain('file_note');
    const schema = JSON.stringify(tools.find((t) => t.name === 'file_progress')?.input_schema);
    expect(schema).toContain('"quantity"');
    expect(schema).toContain('"day"');
  });
});
