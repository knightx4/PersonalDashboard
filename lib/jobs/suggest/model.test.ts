import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { findPeople, type SeekerContext } from './model';
import { personKey } from './payload';
import { NO_PREFERENCES } from './preferences';

const seeker: SeekerContext = {
  name: 'Alex',
  goals: [{ written: '20 Sept 2026', body: 'I want to move from FP&A into strategic finance.' }],
  targetTitles: ['Strategic Finance'],
  resume: 'FP&A analyst at Acme. BA, State University.',
  writingStyle: null,
  banned: ['leverage'],
  excludedIndustries: [],
  preferences: NO_PREFERENCES,
};

const report = {
  type: 'tool_use',
  name: 'suggest_people',
  input: {
    suggestions: [
      {
        person_name: 'Dana Wu',
        person_title: 'Director of Strategic Finance',
        company: 'Ramp',
        source_url: 'https://ramp.com/team',
        search_query: 'Dana Wu Ramp',
        headline: 'Ask Dana Wu about strategic finance',
        why: 'Same university.',
        move: '1. Connect.',
        channel: 'linkedin_connect',
        message: 'Hi Dana, fellow State alum here.',
      },
      {
        person_name: 'Known Person',
        headline: 'x',
        why: 'x',
        move: 'x',
        channel: 'email',
        message: 'x',
      },
    ],
  },
};

const usage = { input_tokens: 100, output_tokens: 50 };

/**
 * A client whose stream().finalMessage() answers with what `create` returns,
 * so each test states its responses once and reads the requests off `create`.
 */
function streaming(create: (...args: unknown[]) => unknown) {
  return {
    messages: { stream: (request: unknown, options: unknown) => ({ finalMessage: () => create(request, options) }) },
  } as never;
}

describe('the time a search is given', () => {
  const input = { seeker, warm: [], known: [], taken: new Set<string>() };

  it('gives the call the time left before the deadline, without retries', async () => {
    const create = vi.fn().mockResolvedValue({ content: [report], stop_reason: 'tool_use', usage });
    const deadline = Date.now() + 200_000;
    await findPeople({ apiKey: 'k', client: streaming(create), deadline }, input);
    const options = create.mock.calls[0][1];
    expect(options.maxRetries).toBe(0);
    expect(options.timeout).toBeGreaterThan(180_000);
    expect(options.timeout).toBeLessThanOrEqual(185_000);
  });

  it('hands back the request to queue when the call runs out of time', async () => {
    const create = vi.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    const result = await findPeople(
      { apiKey: 'k', client: streaming(create), deadline: Date.now() + 200_000 },
      input,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.queue).toBe(create.mock.calls[0][0]);
  });

  it('queues without calling when too little time is left, and queues the forced report the same way', async () => {
    const none = vi.fn();
    const early = await findPeople(
      { apiKey: 'k', client: streaming(none), deadline: Date.now() + 30_000 },
      input,
    );
    expect(none).not.toHaveBeenCalled();
    expect(early).toMatchObject({ ok: false, queue: { model: 'claude-sonnet-5' } });

    let clock = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const create = vi.fn().mockImplementation(async () => {
      clock += 170_000;
      return { content: [{ type: 'text', text: 'searching' }], stop_reason: 'pause_turn', usage };
    });
    const late = await findPeople(
      { apiKey: 'k', client: streaming(create), deadline: clock + 200_000 },
      input,
    );
    spy.mockRestore();
    expect(create).toHaveBeenCalledTimes(1);
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.queue?.messages.at(-1)?.role).toBe('assistant');
  });
});

describe('findPeople', () => {
  it('forces the report after a paused search, reports the cost of each call, and drops known people', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'searching' }], stop_reason: 'pause_turn', usage })
      .mockResolvedValueOnce({ content: [report], stop_reason: 'tool_use', usage });
    const spend: unknown[] = [];

    const result = await findPeople(
      { apiKey: 'k', client: streaming(create), onSpend: (r) => spend.push(r) },
      { seeker, warm: [], known: ['Known Person'], taken: new Set([personKey('Known Person')]) },
    );

    expect(result).toMatchObject({ ok: true, suggestions: [{ personName: 'Dana Wu', company: 'Ramp' }] });
    expect(create).toHaveBeenCalledTimes(2);
    expect(spend).toHaveLength(2);
    const prompt = create.mock.calls[0][0];
    expect(prompt.tools[0]).toMatchObject({ type: 'web_search_20260209', max_uses: 5 });
    expect(prompt.tool_choice).toBeUndefined();
    const forced = create.mock.calls[1][0];
    // Asked for, not forced: the model thinks, and forcing a tool is not allowed alongside thinking.
    expect(forced.tool_choice).toBeUndefined();
    // A paused turn goes back as it is, with no extra ask after it.
    expect(forced.messages.at(-1).role).toBe('assistant');
    expect(prompt.system).toContain('"leverage"');
    expect(prompt.messages[0].content).toContain('Known Person');
    expect(prompt.messages[0].content).toContain('strategic finance');
  });

  it('asks for the report when the search ends in prose, and says so when none comes', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage });
    const result = await findPeople(
      { apiKey: 'k', client: streaming(create) },
      { seeker, warm: [], known: [], taken: new Set() },
    );
    expect(result).toEqual({ ok: false, error: 'The search ran but reported no people.' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages.at(-1)).toEqual({ role: 'user', content: 'Call suggest_people now with what you found.' });
  });

  it('asks again when the report is cut off at the token cap, rather than storing nothing', async () => {
    const cut = { ...report, input: {} };
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'found some' }, cut], stop_reason: 'max_tokens', usage })
      .mockResolvedValueOnce({ content: [report], stop_reason: 'tool_use', usage });
    const result = await findPeople(
      { apiKey: 'k', client: streaming(create) },
      { seeker, warm: [], known: [], taken: new Set() },
    );
    expect(result.ok && result.suggestions[0].personName).toBe('Dana Wu');
    const second = create.mock.calls[1][0];
    // The cut-off call is not sent back, and the ask says why.
    expect(second.messages.at(-2).content).toEqual([{ type: 'text', text: 'found some' }]);
    expect(second.messages.at(-1).content).toContain('cut off');
    expect(create.mock.calls[0][0].max_tokens).toBe(32_000);
  });

  it('reads a list the model sent back as a JSON string', async () => {
    const stringified = { ...report, input: { suggestions: JSON.stringify(report.input.suggestions) } };
    const create = vi.fn().mockResolvedValue({ content: [stringified], stop_reason: 'tool_use', usage });
    const result = await findPeople(
      { apiKey: 'k', client: streaming(create) },
      { seeker, warm: [], known: [], taken: new Set() },
    );
    expect(result).toMatchObject({ ok: true, suggestions: [{ personName: 'Dana Wu' }, { personName: 'Known Person' }] });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
