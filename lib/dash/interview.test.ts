import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { DevComment } from '@/lib/comments/load';
import type { SpecInterview } from '@/lib/specs/interviews';
import {
  ASK_QUESTION_TOOL,
  asksForDraft,
  interviewBrief,
  nextInterviewQuestion,
  singleQuestion,
  type InterviewBackground,
} from './interview';

/**
 * Dash's questions in a spec interview (plan #1639), on a fake model: what
 * the first question is given to build on, one question a turn, the stop
 * after the last question allowed, and the request to draft.
 */

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

type Sent = {
  tools: { name: string }[];
  tool_choice: unknown;
  messages: { role: string; content: unknown }[];
};

function fakeModel(questions: string[]) {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (params: Sent) => {
          sent.push(structuredClone(params));
          const question = questions[sent.length - 1] ?? 'What else?';
          return {
            content: [{ type: 'tool_use', id: `q${sent.length}`, name: ASK_QUESTION_TOOL, input: { question } }],
            stop_reason: 'tool_use',
            usage: USAGE,
          };
        },
      },
    } as unknown as Anthropic,
  };
}

/** The text of the one message the model was sent. */
function brief(sent: Sent): string {
  const content = sent.messages[0]?.content;
  if (typeof content === 'string') return content;
  return (content as { text?: string }[]).map((block) => block.text ?? '').join('');
}

let at = 0;
function turn(author: 'claude' | 'me', body: string): DevComment {
  at += 1;
  return { id: `t${at}`, author, body, createdAt: new Date(Date.UTC(2026, 9, 7, 9, 0, at)).toISOString() };
}

/** `answered` questions each with an answer, then optionally one waiting. */
function interview(answered: number, options: { waiting?: boolean; draft?: boolean; limit?: number } = {}): SpecInterview {
  const turns: DevComment[] = [];
  for (let i = 1; i <= answered; i++) turns.push(turn('claude', `Question ${i}?`), turn('me', `Answer ${i}.`));
  if (options.waiting) turns.push(turn('claude', `Question ${answered + 1}?`));
  return {
    id: 'i1',
    module: 'shopping',
    status: 'open',
    questionLimit: options.limit ?? 12,
    draftRequestedAt: options.draft ? '2026-10-07T09:30:00Z' : null,
    summary: null,
    visionReviewId: null,
    specChangeId: null,
    startedAt: '2026-10-07T09:00:00Z',
    finishedAt: null,
    turns,
  };
}

const BACKGROUND: InterviewBackground = {
  label: 'Shopping',
  vision: 'Shopping keeps what I own and what I bought, so returns never lapse.',
  specs: [{ title: 'Returns', text: 'Every order with a return window gets a reminder three days before it closes.' }],
  notes: [
    {
      kind: 'bug',
      body: 'The receipt photo read the wrong total.',
      pagePath: '/shopping/inventory',
      createdAt: '2026-10-01T10:00:00Z',
    },
  ],
  opens: { days: 90, opens: 41, pages: 6, recorded: true },
};

const ask = (model: ReturnType<typeof fakeModel>, current: SpecInterview) =>
  nextInterviewQuestion({
    interview: current,
    background: BACKGROUND,
    today: '2026-10-07',
    anthropicApiKey: 'k',
    client: model.client,
  });

describe('the first question', () => {
  it('is asked from what is already written about the workspace', async () => {
    const model = fakeModel(['Your vision says returns never lapse: which shops do you most often return to?']);
    const asked = await ask(model, interview(0));

    expect(asked).toEqual({
      kind: 'question',
      question: 'Your vision says returns never lapse: which shops do you most often return to?',
      number: 1,
    });
    expect(model.sent).toHaveLength(1);
    expect(model.sent[0].tools.map((t) => t.name)).toEqual([ASK_QUESTION_TOOL]);
    expect(model.sent[0].tool_choice).toEqual({ type: 'auto' });
    const text = brief(model.sent[0]);
    expect(text).toContain('Shopping keeps what I own and what I bought');
    expect(text).toContain('Every order with a return window gets a reminder');
    expect(text).toContain('The receipt photo read the wrong total.');
    expect(text).toContain('41 times in the last 90 days, across 6 pages');
    expect(text).toContain('Nothing has been asked yet.');
    expect(text).toContain('This is question 1 of at most 12.');
  });

  it('is told plainly when nothing is written yet', () => {
    const text = interviewBrief(interview(0), {
      label: 'Shopping',
      vision: null,
      specs: [],
      notes: [],
      opens: { days: 90, opens: 0, pages: 0, recorded: false },
    });
    expect(text).toContain('It has no vision written yet.');
    expect(text).toContain('It has no spec yet.');
    expect(text).toContain('No notes have been filed on its pages lately.');
    expect(text).toContain('No page opens have been recorded yet');
  });
});

