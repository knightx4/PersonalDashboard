import { describe, expect, it, vi } from 'vitest';
import { SONNET } from '@/lib/core/models';
import {
  inputText,
  keepLookupCap,
  keptInput,
  lookupCapEntry,
  lookupCapRow,
  MAX_INPUT_CHARS,
  spentMicros,
  wasCutShort,
  type LookupCap,
} from './lookup-caps';

const USER = '00000000-0000-4000-8000-00000000000a';
const CHAT = '00000000-0000-4000-8000-0000000000c1';
const TURN = '00000000-0000-4000-8000-0000000000c2';
const RUN = '00000000-0000-4000-8000-0000000000e1';
const CASE = '00000000-0000-4000-8000-0000000000e2';

const usage = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0 };

function cap(over: Partial<LookupCap> = {}): LookupCap {
  return {
    surface: 'ask',
    question: '  Which roles did I apply to in October?  ',
    model: SONNET,
    toolCalls: [
      { name: 'search', input: { query: 'roles' }, result: { ok: true, rows: [] } },
      { name: 'open_row', input: { table: 'job_search.roles', ref: 'r-1' }, result: { ok: false, error: 'not found' } },
    ],
    answer: {},
    calls: [],
    spent: [{ model: SONNET, usage }],
    seconds: 59.04,
    conversationId: CHAT,
    turnId: TURN,
    pagePath: '/jobs/roles',
    scope: 'jobs',
    ...over,
  };
}

describe('lookupCapRow', () => {
  it('keeps the question, where it was asked and the lookups in order', () => {
    const row = lookupCapRow(USER, cap());
    expect(row).toMatchObject({
      user_id: USER,
      surface: 'ask',
      question: 'Which roles did I apply to in October?',
      conversation_id: CHAT,
      turn_id: TURN,
      page_path: '/jobs/roles',
      scope: 'jobs',
      eval_run_id: null,
      eval_case_id: null,
      lookup_count: 2,
      extended: false,
      cut_short: false,
      seconds: 59,
      model: SONNET,
    });
    expect(row.lookups).toEqual([
      { tool: 'search', input: { query: 'roles' }, ok: true },
      { tool: 'open_row', input: { table: 'job_search.roles', ref: 'r-1' }, ok: false },
    ]);
    expect(row.cost_micros).toBeGreaterThan(0);
  });

  it('keeps an eval case with its run and drops ids that are not uuids', () => {
    const row = lookupCapRow(
      USER,
      cap({ surface: 'eval', conversationId: 'conv-new', turnId: null, pagePath: 'jobs', evalRunId: RUN, evalCaseId: CASE }),
    );
    expect(row).toMatchObject({ surface: 'eval', conversation_id: null, turn_id: null, page_path: null, eval_run_id: RUN, eval_case_id: CASE });
  });

  it('marks an answer cut to fit, or whose last reply hit its length limit, as cut short', () => {
    expect(lookupCapRow(USER, cap({ answer: { cutShort: true, extended: true } }))).toMatchObject({ cut_short: true, extended: true });
    const lastHitLimit = [{ stop: 'max_tokens', blocks: ['text'], outputTokens: 4000, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 }];
    expect(wasCutShort({}, lastHitLimit)).toBe(true);
    expect(wasCutShort({}, [{ ...lastHitLimit[0], stop: 'tool_use' }])).toBe(false);
  });
});

describe('keptInput', () => {
  it('keeps a short input as it is and a long one as its first characters', () => {
    expect(keptInput({ query: 'x' })).toEqual({ query: 'x' });
    const long = keptInput({ sql: 'a'.repeat(MAX_INPUT_CHARS * 2) }) as { trimmed: string };
    expect(long.trimmed).toHaveLength(MAX_INPUT_CHARS);
    expect(inputText(long)).toMatch(/…$/);
    expect(inputText({ query: 'x' })).toBe('{"query":"x"}');
  });
});

describe('spentMicros', () => {
  it('is null when no call was priced', () => {
    expect(spentMicros([])).toBeNull();
    expect(spentMicros([{ model: 'not-a-model', usage }])).toBeNull();
    expect(spentMicros([{ model: SONNET, usage }])).toBeGreaterThan(0);
  });
});

describe('lookupCapEntry', () => {
  it('reads a row back, numbers from strings and lookups without a tool left out', () => {
    const entry = lookupCapEntry({
      id: 'x',
      created_at: '2026-11-09T10:00:00Z',
      surface: 'eval',
      question: 'q',
      conversation_id: null,
      turn_id: null,
      page_path: null,
      scope: null,
      eval_run_id: RUN,
      eval_case_id: CASE,
      lookups: [{ tool: 'search', input: { query: 'a' }, ok: true }, { input: {} }],
      lookup_count: 12,
      extended: false,
      cut_short: true,
      seconds: '59.0',
      cost_micros: '81234',
      model: SONNET,
    });
    expect(entry).toMatchObject({ surface: 'eval', seconds: 59, costMicros: 81234, cutShort: true, lookupCount: 12 });
    expect(entry.lookups).toEqual([{ tool: 'search', input: { query: 'a' }, ok: true }]);
  });
});

describe('keepLookupCap', () => {
  it('inserts into core.dash_lookup_caps and never throws', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    await keepLookupCap({ from: (table) => (expect(table).toBe('dash_lookup_caps'), { insert }) }, USER, cap());
    expect(insert).toHaveBeenCalledTimes(1);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      keepLookupCap({ from: () => ({ insert: async () => { throw new Error('down'); } }) }, USER, cap()),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
