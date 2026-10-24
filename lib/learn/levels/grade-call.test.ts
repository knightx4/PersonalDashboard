import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { gradeCellAnswer, gradePrompt, gradeSystem, LEVEL_GRADE_MODEL, LEVEL_GRADE_SECOND_MODEL } from '@/lib/learn/levels/grade-call';
import { REASONING_RULE } from '@/lib/learn/confidence';

function client(seen: string[]) {
  return {
    messages: {
      create: async (args: { model: string }) => {
        seen.push(args.model);
        return {
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [
            {
              type: 'tool_use',
              name: 'report_grades',
              input: { grades: [{ cell: 'C1', verdict: 'met', quote: 'x', reason: 'because' }] },
            },
          ],
        };
      },
    },
  } as never;
}

describe('gradeCellAnswer', () => {
  it('grades with the first model by default and the one given otherwise, keeping the reason', async () => {
    const seen: string[] = [];
    const base = { cells: [], question: 'q', answer: 'x', anthropicApiKey: 'k', client: client(seen) };
    const first = await gradeCellAnswer(base);
    await gradeCellAnswer({ ...base, model: LEVEL_GRADE_SECOND_MODEL });
    expect(seen).toEqual([LEVEL_GRADE_MODEL, LEVEL_GRADE_SECOND_MODEL]);
    expect(first.ok && first.verdicts[0].reason).toBe('because');
    expect(LEVEL_GRADE_SECOND_MODEL).not.toBe(LEVEL_GRADE_MODEL);
  });
});

describe('confidence and reasoning reach the cell grader (plan #2522.3)', () => {
  it('puts the reasoning and the confidence after the answer', () => {
    const text = gradePrompt({
      cells: [],
      question: 'Why do wages lag?',
      answer: 'Contracts.',
      signals: { confidence: 0.75, reasoning: 'Pay is agreed a year ahead.' },
    });
    expect(text.indexOf('Pay is agreed a year ahead.')).toBeGreaterThan(text.indexOf('Contracts.'));
    expect(text).toContain('Fairly sure');
  });

  it('leaves the prompt as it was when nothing came with the answer', () => {
    const plain = gradePrompt({ cells: [], question: 'q', answer: 'a' });
    expect(gradePrompt({ cells: [], question: 'q', answer: 'a', signals: {} })).toBe(plain);
  });

  it('adds the reasoning rule, as a not met on C1, only when reasoning was given', () => {
    expect(gradeSystem('cell', false)).not.toContain(REASONING_RULE);
    expect(gradeSystem('cell', true)).toContain(REASONING_RULE);
    expect(gradeSystem('cell', true)).toContain('not_met on C1');
  });

  it('sends the rule to the model when reasoning comes with the answer', async () => {
    const systems: string[] = [];
    const fake = {
      messages: {
        create: async (args: { system: string }) => {
          systems.push(args.system);
          return {
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: 'tool_use', name: 'report_grades', input: { grades: [] } }],
          };
        },
      },
    } as never;
    const base = { cells: [], question: 'q', answer: 'x', anthropicApiKey: 'k', client: fake };
    await gradeCellAnswer(base);
    await gradeCellAnswer({ ...base, signals: { reasoning: 'because' } });
    expect(systems[0]).not.toContain(REASONING_RULE);
    expect(systems[1]).toContain(REASONING_RULE);
  });
});
