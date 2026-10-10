import { describe, expect, it, vi } from 'vitest';
import { conceptsFromNote } from './from-note';

/**
 * Reading a note written after a reading.
 *
 * A note that only records what happened comes back with no concepts, and a
 * concept that arrives without its separating question or a concrete cost is
 * a malformed report, not a proposal.
 */

function clientReturning(input: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_chain', input }],
        usage: undefined,
      }),
    },
  } as never;
}

const run = (input: unknown) =>
  conceptsFromNote({
    subject: 'Economics',
    readingTitle: 'The rate and what people expect',
    note: 'Read chapter 4 on the train. The author spent a long time on the 1979 episode.',
    existing: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Rates are set, not cleared' }],
    anthropicApiKey: 'test',
    client: clientReturning(input),
  });

const concept = (over: Record<string, unknown> = {}) => ({
  name: 'Expectations carry the rate',
  claim: 'A policy rate only reaches prices through what people expect it to do next.',
  basis: 'Taken from the note on the reading.',
  separating_question: 'If the bank signals cuts next year, does a rate held today still loosen conditions?',
  cost_if_wrong: 'You read a held rate as tight policy and misjudge a bond position before the cut.',
  mastery: [],
  kind: 'claim',
  ...over,
});

const chain = (concepts: unknown[]) => ({
  subject: 'Economics',
  goal_concept: 'Expectations carry the rate',
  concepts,
  edges: [
    {
      prerequisite: 'Rates are set, not cleared',
      dependent: 'Expectations carry the rate',
      basis: 'One rests on the other.',
    },
  ],
});

describe('a note that only records what happened', () => {
  it('proposes no concepts', async () => {
    const result = await run({ subject: 'Economics', concepts: [], edges: [], too_vague: true });
    expect(result).toMatchObject({ ok: false, reason: 'nothing-in-it' });
  });

  it('proposes none even when no goal concept is named', async () => {
    const result = await run({ subject: 'Economics', concepts: [], edges: [] });
    expect(result).toMatchObject({ ok: false, reason: 'nothing-in-it' });
  });
});

describe('a concept from a note', () => {
  it('carries its separating question and its cost if wrong', async () => {
    const result = await run(chain([concept(), concept({ name: 'Rates are set, not cleared' })]));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const node = result.chain.nodes.find((n) => n.name === 'Expectations carry the rate');
    expect(node?.separatingQuestion).toContain('does a rate held today');
    expect(node?.costIfWrong).toContain('bond position');
  });

  it('is refused without a cost', async () => {
    const bare = concept({ cost_if_wrong: undefined });
    const result = await run(chain([bare]));
    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });

  it('is refused without a separating question', async () => {
    const bare = concept({ separating_question: undefined });
    const result = await run(chain([bare]));
    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });

  it('is refused when the cost is only that it is useful to know', async () => {
    const result = await run(chain([concept({ cost_if_wrong: 'It is useful to know how this works.' })]));
    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });
});
