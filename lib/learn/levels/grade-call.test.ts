import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { gradeCellAnswer, LEVEL_GRADE_MODEL, LEVEL_GRADE_SECOND_MODEL } from '@/lib/learn/levels/grade-call';

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
