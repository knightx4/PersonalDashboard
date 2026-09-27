import { describe, expect, it, vi } from 'vitest';
import { findPeople, type SeekerContext } from './model';
import { personKey } from './payload';

const seeker: SeekerContext = {
  name: 'Alex',
  goals: [{ written: '20 Sept 2026', body: 'I want to move from FP&A into strategic finance.' }],
  targetTitles: ['Strategic Finance'],
  resume: 'FP&A analyst at Acme. BA, State University.',
  writingStyle: null,
  banned: ['leverage'],
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

describe('findPeople', () => {
  it('carries on after a paused search, reports the cost of each round, and drops known people', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'searching' }], stop_reason: 'pause_turn', usage })
      .mockResolvedValueOnce({ content: [report], stop_reason: 'tool_use', usage });
    const spend: unknown[] = [];

    const result = await findPeople(
      { apiKey: 'k', client: { messages: { create } } as never, onSpend: (r) => spend.push(r) },
      { seeker, warm: [], known: ['Known Person'], taken: new Set([personKey('Known Person')]) },
    );

    expect(result).toMatchObject({ ok: true, suggestions: [{ personName: 'Dana Wu', company: 'Ramp' }] });
    expect(create).toHaveBeenCalledTimes(2);
    expect(spend).toHaveLength(2);
    const prompt = create.mock.calls[0][0];
    expect(prompt.tools[0]).toMatchObject({ type: 'web_search_20260209', max_uses: 6 });
    expect(prompt.system).toContain('"leverage"');
    expect(prompt.messages[0].content).toContain('Known Person');
    expect(prompt.messages[0].content).toContain('strategic finance');
  });

  it('says so when the search ends without a report', async () => {
    const create = vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn', usage });
    const result = await findPeople(
      { apiKey: 'k', client: { messages: { create } } as never },
      { seeker, warm: [], known: [], taken: new Set() },
    );
    expect(result).toEqual({ ok: false, error: 'The search ran but reported no people.' });
  });
});
