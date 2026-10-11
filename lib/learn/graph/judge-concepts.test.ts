import { describe, expect, it, vi } from 'vitest';
import type { ChainNode, ProposedChain } from './chain-payload';
import { approvedChainSchema } from './chain-payload';
import {
  anthropicConceptJudge,
  applyVerdicts,
  DROP_REASONS,
  judgeNoteChain,
  type ConceptJudge,
  type ConceptVerdictReport,
} from './judge-concepts';
import { NODE_RULE } from './position-prompt';

/**
 * The second check on a note's concepts (plan #1718).
 *
 * A dropped concept never reaches the chain, a weak one stays and says so,
 * and a kept one carries the judge's question and cost. The call is a port,
 * so all of this runs without a network.
 */

const EXISTING = '00000000-0000-4000-8000-000000000001';

const node = (name: string, over: Partial<ChainNode> = {}): ChainNode => ({
  name,
  claim: `${name}, stated as a claim.`,
  basis: 'Taken from the note on the reading.',
  mastery: [],
  kind: null,
  existingId: null,
  separatingQuestion: 'The extractor asked this, which is a question?',
  costIfWrong: 'The extractor said this would cost a bad bond trade.',
  ...over,
});

const chain = (): ProposedChain => ({
  subject: 'Economics',
  goalConcept: 'Expectations carry the rate',
  nodes: [
    node('Rates are set, not cleared', { existingId: EXISTING }),
    node('Expectations carry the rate'),
    node('Forward guidance is a rate'),
    node('The author likes 1979'),
  ],
  edges: [
    { prerequisite: 'Rates are set, not cleared', dependent: 'Expectations carry the rate', basis: 'b' },
    { prerequisite: 'Expectations carry the rate', dependent: 'Forward guidance is a rate', basis: 'b' },
    { prerequisite: 'Rates are set, not cleared', dependent: 'The author likes 1979', basis: 'b' },
  ],
  mentions: [],
  joined: 1,
  dropped: [],
});

const verdict = (name: string, over: Partial<ConceptVerdictReport> = {}): ConceptVerdictReport => ({
  name,
  verdict: 'keep',
  separatingQuestion: 'If the bank signals cuts next year, does a rate held today still loosen conditions?',
  costIfWrong: 'You read a held rate as tight policy and misjudge a bond position before the cut.',
  reason: 'Both tests pass.',
  ...over,
});

const names = (result: ProposedChain | null) => result?.nodes.map((n) => n.name) ?? [];

describe('a concept judged keep', () => {
  it('stays, carrying the judge’s question, cost and verdict', () => {
    const result = applyVerdicts(chain(), [
      verdict('Expectations carry the rate'),
      verdict('Forward guidance is a rate'),
      verdict('The author likes 1979', { verdict: 'drop', reason: 'about the reading' }),
    ]);
    const kept = result?.nodes.find((n) => n.name === 'Expectations carry the rate');
    expect(kept).toMatchObject({
      verdict: 'keep',
      separatingQuestion: expect.stringContaining('does a rate held today'),
      costIfWrong: expect.stringContaining('bond position'),
    });
  });

  it('is dropped when the judge cannot name a concrete cost', () => {
    const result = applyVerdicts(chain(), [
      verdict('Expectations carry the rate'),
      verdict('Forward guidance is a rate', { costIfWrong: 'It is useful to know.' }),
      verdict('The author likes 1979', { separatingQuestion: null }),
    ]);
    expect(names(result)).toEqual(['Rates are set, not cleared', 'Expectations carry the rate']);
    expect(result?.dropped).toEqual([
      { name: 'Forward guidance is a rate', reason: DROP_REASONS.incomplete },
      { name: 'The author likes 1979', reason: DROP_REASONS.incomplete },
    ]);
  });
});

describe('a concept judged weak', () => {
  it('stays on the list to approve, marked weak', () => {
    const result = applyVerdicts(chain(), [
      verdict('Expectations carry the rate'),
      verdict('Forward guidance is a rate', { verdict: 'weak' }),
      verdict('The author likes 1979', { verdict: 'drop' }),
    ]);
    expect(result?.nodes.find((n) => n.name === 'Forward guidance is a rate')?.verdict).toBe('weak');
  });

  it('survives the trip back from the approval form, and so reaches the table', () => {
    const result = applyVerdicts(chain(), [
      verdict('Expectations carry the rate', { verdict: 'weak' }),
      verdict('Forward guidance is a rate'),
      verdict('The author likes 1979', { verdict: 'drop' }),
    ])!;
    const back = approvedChainSchema.parse(JSON.parse(JSON.stringify(result)));
    expect(back.nodes.find((n) => n.name === 'Expectations carry the rate')).toMatchObject({
      verdict: 'weak',
      separatingQuestion: expect.stringContaining('does a rate held today'),
      costIfWrong: expect.stringContaining('bond position'),
    });
  });
});

