import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  MAX_IDEAS,
  MAX_SECTION_CHARS,
  cardPrompt,
  fitToCap,
  readCardReport,
  whyLine,
  describePick,
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
  mentions: [],
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
  it('names the phrase and the card it was asked for on (plan #1057)', () => {
    const asked = { ...interest, reason: 'asked' as const, themeName: null, field: null, askedPhrase: 'tree search' };
    expect(whyLine({ ...asked, askedOn: 'AlphaGo beat Lee Sedol' })).toBe(
      'You asked for a card on “tree search” from AlphaGo beat Lee Sedol.',
    );
    expect(whyLine(asked)).toBe('You asked for a card on “tree search”.');
    expect(describePick({ ...asked, askedOn: 'AlphaGo beat Lee Sedol' })).toContain(
      'they met the phrase "tree search" on a card about AlphaGo beat Lee Sedol',
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

  it('keeps the mentions the card really uses, and drops the rest (plan #1056)', () => {
    const report = readCardReport({
      fit: 'Fits.',
      matches: true,
      ideas: [
        {
          ...reported,
          mentions: [
            { phrase: 'Neural  network', why: 'What does the squeezing.' },
            { phrase: 'rebuild error', why: 'Not in the card.' },
            { phrase: reported.name, why: 'The card itself.' },
            { phrase: 'neural network', why: 'Said twice.' },
            { phrase: 'bottleneck' },
          ],
        },
      ],
    });
    expect(report.verdict === 'ready' && report.ideas[0].mentions).toEqual([
      { phrase: 'Neural network', why: 'What does the squeezing.' },
      { phrase: 'bottleneck', why: '' },
    ]);
  });

  it('drops a report that does not match its schema, naming the field', () => {
    expect(readCardReport({ matches: 'perhaps' })).toEqual({
      verdict: 'dropped',
      reason: 'The report did not match its schema (matches).',
    });
  });

  it('reads ideas sent back as a JSON string', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ideas: JSON.stringify([reported]) })).toEqual({
      verdict: 'ready',
      ideas: [stored],
    });
  });

  it('reads one idea sent as an object instead of a list', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ideas: reported })).toEqual({
      verdict: 'ready',
      ideas: [stored],
    });
  });

  it('reads matches sent as a word, and a missing fit', () => {
    expect(readCardReport({ fit: null, matches: 'true', ideas: [reported] })).toEqual({
      verdict: 'ready',
      ideas: [stored],
    });
  });

  it('reads mentions sent back as a JSON string', () => {
    const report = readCardReport({
      fit: 'Fits.',
      matches: true,
      ideas: [{ ...reported, mentions: JSON.stringify([{ phrase: 'neural network', why: 'What squeezes.' }]) }],
    });
    expect(report.verdict === 'ready' && report.ideas[0].mentions).toEqual([
      { phrase: 'neural network', why: 'What squeezes.' },
    ]);
  });

  it('reads a part sent as a list of sentences as one paragraph, and a number as missing', () => {
    expect(readCardReport({ fit: 'Fits.', matches: true, ideas: [{ ...reported, why: ['One.', 'Two.'] }] })).toEqual({
      verdict: 'ready',
      ideas: [{ ...stored, summary: 'One. Two.' }],
    });
    expect(readCardReport({ fit: 'Fits.', matches: true, ideas: [{ ...reported, evidence: 42 }] })).toEqual({
      verdict: 'dropped',
      reason: 'No idea was usable: no evidence.',
    });
  });

  it('keeps a card whose evidence runs a sentence past its cap, cut at the sentence', () => {
    const first = `A bottleneck of 30 numbers rebuilds a 784-pixel digit with ${'little loss, '.repeat(20)}in tests.`;
    const report = readCardReport({
      fit: 'Fits.',
      matches: true,
      ideas: [{ ...reported, evidence: `${first} A second sentence takes it over the limit of four hundred characters by a margin.` }],
    });
    expect(first.length).toBeLessThan(400);
    expect(report).toEqual({ verdict: 'ready', ideas: [{ ...stored, hook: first }] });
  });
});

describe('cutting a part to its cap', () => {
  it('leaves a part within its cap alone', () => {
    expect(fitToCap('One. Two.', 9)).toBe('One. Two.');
  });

  it('keeps the whole sentences that fit', () => {
    expect(fitToCap('First one. Second one. Third one.', 25)).toBe('First one. Second one.');
  });

  it('does not split a decimal or a lower-case run', () => {
    expect(fitToCap('It grew 3.5 percent. e.g. this. Then more.', 32)).toBe('It grew 3.5 percent. e.g. this.');
  });

  it('cuts after a closing quote', () => {
    expect(fitToCap('He said "stop." Then it stopped.', 20)).toBe('He said "stop."');
  });

  it('leaves a first sentence that is already over the cap, so the check still drops it', () => {
    const long = `${'word '.repeat(30)}end. Short.`;
    expect(fitToCap(long, 50)).toBe(long);
  });
});

