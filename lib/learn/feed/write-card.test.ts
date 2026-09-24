import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  MAX_IDEAS,
  MAX_SECTION_CHARS,
  cardPrompt,
  readCardReport,
  whyLine,
  writeCard,
  type CardToWrite,
} from './write-card';

/**
 * Writing the cards for one section, and reading the answer.
 *
 * The call itself is stubbed. What is tested is what happens to its answer: a
 * section the model says does not fit is dropped with its reason, each usable
 * idea becomes a card, and the why line always names the field and the reason,
 * whatever the model said.
 */

const field = { name: 'Computing', scope: 'Machines that compute.' };

const interest: CardToWrite = {
  id: 'c1',
  reason: 'interest',
  themeName: 'Machine learning architecture',
  aimName: null,
  field,
  gap: null,
  article: 'Autoencoder',
  section: null,
  text: 'An autoencoder is a type of neural network used to learn efficient codings of unlabeled data.',
  depth: 'working',
};

/** One idea as the model reports it. */
const reported = {
  name: 'Bottlenecks keep what matters',
  claim: 'Squeezing data through a small gap forces a network to keep only what matters.',
  context: 'An autoencoder is a neural network that squeezes its input into a few numbers and rebuilds it.',
  evidence: 'A bottleneck of 30 numbers can rebuild a 784-pixel digit.',
  why: 'The network is scored on the rebuild, so the few numbers it keeps are the ones that carry the most.',
  example: 'Fraud teams train one on normal transactions and flag the ones it rebuilds badly.',
  question: 'Why would a large rebuild error mark a transaction as unusual?',
  answer: 'The network only learned to compress normal data, so unusual inputs come back distorted.',
};

/** The same idea as the card stores it. */
const stored = {
  name: reported.name,
  takeaway: reported.claim,
  context: reported.context,
  hook: reported.evidence,
  summary: reported.why,
  example: reported.example,
  question: reported.question,
  answer: reported.answer,
};

describe('the why line', () => {
  it('names the theme mid-sentence and the field for interest', () => {
    expect(whyLine(interest)).toBe('You write about machine learning architecture (Computing).');
  });

  it('leaves a theme with a proper noun in it as written', () => {
    expect(whyLine({ ...interest, themeName: 'Reading Marx on value' })).toBe(
      'You write about Reading Marx on value (Computing).',
    );
  });

  it('says which gap it is', () => {
    expect(whyLine({ ...interest, reason: 'gap', themeName: null, gap: 'untested' })).toBe(
      'A field you write about but have never been tested in: Computing.',
    );
    expect(whyLine({ ...interest, reason: 'gap', themeName: null, gap: 'untouched' })).toBe(
      'A field you have never touched: Computing.',
    );
  });
});

describe('the why line for a goal', () => {
  it('names the goal the card was drawn for', () => {
    expect(
      whyLine({ ...interest, reason: 'goal', themeName: null, aimName: 'City design and urbanism ' }),
    ).toBe('For your goal: City design and urbanism.');
  });

  it('names it when the goal sits in no field', () => {
    expect(whyLine({ ...interest, reason: 'goal', themeName: null, aimName: 'Startup finance', field: null })).toBe(
      'For your goal: Startup finance.',
    );
  });
});

describe('reading the report', () => {
  it('makes a card for each idea, named by the columns it is stored in, whitespace collapsed', () => {
    const second = { ...reported, name: 'Rebuild error flags outliers', why: '  Unusual inputs\n rebuild badly. ' };
    expect(readCardReport({ fit: 'It covers autoencoders.', matches: true, ideas: [reported, second] })).toEqual({
      verdict: 'ready',
      ideas: [stored, { ...stored, name: 'Rebuild error flags outliers', summary: 'Unusual inputs rebuild badly.' }],
    });
  });

  it('drops a section that does not fit, with the model sentence as the reason', () => {
    expect(readCardReport({ fit: 'It only defines the term.', matches: false, ideas: null })).toEqual({
      verdict: 'dropped',
      reason: 'It only defines the term.',
    });
  });

  it('drops a match with no idea in it', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ideas: [] })).toEqual({
      verdict: 'dropped',
      reason: 'The report matched the section but wrote no idea.',
    });
  });

  it('leaves out an idea with a part missing or too long, and keeps the rest', () => {
    const report = readCardReport({
      fit: 'Fits.',
      matches: true,
      ideas: [{ ...reported, name: 'No evidence', evidence: ' ' }, { ...reported, why: 'x'.repeat(1000) }, reported],
    });
    expect(report).toEqual({ verdict: 'ready', ideas: [stored] });
  });

  it('says what was wrong when no idea was usable', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ideas: [{ ...reported, context: null }] })).toEqual({
      verdict: 'dropped',
      reason: 'No idea was usable: no context.',
    });
  });

  it('keeps one of two ideas with the same name, and no more than the cap', () => {
    const many = Array.from({ length: MAX_IDEAS + 2 }, (_, index) => ({ ...reported, name: `Idea ${index}` }));
    const report = readCardReport({ fit: 'Fits.', matches: true, ideas: [reported, { ...reported, name: reported.name.toUpperCase() }, ...many] });
    expect(report.verdict === 'ready' && report.ideas.map((idea) => idea.name)).toEqual([
      reported.name,
      'Idea 0',
      'Idea 1',
    ]);
  });

  it('keeps the card but leaves off a question with no answer', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ideas: [{ ...reported, answer: null }] })).toEqual({
      verdict: 'ready',
      ideas: [{ ...stored, question: null, answer: null }],
    });
  });

  it('drops a report that does not match its schema', () => {
    expect(readCardReport({ matches: 'yes' })).toEqual({
      verdict: 'dropped',
      reason: 'The report did not match its schema.',
    });
  });
});