describe('a concept judged drop', () => {
  it('never appears, and its reason is in dropped', () => {
    const result = applyVerdicts(chain(), [
      verdict('Expectations carry the rate'),
      verdict('Forward guidance is a rate'),
      verdict('The author likes 1979', { verdict: 'drop', reason: 'about the reading' }),
    ]);
    expect(names(result)).not.toContain('The author likes 1979');
    expect(result?.edges.some((e) => e.dependent === 'The author likes 1979')).toBe(false);
    expect(result?.dropped).toContainEqual({
      name: 'The author likes 1979',
      reason: `${DROP_REASONS.judged}: about the reading`,
    });
  });

  it('takes with it a concept that only hung from it', () => {
    const result = applyVerdicts(chain(), [
      verdict('Expectations carry the rate', { verdict: 'drop' }),
      verdict('Forward guidance is a rate'),
      verdict('The author likes 1979'),
    ]);
    expect(names(result)).toEqual(['Rates are set, not cleared', 'The author likes 1979']);
    expect(result?.dropped).toContainEqual({
      name: 'Forward guidance is a rate',
      reason: DROP_REASONS.unplaced,
    });
  });

  it('counts a concept the judge said nothing about as dropped', () => {
    const result = applyVerdicts(chain(), [verdict('Expectations carry the rate')]);
    expect(names(result)).toEqual(['Rates are set, not cleared', 'Expectations carry the rate']);
    expect(result?.dropped).toContainEqual({
      name: 'The author likes 1979',
      reason: DROP_REASONS.unjudged,
    });
  });

  it('leaves nothing to propose when every new concept is dropped', async () => {
    const judge: ConceptJudge = async ({ concepts }) => ({
      ok: true,
      verdicts: concepts.map((c) => verdict(c.name, { verdict: 'drop' })),
    });
    const result = await judgeNoteChain(judge, {
      subject: 'Economics',
      readingTitle: 'A reading',
      note: 'A note.',
      chain: chain(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'nothing-left' });
  });
});

describe('the judging call', () => {
  it('is asked only about the new concepts, once for the note', async () => {
    const judge = vi.fn<ConceptJudge>(async ({ concepts }) => ({
      ok: true,
      verdicts: concepts.map((c) => verdict(c.name)),
    }));
    await judgeNoteChain(judge, {
      subject: 'Economics',
      readingTitle: 'A reading',
      note: 'A note.',
      chain: chain(),
    });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0].concepts.map((c) => c.name)).toEqual([
      'Expectations carry the rate',
      'Forward guidance is a rate',
      'The author likes 1979',
    ]);
  });

  it('failing is an error, not a pass', async () => {
    const judge: ConceptJudge = async () => ({ ok: false, detail: 'cut off' });
    const result = await judgeNoteChain(judge, {
      subject: 'Economics',
      readingTitle: 'A reading',
      note: 'A note.',
      chain: chain(),
    });
    expect(result).toEqual({ ok: false, reason: 'error', detail: 'cut off' });
  });

  it('sends the shared node test and reads the three verdicts back', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'report_verdicts',
          input: {
            verdicts: [
              {
                name: 'Expectations carry the rate',
                verdict: 'weak',
                separating_question: 'Does a held rate loosen conditions if cuts are signalled?',
                cost_if_wrong: 'You misjudge a bond position ahead of the cut.',
                reason: 'Thin.',
              },
              { name: 'The author likes 1979', verdict: 'drop', reason: 'About the reading.' },
              { name: 'Something else', verdict: 'maybe', reason: 'Not a verdict.' },
            ],
          },
        },
      ],
      usage: undefined,
    });
    const onSpend = vi.fn();
    const judge = anthropicConceptJudge({ client: { messages: { create } } as never, onSpend });
    const result = await judge({
      subject: 'Economics',
      readingTitle: 'A reading',
      note: 'A note.',
      concepts: [node('Expectations carry the rate'), node('The author likes 1979')],
    });

    expect((create.mock.calls[0][0] as { system: string }).system).toContain(NODE_RULE);
    expect(onSpend).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      verdicts: [
        {
          name: 'Expectations carry the rate',
          verdict: 'weak',
          separatingQuestion: 'Does a held rate loosen conditions if cuts are signalled?',
          costIfWrong: 'You misjudge a bond position ahead of the cut.',
          reason: 'Thin.',
        },
        {
          name: 'The author likes 1979',
          verdict: 'drop',
          separatingQuestion: null,
          costIfWrong: null,
          reason: 'About the reading.',
        },
      ],
    });
  });
});