describe('every turn', () => {
  it('builds on the answers so far', async () => {
    const model = fakeModel(['Where do the receipts live today?']);
    await ask(model, interview(2));
    const text = brief(model.sent[0]);
    expect(text).toContain('Q1: Question 1?\nA1: Answer 1.');
    expect(text).toContain('Q2: Question 2?\nA2: Answer 2.');
    expect(text).toContain('This is question 3 of at most 12.');
  });

  it('keeps a single question when the model writes two', async () => {
    const model = fakeModel(['What do you buy most often? And where do the receipts go?']);
    const asked = await ask(model, interview(1));
    expect(asked).toMatchObject({ kind: 'question', question: 'What do you buy most often?', number: 2 });
  });

  it('fails rather than keeping something that is not a question', async () => {
    const model = fakeModel(['Tell me about your receipts.']);
    expect(await ask(model, interview(0))).toMatchObject({ kind: 'failed' });
  });

  it('asks nothing while a question waits for its answer', async () => {
    const model = fakeModel([]);
    expect(await ask(model, interview(3, { waiting: true }))).toEqual({ kind: 'stop', move: 'answer' });
    expect(model.sent).toHaveLength(0);
  });
});

describe('the end of the questions', () => {
  it('asks the twelfth as the last', async () => {
    const model = fakeModel(['What annoys you most about it now?']);
    const asked = await ask(model, interview(11));
    expect(asked).toMatchObject({ kind: 'question', number: 12 });
    expect(brief(model.sent[0])).toContain('This is question 12, the last you can ask.');
  });

  it('comes after the twelfth answer', async () => {
    const model = fakeModel([]);
    expect(await ask(model, interview(12))).toEqual({ kind: 'stop', move: 'draft' });
    expect(model.sent).toHaveLength(0);
  });

  it('comes at the limit the interview was started with', async () => {
    const model = fakeModel([]);
    expect(await ask(model, interview(5, { limit: 5 }))).toEqual({ kind: 'stop', move: 'draft' });
    expect(model.sent).toHaveLength(0);
  });

  it('comes when a draft is asked for', async () => {
    const model = fakeModel([]);
    expect(await ask(model, interview(3, { draft: true }))).toEqual({ kind: 'stop', move: 'draft' });
    expect(model.sent).toHaveLength(0);
  });
});

describe('asksForDraft', () => {
  it('reads an answer that only asks for the draft', () => {
    for (const said of ['Draft it now', 'draft it now.', 'Draft', "That's enough", 'stop', 'Please write it now', 'no more questions']) {
      expect(asksForDraft(said)).toBe(true);
    }
  });

  it('keeps anything more as an answer', () => {
    for (const said of [
      'I draft letters there every week',
      'Stop sending me reminders on Sundays',
      'Enough to cover the month',
      '',
    ]) {
      expect(asksForDraft(said)).toBe(false);
    }
  });
});

describe('singleQuestion', () => {
  it('takes off list markers and quotes and cuts after the first question', () => {
    expect(singleQuestion('1. "How often do you shop?" Then tell me more.')).toBe('How often do you shop?');
    expect(singleQuestion('  Where   do\nthe receipts live?  ')).toBe('Where do the receipts live?');
  });

  it('finds no question in a statement', () => {
    expect(singleQuestion('Thanks for that.')).toBeNull();
  });
});
