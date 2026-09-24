import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { articleKey, describeTarget, nameMaterial, readNamed } from './name-material';
import type { FeedTarget } from './targets';

/**
 * Naming the sections to read, and reading the answer.
 *
 * The call itself is stubbed. What is tested is what happens to its answer:
 * titles the person already has are refused, repeats are dropped, a blank
 * section means the lead, and a reply that is not a report says why.
 */

const field = { id: 'f', slug: 'economics', name: 'Economics', scope: 'Markets and money.', domain: 'Social sciences' };

const interest: FeedTarget = {
  reason: 'interest',
  theme: { id: 't', name: 'Central bank design', about: 'How rate-setting bodies are built.', strength: 4, fieldId: 'f' },
  field,
};

describe('reading the named sections', () => {
  it('keeps up to three new articles, trims them, and treats a blank section as the lead', () => {
    const result = readNamed(
      {
        picks: [
          { article: ' Inflation ', section: 'Causes', basis: 'Explains the mechanism.' },
          { article: 'inflation', section: 'History', basis: 'A repeat.' },
          { article: 'Monetary policy', section: '  ', basis: 'The overview.' },
          { article: 'Taylor rule', section: null, basis: 'The rule itself.' },
          { article: 'Central bank', section: 'History', basis: 'A fourth.' },
        ],
      },
      new Set(),
    );
    expect(result).toEqual({
      ok: true,
      named: [
        { article: 'Inflation', section: 'Causes', basis: 'Explains the mechanism.' },
        { article: 'Monetary policy', section: null, basis: 'The overview.' },
        { article: 'Taylor rule', section: null, basis: 'The rule itself.' },
      ],
    });
  });

  it('refuses articles the person already has, compared without case or underscores', () => {
    const result = readNamed(
      { picks: [{ article: 'Monetary_policy', section: null, basis: 'Again.' }] },
      new Set([articleKey('monetary policy')]),
    );
    expect(result).toEqual({ ok: false, detail: 'The call named nothing new to read.' });
  });

  it('says so when the report does not match its schema', () => {
    expect(readNamed({ picks: 'Inflation' }, new Set())).toMatchObject({ ok: false });
  });
});

describe('describing the target', () => {
  it('names the theme and its field for an interest target', () => {
    const text = describeTarget(interest);
    expect(text).toContain('Central bank design');
    expect(text).toContain('Economics (Social sciences)');
  });

  it('says which gap it is', () => {
    expect(describeTarget({ reason: 'gap', gap: 'untested', field })).toContain('never been tested in');
    expect(describeTarget({ reason: 'gap', gap: 'untouched', field })).toContain('never written about or studied');
  });

  it('gives a goal in its own words, with where it sits', () => {
    const goal = { id: 'g', name: 'Startup finance', about: 'FP&A for a seed-stage company', depth: 'working' as const };
    const placed = describeTarget({ reason: 'goal', goal: { ...goal, field, domain: null } });
    expect(placed).toContain('A goal they set themselves: Startup finance.');
    expect(placed).toContain('What they mean by it: FP&A for a seed-stage company');
    expect(placed).toContain('Economics (Social sciences)');
    expect(describeTarget({ reason: 'goal', goal: { ...goal, field: null, domain: 'Social sciences' } })).toContain(
      'It covers a whole domain: Social sciences.',
    );
    expect(describeTarget({ reason: 'goal', goal: { ...goal, about: null, field: null, domain: null } })).toBe(
      'A goal they set themselves: Startup finance.\nIt is not placed in one field; work from its wording.',
    );
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

  const usage = { input_tokens: 400, output_tokens: 120 };

  it('forces the report, records what it spent, and returns the picks', async () => {
    const { client, calls } = stubClient({
      content: [
        {
          type: 'tool_use',
          name: 'report_reading',
          input: { picks: [{ article: 'Inflation', section: 'Causes', basis: 'Why prices rise.' }] },
        },
      ],
      stop_reason: 'tool_use',
      usage,
    });
    const spent: string[] = [];
    const result = await nameMaterial({
      target: interest,
      depth: {
        depth: 'advanced',
        known: ['Inflation: Causes'],
        review: ['Money: Functions'],
        tooHard: ['Monetary base: Measurement'],
      },
      avoid: ['Money'],
      anthropicApiKey: 'unused',
      client,
      onSpend: (report) => spent.push(report.model),
    });
    expect(result).toMatchObject({ ok: true, named: [{ article: 'Inflation' }] });
    expect(spent).toEqual(['claude-sonnet-5']);
    expect(calls[0]).toMatchObject({ tool_choice: { type: 'tool', name: 'report_reading' } });
    expect(JSON.stringify(calls[0])).toContain('- Money');
    // The swipes reach the call: what they know is gone past, what they want
    // to work on is come at again.
    expect(JSON.stringify(calls[0])).toContain('go past these:\\n- Inflation: Causes');
    expect(JSON.stringify(calls[0])).toContain('- Money: Functions');
    // The cards rated too hard reach it too, with the instruction to go easier.
    expect(JSON.stringify(calls[0])).toContain('easier than these:\\n- Monetary base: Measurement');
    expect(JSON.stringify(calls[0])).toContain('advanced student');
  });

  it('records the spend and says why when there is no report', async () => {
    const { client } = stubClient({ content: [{ type: 'text', text: 'Try Inflation.' }], stop_reason: 'end_turn', usage });
    const spent: string[] = [];
    const result = await nameMaterial({
      target: interest,
      depth: { depth: 'working', known: [], review: [], tooHard: [] },
      avoid: [],
      anthropicApiKey: 'unused',
      client,
      onSpend: (report) => spent.push(report.model),
    });
    expect(result).toMatchObject({ ok: false });
    expect(spent).toHaveLength(1);
  });
});