/**
 * The September failures, replayed (plan #1495).
 *
 * Every Learn now card the writer dropped in September for its schema or its
 * length, one row each, read from learn.feed_cards on 3 October 2026. The
 * replies themselves were not stored, only the drop reason and, through
 * core.model_spend, how long each reply was, so each is rebuilt from what was
 * recorded:
 *
 * - a length drop is an idea whose part ran to the recorded length, written as
 *   sentences of ordinary length, the way the model writes them;
 * - a schema drop is a full report whose ideas came back as a JSON string. The
 *   recorded replies ran to seven hundred to eighteen hundred tokens, well under
 *   the budget, so the ideas were written and the report around them was
 *   refused; a list sent as a string is the refusal the job suggestions met
 *   with the same kind of call. Which shape each reply really had is not known;
 *   the reader now also takes a single object, a word for `matches`, and a
 *   missing `fit`, tested above, and names the field when it still refuses.
 *
 * Written before the reader was changed, none of these produced a card.
 */
const september: { at: string; reason: string; failed: string }[] = [
  { at: '09-23 05:17', reason: 'gap', failed: 'why 1242' },
  { at: '09-23 16:45', reason: 'gap', failed: 'why 1386' },
  { at: '09-23 16:45', reason: 'interest', failed: 'why 1232' },
  { at: '09-23 23:24', reason: 'interest', failed: 'why 1372' },
  { at: '09-23 23:24', reason: 'interest', failed: 'schema' },
  { at: '09-23 23:24', reason: 'interest', failed: 'evidence 417' },
  { at: '09-23 23:24', reason: 'interest', failed: 'evidence 456' },
  { at: '09-23 23:24', reason: 'interest', failed: 'schema' },
  { at: '09-23 23:24', reason: 'interest', failed: 'evidence 457' },
  { at: '09-23 23:24', reason: 'interest', failed: 'schema' },
  { at: '09-23 23:24', reason: 'interest', failed: 'schema' },
  { at: '09-23 23:24', reason: 'interest', failed: 'why 1320' },
  { at: '09-23 23:25', reason: 'gap', failed: 'schema' },
  { at: '09-23 23:25', reason: 'interest', failed: 'why 1382' },
  { at: '09-23 23:25', reason: 'interest', failed: 'schema' },
  { at: '09-23 23:25', reason: 'interest', failed: 'schema' },
  { at: '09-23 23:25', reason: 'interest', failed: 'evidence 455' },
  { at: '09-23 23:26', reason: 'interest', failed: 'why 1695' },
  { at: '09-23 23:26', reason: 'interest', failed: 'evidence 466' },
  { at: '09-23 23:41', reason: 'gap', failed: 'evidence 407' },
  { at: '09-23 23:41', reason: 'gap', failed: 'evidence 407' },
  { at: '09-23 23:41', reason: 'gap', failed: 'why 1299' },
  { at: '09-23 23:42', reason: 'gap', failed: 'why 1539' },
  { at: '09-24 17:41', reason: 'interest', failed: 'evidence 537' },
  { at: '09-24 17:42', reason: 'interest', failed: 'evidence 456' },
  { at: '09-24 17:43', reason: 'interest', failed: 'evidence 431' },
  { at: '09-24 17:43', reason: 'interest', failed: 'schema' },
  { at: '09-24 18:12', reason: 'interest', failed: 'schema' },
  { at: '09-26 21:41', reason: 'interest', failed: 'schema' },
  { at: '09-27 02:43', reason: 'interest', failed: 'schema' },
  { at: '09-27 02:44', reason: 'interest', failed: 'schema' },
  { at: '09-28 02:41', reason: 'video', failed: 'schema' },
  { at: '09-28 02:41', reason: 'video', failed: 'schema' },
  { at: '09-28 02:41', reason: 'video', failed: 'evidence 549' },
  { at: '09-28 02:42', reason: 'video', failed: 'schema' },
  { at: '09-28 03:41', reason: 'video', failed: 'evidence 441' },
  { at: '09-28 03:41', reason: 'video', failed: 'schema' },
  { at: '09-28 03:41', reason: 'video', failed: 'schema' },
  { at: '09-28 03:42', reason: 'video', failed: 'schema' },
  { at: '09-28 16:41', reason: 'video', failed: 'schema' },
  { at: '09-28 16:41', reason: 'video', failed: 'schema' },
  { at: '09-28 20:41', reason: 'video', failed: 'schema' },
  { at: '09-28 20:41', reason: 'video', failed: 'schema' },
  { at: '09-28 20:42', reason: 'video', failed: 'schema' },
  { at: '09-28 20:42', reason: 'video', failed: 'schema' },
  { at: '09-28 21:41', reason: 'video', failed: 'evidence 523' },
  { at: '09-28 21:41', reason: 'video', failed: 'schema' },
  { at: '09-28 21:41', reason: 'video', failed: 'schema' },
  { at: '09-28 22:41', reason: 'video', failed: 'schema' },
  { at: '09-28 22:41', reason: 'video', failed: 'schema' },
  { at: '09-28 23:41', reason: 'video', failed: 'schema' },
  { at: '09-28 23:41', reason: 'video', failed: 'schema' },
];