describe('the prompt', () => {
  it('names the target, the article and the lead, and carries the text', () => {
    const text = cardPrompt(interest);
    expect(text).toContain('Machine learning architecture');
    expect(text).toContain('Article: Autoencoder');
    expect(text).toContain('Section: the lead');
    expect(text).toContain(interest.text);
    expect(text).toContain('past the introduction');
    expect(text).toContain('They have met no ideas close to this section yet.');
  });

  it('lists the ideas already met, so the call writes no card for them', () => {
    const text = cardPrompt({
      ...interest,
      known: [{ name: 'Demand fails before cash', claim: 'Startups run out of demand before money.' }],
    });
    expect(text).toContain('Ideas they have already met, which get no card:');
    expect(text).toContain('- Demand fails before cash: Startups run out of demand before money.');
  });

  it('says so when a long section is cut', () => {
    const text = cardPrompt({ ...interest, text: 'a'.repeat(MAX_SECTION_CHARS + 10) });
    expect(text).toContain(`first ${MAX_SECTION_CHARS} characters`);
    expect(text).not.toContain('a'.repeat(MAX_SECTION_CHARS + 1));
  });
});

describe('the call', () => {
  function stubClient(reply: unknown): { client: Anthropic; calls: unknown[] } {
    const calls: unknown[] = [];
    const client = {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return reply;
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  const usage = { input_tokens: 900, output_tokens: 150 };

  it('forces the report, records what it spent, and returns the ideas with the why line', async () => {
    const { client, calls } = stubClient({
      content: [
        {
          type: 'tool_use',
          name: 'report_ideas',
          input: { fit: 'Covers autoencoders.', matches: true, ideas: [reported] },
        },
      ],
      stop_reason: 'tool_use',
      usage,
    });
    const spent: string[] = [];
    const result = await writeCard({
      card: interest,
      anthropicApiKey: 'unused',
      client,
      onSpend: (report) => spent.push(report.model),
    });
    expect(result).toEqual({
      outcome: 'ready',
      ideas: [stored],
      why: 'You write about machine learning architecture (Computing).',
    });
    expect(spent).toEqual(['claude-sonnet-5']);
    expect(calls[0]).toMatchObject({ tool_choice: { type: 'tool', name: 'report_ideas' } });
  });

  it('drops the pick, and still records the spend, when there is no report', async () => {
    const { client } = stubClient({ content: [{ type: 'text', text: 'Looks fine.' }], stop_reason: 'end_turn', usage });
    const spent: string[] = [];
    const result = await writeCard({
      card: interest,
      anthropicApiKey: 'unused',
      client,
      onSpend: (report) => spent.push(report.model),
    });
    expect(result).toMatchObject({ outcome: 'dropped' });
    expect(spent).toHaveLength(1);
  });

  it('leaves the pick to try again when the call itself fails', async () => {
    const client = {
      messages: {
        create: async () => {
          throw new Error('socket hang up');
        },
      },
    } as unknown as Anthropic;
    expect(await writeCard({ card: interest, anthropicApiKey: 'unused', client })).toEqual({
      outcome: 'failed',
      detail: 'socket hang up',
    });
  });

  it('drops a section with no text without calling the model', async () => {
    const { client, calls } = stubClient({});
    expect(await writeCard({ card: { ...interest, text: '  ' }, anthropicApiKey: 'unused', client })).toMatchObject({
      outcome: 'dropped',
    });
    expect(calls).toHaveLength(0);
  });
});
