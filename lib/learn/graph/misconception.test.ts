import { describe, expect, it, vi } from 'vitest';
import { nameMisconception, repeatedWrongAnswer } from './misconception';
import type { ProbeRow } from './session';

/**
 * Detecting a position, as opposed to a slip.
 *
 * The detection is the part worth testing hardest, because a false positive
 * here writes a sentence about somebody's mind onto a node they will read for
 * months. Once is a mis-click; twice on the same answer is a belief; two
 * different wrong answers is not knowing, which is a different problem with a
 * different fix.
 */

let n = 0;
function probe(partial: Partial<ProbeRow> = {}): ProbeRow {
  return {
    id: `probe-${(n += 1)}`,
    conceptId: 'concept-1',
    question: 'A question about the claim.',
    options: ['It stays high', 'It returns to where it was', 'It falls further'],
    correctIndex: 1,
    reason: 'Because of the mechanism.',
    chosenIndex: null,
    weight: 0,
    masteryCheck: null,
    askedAt: '2026-09-13T09:00:00.000Z',
    ...partial,
  };
}

describe('spotting the same wrong answer twice', () => {
  it('finds it when the same option is picked twice', () => {
    const found = repeatedWrongAnswer([probe({ chosenIndex: 0 }), probe({ chosenIndex: 0 })]);
    expect(found).toMatchObject({ option: 'It stays high', times: 2 });
  });

  it('says nothing about a single miss', () => {
    // Once is a slip, a misread question, a mis-click.
    expect(repeatedWrongAnswer([probe({ chosenIndex: 0 })])).toBeNull();
  });

  it('says nothing when the two wrong answers are different', () => {
    // Not knowing, rather than believing something. A different problem, and
    // reading fixes this one.
    expect(
      repeatedWrongAnswer([probe({ chosenIndex: 0 }), probe({ chosenIndex: 2 })]),
    ).toBeNull();
  });

  it('ignores correct answers entirely', () => {
    expect(
      repeatedWrongAnswer([probe({ chosenIndex: 1 }), probe({ chosenIndex: 1 })]),
    ).toBeNull();
  });

  it('ignores questions that were never answered', () => {
    expect(repeatedWrongAnswer([probe(), probe()])).toBeNull();
  });

  it('matches on what was picked, not on where it sat', () => {
    // The options are written fresh for every question, so index 2 in March
    // and index 2 in April are different answers. Comparing indexes would name
    // a misconception nobody has.
    const march = probe({ options: ['Right', 'The wrong belief'], correctIndex: 0, chosenIndex: 1 });
    const april = probe({ options: ['The wrong belief', 'Right'], correctIndex: 1, chosenIndex: 0 });

    expect(repeatedWrongAnswer([march, april])).toMatchObject({
      option: 'The wrong belief',
      times: 2,
    });
  });

  it('picks the most repeated one when there are several', () => {
    const found = repeatedWrongAnswer([
      probe({ chosenIndex: 0 }),
      probe({ chosenIndex: 0 }),
      probe({ chosenIndex: 0 }),
      probe({ chosenIndex: 2 }),
      probe({ chosenIndex: 2 }),
    ]);
    expect(found).toMatchObject({ option: 'It stays high', times: 3 });
  });
});

describe('naming it', () => {
  function clientReturning(input: unknown) {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', name: 'name_misconception', input }],
      usage: { input_tokens: 200, output_tokens: 40 },
    });
    return { client: { messages: { create } } as never, create };
  }

  const ask = (client: unknown, onSpend?: (r: { model: string }) => void) =>
    nameMisconception({
      concept: 'The short-run tradeoff',
      claim: 'The tradeoff lasts only while expectations lag.',
      wrongAnswer: 'It stays high',
      questions: ['A question about the claim.'],
      anthropicApiKey: 'test',
      client: client as never,
      onSpend,
    });

  it('comes back with the sentence', async () => {
    const { client } = clientReturning({
      misconception: 'Believes the tradeoff is permanent rather than expectations-dependent.',
    });
    const result = await ask(client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.misconception).toContain('permanent');
  });

  it('runs on Haiku, the rarest call in the module', async () => {
    const { client, create } = clientReturning({ misconception: 'Believes something.' });
    await ask(client);
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });

  it('names nothing when the answers do not add up to a belief', async () => {
    // A made-up misconception is worse than none: it is a sentence about
    // somebody's mind that they will believe.
    const { client } = clientReturning({ misconception: '', unclear: true });
    const result = await ask(client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unclear');
  });

  it('names nothing when it came back empty', async () => {
    const { client } = clientReturning({ misconception: '   ' });
    const result = await ask(client);
    expect(result.ok).toBe(false);
  });

  it('reports what it cost', async () => {
    const reports: { model: string }[] = [];
    const { client } = clientReturning({ misconception: 'Believes something.' });
    await ask(client, (report) => reports.push(report));
    expect(reports).toHaveLength(1);
  });

  it('survives the call breaking', async () => {
    const broken = { messages: { create: vi.fn().mockRejectedValue(new Error('down')) } };
    const result = await ask(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });
});