/** A part of exactly `length` characters, in sentences of about 120 to 180. */
function sentencesOf(length: number, seed: number): string {
  const sentences: string[] = [];
  let total = -1;
  for (let index = 0; total < length; index += 1) {
    const words = 18 + ((seed + index * 7) % 10);
    sentences.push(`Measured result ${index + 1} ${'held across the trial '.repeat(words / 4)}cohort.`);
    total += sentences[sentences.length - 1].length + 1;
  }
  const text = sentences.join(' ');
  return `${text.slice(0, length - 1).trimEnd()}.`.padEnd(length, '.');
}

function replay(row: (typeof september)[number], index: number): unknown {
  if (row.failed === 'schema') return { fit: 'It serves the pick.', matches: true, ideas: JSON.stringify([reported]) };
  const [part, length] = row.failed.split(' ');
  return { fit: 'It serves the pick.', matches: true, ideas: [{ ...reported, [part]: sentencesOf(Number(length), index) }] };
}

describe('the September failures, replayed (plan #1495)', () => {
  it('rebuilds each part at the length that was recorded', () => {
    for (const [index, row] of september.entries()) {
      if (row.failed === 'schema') continue;
      const [part, length] = row.failed.split(' ');
      const idea = (replay(row, index) as { ideas: Record<string, string>[] }).ideas[0];
      expect(idea[part].length, row.at).toBe(Number(length));
    }
  });

  it('turns at least 30 of them into cards', () => {
    const kept = september.filter((row, index) => readCardReport(replay(row, index)).verdict === 'ready');
    expect(september).toHaveLength(52);
    expect(kept.length).toBeGreaterThanOrEqual(30);
    expect(kept).toHaveLength(52);
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

  it('asks for the report, records what it spent, and returns the ideas with the why line', async () => {
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
    expect(spent).toEqual(['claude-sonnet-5-5']);
    expect(calls[0]).toMatchObject({ tool_choice: { type: 'auto' } });
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

describe('a card from a video stretch (plan #1067)', () => {
  const video: CardToWrite = {
    id: 'v1',
    reason: 'video',
    themeName: null,
    aimName: null,
    field: null,
    gap: null,
    article: 'Cash flow in ten minutes',
    section: '0:30 to 2:30',
    text: 'So the thing about cash is that it runs out before profit does.',
    depth: null,
    video: { title: 'Cash flow in ten minutes', channel: 'A channel', point: 'Cash runs out before profit does.' },
    maxIdeas: 1,
  };

  it('tells the writer it is reading a transcript, with the video and the point', () => {
    const pick = describePick(video);
    expect(pick).toContain('"Cash flow in ten minutes" by A channel');
    expect(pick).toContain('The part worth a card: Cash runs out before profit does.');
    expect(pick).toContain('transcript of that part of the video');
    expect(cardPrompt(video)).toContain('Section: 0:30 to 2:30');
  });

  it('says where the card came from on the why line', () => {
    expect(whyLine(video)).toBe('From a video on your playlist.');
  });

  it('keeps one idea from the stretch', async () => {
    const second = { ...reported, name: 'Payment terms move cash', claim: 'Terms decide who holds the cash.' };
    const client = {
      messages: {
        create: async () => ({
          content: [{ type: 'tool_use', name: 'report_ideas', input: { fit: 'Fits.', matches: true, ideas: [reported, second] } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 900, output_tokens: 150 },
        }),
      },
    } as unknown as Anthropic;
    const result = await writeCard({ card: video, anthropicApiKey: 'unused', client });
    expect(result).toMatchObject({ outcome: 'ready', why: 'From a video on your playlist.' });
    expect(result.outcome === 'ready' && result.ideas.map((idea) => idea.name)).toEqual([reported.name]);
  });
});
