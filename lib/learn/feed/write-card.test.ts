import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { MAX_SECTION_CHARS, cardPrompt, readCardReport, whyLine, writeCard, type CardToWrite } from './write-card';

/**
 * Writing a card, and reading the answer.
 *
 * The call itself is stubbed. What is tested is what happens to its answer: a
 * section the model says does not fit is dropped with its reason, a usable
 * summary makes the card ready, and the why line always names the field and
 * the reason, whatever the model said.
 */

const field = { name: 'Computing', scope: 'Machines that compute.' };

const interest: CardToWrite = {
  id: 'c1',
  reason: 'interest',
  themeName: 'Machine learning architecture',
  field,
  gap: null,
  article: 'Autoencoder',
  section: null,
  text: 'An autoencoder is a type of neural network used to learn efficient codings of unlabeled data.',
  depth: 'working',
};

const parts = {
  hook: 'A bottleneck of 30 numbers can rebuild a 784-pixel digit.',
  example: 'Fraud teams train one on normal transactions and flag the ones it rebuilds badly.',
  question: 'Why would a large rebuild error mark a transaction as unusual?',
  answer: 'The network only learned to compress normal data, so unusual inputs come back distorted.',
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

describe('reading the report', () => {
  it('makes the card ready with every part, whitespace collapsed', () => {
    expect(
      readCardReport({
        fit: 'It covers autoencoders.',
        matches: true,
        ...parts,
        summary: '  Autoencoders compress.\n Then rebuild. ',
      }),
    ).toEqual({ verdict: 'ready', ...parts, summary: 'Autoencoders compress. Then rebuild.' });
  });

  it('drops a section that does not fit, with the model sentence as the reason', () => {
    expect(
      readCardReport({ fit: 'It only defines the term.', matches: false, summary: null, hook: null, example: null }),
    ).toEqual({
      verdict: 'dropped',
      reason: 'It only defines the term.',
    });
  });

  it('drops a match with no summary, or one too long to be four sentences', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ...parts, summary: ' ' })).toMatchObject({ verdict: 'dropped' });
    expect(readCardReport({ fit: 'Fits.', matches: true, ...parts, summary: 'x'.repeat(1300) })).toMatchObject({
      verdict: 'dropped',
    });
  });

  it('drops a card with no hook or no example, since that is the old summary-only card', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ...parts, summary: 'S.', hook: null })).toEqual({
      verdict: 'dropped',
      reason: 'The report wrote no hook.',
    });
    expect(readCardReport({ fit: 'Fits.', matches: true, ...parts, summary: 'S.', example: '' })).toEqual({
      verdict: 'dropped',
      reason: 'The report wrote no example.',
    });
  });

  it('keeps the card but leaves off a question with no answer', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ...parts, summary: 'S.', answer: null })).toMatchObject({
      verdict: 'ready',
      question: null,
      answer: null,
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

  it('forces the report, records what it spent, and returns the summary with the why line', async () => {
    const { client, calls } = stubClient({
      content: [
        {
          type: 'tool_use',
          name: 'report_card',
          input: { fit: 'Covers autoencoders.', matches: true, summary: 'Autoencoders learn codings.', ...parts },
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
      summary: 'Autoencoders learn codings.',
      ...parts,
      why: 'You write about machine learning architecture (Computing).',
    });
    expect(spent).toEqual(['claude-sonnet-5']);
    expect(calls[0]).toMatchObject({ tool_choice: { type: 'tool', name: 'report_card' } });
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
