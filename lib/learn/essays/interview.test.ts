import { describe, expect, it, vi } from 'vitest';
import {
  answeredBrief,
  ANSWER_MAX,
  askNumber,
  describeBrief,
  editedBrief,
  newEssayBrief,
  nextField,
  openingAsk,
  PLAIN_ASKS,
  skippedBrief,
  usableAsk,
} from './interview';
import { askNextQuestion, INTERVIEW_SYSTEM } from './interview-model';
import { readBrief, readInterview, type EssayPin } from './model';

vi.mock('server-only', () => ({}));

/** The interview a new essay opens with (plan #1867). */

const goal: EssayPin = { kind: 'goal', id: 'g1', title: 'Monetary policy' };

describe('opening the interview', () => {
  it('asks the spec’s first question when nothing was pinned', () => {
    expect(openingAsk([])).toBe(PLAIN_ASKS.question);
  });

  it('names a finished goal in the first question', () => {
    expect(openingAsk([goal])).toBe('You finished your goal “Monetary policy”. What is the question about it you want to answer?');
  });

  it('starts a brief with the pin and the first question', () => {
    const brief = newEssayBrief([goal]);
    expect(readBrief(brief).pinned).toEqual([goal]);
    expect(readInterview(brief)).toEqual({ status: 'asking', field: 'question', ask: openingAsk([goal]) });
  });
});

describe('answering', () => {
  it('walks the five questions in order and numbers them', () => {
    expect(nextField('question')).toBe('claim');
    expect(nextField('origin')).toBe('change');
    expect(nextField('change')).toBeNull();
    expect(askNumber('reader')).toBe('Question 3 of 5');
  });

  it('keeps the answer as typed, keeps the pins, and moves to the next question', () => {
    const start = newEssayBrief([goal]);
    const after = answeredBrief(start, 'question', '  Why do rates move house prices?  ', {
      field: 'claim',
      ask: 'What is your answer?',
    });
    expect(readBrief(after)).toMatchObject({ question: 'Why do rates move house prices?', pinned: [goal] });
    expect(readInterview(after)).toEqual({ status: 'asking', field: 'claim', ask: 'What is your answer?' });
  });

  it('ends the interview after the fifth answer, with all five in the brief', () => {
    let brief: Record<string, unknown> = newEssayBrief([goal]);
    const answers = ['Q?', 'A claim.', 'My sister', 'A chart I saw', 'Prices falling while rates fell'];
    const fields = ['question', 'claim', 'reader', 'origin', 'change'] as const;
    fields.forEach((field, index) => {
      const next = nextField(field);
      brief = answeredBrief(brief, field, answers[index]!, next ? { field: next, ask: PLAIN_ASKS[next] } : null);
    });
    expect(readInterview(brief)).toEqual({ status: 'done' });
    expect(readBrief(brief)).toEqual({
      question: 'Q?',
      claim: 'A claim.',
      reader: 'My sister',
      origin: 'A chart I saw',
      change: 'Prices falling while rates fell',
      pinned: [goal],
    });
  });

  it('skips a question on a blank answer without clearing what was there', () => {
    const after = answeredBrief({ claim: 'Kept' }, 'claim', '   ', { field: 'reader', ask: PLAIN_ASKS.reader });
    expect(readBrief(after).claim).toBe('Kept');
  });

  it('cuts an answer at the limit', () => {
    const after = answeredBrief({}, 'origin', 'x'.repeat(ANSWER_MAX + 50), null);
    expect(readBrief(after).origin).toHaveLength(ANSWER_MAX);
  });

  it('skips the rest, keeping the answers', () => {
    const after = skippedBrief({ question: 'Q?', interview: { status: 'asking', field: 'claim', ask: 'A?' } });
    expect(readInterview(after)).toEqual({ status: 'skipped' });
    expect(readBrief(after).question).toBe('Q?');
  });

  it('edits one line and leaves the rest', () => {
    const after = editedBrief({ question: 'Q?', pinned: [goal], interview: { status: 'done' } }, 'reader', ' Anyone ');
    expect(readBrief(after)).toMatchObject({ question: 'Q?', reader: 'Anyone', pinned: [goal] });
    expect(readInterview(after)).toEqual({ status: 'done' });
  });
});

describe("Dash's question", () => {
  it('takes one plain question', () => {
    expect(usableAsk(' “Who would argue with that?” ')).toBe('Who would argue with that?');
  });

  it('refuses praise, two questions, a statement and a long reply', () => {
    expect(usableAsk('Great point. Who would argue with that?')).toBeNull();
    expect(usableAsk('That sounds interesting: who is it for?')).toBeNull();
    expect(usableAsk('Who is it for? And why them?')).toBeNull();
    expect(usableAsk('Tell me who it is for.')).toBeNull();
    expect(usableAsk(`${'Why '.repeat(80)}?`)).toBeNull();
  });

  it('describes the brief so far and the kind of question to ask', () => {
    const text = describeBrief(readBrief({ question: 'Why?', pinned: [goal] }), 'claim');
    expect(text).toContain('- Goal: Monetary policy');
    expect(text).toContain('Why?');
    expect(text).toContain(`Next, ask this kind of question: ${PLAIN_ASKS.claim}`);
  });

  function clientReplying(text: string) {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 500, output_tokens: 20 },
    });
    return { client: { messages: { create } } as never, create };
  }

  it('asks Sonnet once with the same system prompt every time, and reports the spend', async () => {
    const { client, create } = clientReplying('Who will read this first?');
    const spend = vi.fn();
    const result = await askNextQuestion({
      brief: readBrief({ question: 'Why?' }),
      field: 'reader',
      anthropicApiKey: 'k',
      client,
      onSpend: spend,
    });
    expect(result).toEqual({ ok: true, ask: 'Who will read this first?' });
    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0]![0];
    expect(sent.system[0].text).toBe(INTERVIEW_SYSTEM);
    expect(sent.messages[0].content).toContain('Why?');
    expect(spend).toHaveBeenCalledTimes(1);
  });

  it('says so when the reply breaks the rules', async () => {
    const { client } = clientReplying('What a fascinating question! Who is it for?');
    const result = await askNextQuestion({ brief: readBrief({}), field: 'reader', anthropicApiKey: 'k', client });
    expect(result.ok).toBe(false);
  });
});
