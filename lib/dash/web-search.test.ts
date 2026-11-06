import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import { HAIKU, OPUS, SONNET } from '@/lib/core/models';
import { costMicrosFor, type SpendReport } from '@/lib/core/spend/pricing';
import { PEOPLE_WEB_RULES, peopleServerTools } from '@/lib/you/people-actions';
import { answerQuestion, ASK_VOICE, scopedVoice } from './ask';
import { dashWebSearch, MAX_WEB_SEARCHES, searchedPages, WEB_RULES, webCitation } from './web-search';

type Sent = { tools: { name: string; type?: string; max_uses?: number }[]; system: { text: string }[] };

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function stubClient(replies: unknown[]) {
  const sent: Sent[] = [];
  const client = {
    messages: {
      create: async (params: Sent) => {
        sent.push(structuredClone(params));
        const next = replies[sent.length - 1];
        if (!next) throw new Error('no reply scripted');
        return next;
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const JEV = 'https://www.jev.example/about';

/** A response that searched once and found two pages. */
const SEARCHED = {
  content: [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Jev' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 's1',
      content: [
        { type: 'web_search_result', url: JEV, title: 'About Jev', encrypted_content: 'x' },
        { type: 'web_search_result', url: 'https://news.example/jev', title: 'Jev raises', encrypted_content: 'y' },
      ],
    },
  ],
  stop_reason: 'pause_turn',
  usage: { ...USAGE, server_tool_use: { web_search_requests: 1 } },
};

describe('dashWebSearch', () => {
  it('gives Opus and Sonnet the filtering search and Haiku the basic one, capped at MAX_WEB_SEARCHES', () => {
    expect(dashWebSearch(SONNET)).toEqual({ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_WEB_SEARCHES });
    expect(dashWebSearch(OPUS)).toMatchObject({ type: 'web_search_20260209' });
    expect(dashWebSearch(HAIKU)).toMatchObject({ type: 'web_search_20250305', max_uses: MAX_WEB_SEARCHES });
  });
});

describe('webCitation and searchedPages', () => {
  it('cites a page under the table web, its title with its site, opening at its address', () => {
    expect(webCitation(JEV, '  About   Jev ')).toEqual({ table: 'web', ref: JEV, title: 'About Jev (jev.example)', href: JEV });
    expect(webCitation('https://jev.example/', '')).toMatchObject({ title: 'jev.example' });
    expect(webCitation('javascript:alert(1)', 'x')).toBeNull();
    expect(webCitation('not a url', 'x')).toBeNull();
  });

  it('reads the pages a search returned and the pages text cited, and nothing from a failed search', () => {
    const pages = searchedPages([
      ...SEARCHED.content,
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      {
        type: 'text',
        citations: [{ type: 'web_search_result_location', url: 'https://wiki.example/Jev', title: 'Jev', cited_text: 'Jev is' }],
      },
    ]);
    expect(pages.map((p) => p.ref)).toEqual([JEV, 'https://news.example/jev', 'https://wiki.example/Jev']);
  });
});

describe('Ask Dash with web search (plan #2861)', () => {
  it('offers the search on every answer with the rules for it, but not on a question kept to one workspace', () => {
    expect(ASK_VOICE.serverTools).toEqual([dashWebSearch(SONNET)]);
    expect(ASK_VOICE.system).toContain(WEB_RULES);
    expect(ASK_VOICE.system).not.toContain('You cannot browse the web');
    expect(scopedVoice(null, HAIKU).serverTools).toEqual([dashWebSearch(HAIKU)]);
    expect(scopedVoice('finances').serverTools).toEqual([]);
  });

  it('searches, cites only the pages its search returned beside the rows, and records what the search cost', async () => {
    const { client, sent } = stubClient([
      SEARCHED,
      {
        content: [
          {
            type: 'tool_use',
            id: 'a1',
            name: 'answer',
            input: {
              answer: 'Jev is a budgeting app, according to its own site.',
              cited: [
                { table: 'web', ref: JEV },
                // Never searched: dropped, as a row no lookup returned is.
                { table: 'web', ref: 'https://made.up/page' },
              ],
            },
          },
        ],
        stop_reason: 'tool_use',
        usage: USAGE,
      },
    ]);
    const spent: SpendReport[] = [];
    const answer = await answerQuestion({
      turns: [{ role: 'user', body: 'What is Jev?' }],
      today: '2026-11-05',
      execute: async (): Promise<AskToolResult> => ({ ok: true, rows: [] }),
      anthropicApiKey: 'k',
      client,
      onSpend: (report) => spent.push(report),
    });

    expect(sent[0].tools[0]).toMatchObject({ name: 'web_search', type: 'web_search_20260209', max_uses: MAX_WEB_SEARCHES });
    expect(answer).toMatchObject({
      ok: true,
      body: 'Jev is a budgeting app, according to its own site.',
      citations: [{ table: 'web', ref: JEV, title: 'About Jev (jev.example)', href: JEV }],
    });
    expect(spent[0].usage.webSearchRequests).toBe(1);
    const withSearch = costMicrosFor(spent[0].model, spent[0].usage)!;
    const without = costMicrosFor(spent[0].model, { ...spent[0].usage, webSearchRequests: 0 })!;
    expect(withSearch).toBeGreaterThan(without);
  });
});

describe('People with web search (plan #2861, the core set of #2854.2)', () => {
  it('gives every person the search for the model they answer with, and tells them to name the source in the text', () => {
    expect(peopleServerTools(SONNET)).toEqual([dashWebSearch(SONNET)]);
    expect(peopleServerTools(HAIKU)).toEqual([dashWebSearch(HAIKU)]);
    expect(PEOPLE_WEB_RULES.startsWith(WEB_RULES)).toBe(true);
    expect(PEOPLE_WEB_RULES).toContain('give its link');
  });
});
