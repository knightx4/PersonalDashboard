import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';
import { runApplicationDraft } from './draft-application';

const ME = '11111111-1111-4111-8111-111111111111';
const APP = 'a0000000-0000-4000-8000-000000000001';
const ROLE = 'r0000000-0000-4000-8000-000000000001';
const COMPANY = 'c0000000-0000-4000-8000-000000000001';

/** An application with three questions: one answered, one held to 10 words, one to 60 characters. */
function fixture(): FakeTables {
  return {
    'job_search.applications': [{ id: APP, user_id: ME, role_id: ROLE, resume_version_id: null }],
    'job_search.roles': [
      { id: ROLE, user_id: ME, title: 'Head of Finance', company_id: COMPANY, jd_text: 'Own the model.', requirements: null, requirement_matches: null },
    ],
    'job_search.companies': [{ id: COMPANY, user_id: ME, name: 'Acme', industry: 'Fintech', research: null }],
    'job_search.questions': [
      { id: 'q1', user_id: ME, text: 'Why Acme?', kind: 'motivation', canonical_answer: null },
      { id: 'q2', user_id: ME, text: 'Tell us about a model you built.', kind: 'technical', canonical_answer: null },
      { id: 'q3', user_id: ME, text: 'Why are you leaving? (60 characters)', kind: 'motivation', canonical_answer: null },
    ],
    'job_search.application_answers': [
      { id: 'aa1', user_id: ME, application_id: APP, question_id: 'q1', answer: null, status: 'draft', word_limit: 10, created_at: '2026-10-01T00:00:01Z' },
      { id: 'aa2', user_id: ME, application_id: APP, question_id: 'q2', answer: 'A three-statement model.', status: 'draft', word_limit: null, created_at: '2026-10-01T00:00:02Z' },
      { id: 'aa3', user_id: ME, application_id: APP, question_id: 'q3', answer: null, status: 'draft', word_limit: null, created_at: '2026-10-01T00:00:03Z' },
    ],
    'job_search.evidence_items': [
      { id: 'e1', user_id: ME, title: 'Burn', body: 'Cut burn by 30%.', context: null, metrics: '30%', skills: [], strength: 5 },
    ],
    'job_search.resume_versions': [],
    'job_search.thoughts': [],
    'job_search.notes': [],
    'job_search.profiles': [{ id: ME, writing_style_notes: null, banned_constructions: [] }],
    'job_search.application_drafts': [],
  };
}

type Report = { answers: Record<string, unknown>[]; asks?: Record<string, unknown>[] };

/** A client whose stream calls answer from `replies` in turn, keeping each request it was sent. */
function fakeModel(replies: Report[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageCreateParams) => {
        requests.push(structuredClone(params));
        const input = replies[requests.length - 1];
        return {
          finalMessage: async () => ({
            id: `msg_${requests.length}`,
            type: 'message',
            role: 'assistant',
            model: params.model,
            stop_reason: input ? 'tool_use' : 'end_turn',
            stop_sequence: null,
            content: input
              ? [{ type: 'tool_use', id: `tool_${requests.length}`, name: 'report_drafts', input }]
              : [{ type: 'text', text: 'No.' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          }),
        };
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

function setup(tables: FakeTables, replies: Report[]) {
  const model = fakeModel(replies);
  const spend: SpendReport[] = [];
  let n = 0;
  const deps = {
    jobs: fakeSchemaDb(tables)('job_search') as unknown as AppSupabaseClient,
    apiKey: 'test',
    client: model.client,
    onSpend: (report: SpendReport) => spend.push(report),
    newId: () => `ask-${++n}`,
  };
  return { deps, requests: model.requests, spend };
}

function userText(request: Anthropic.MessageCreateParams): string {
  const first = request.messages[0];
  return typeof first.content === 'string' ? first.content : JSON.stringify(first.content);
}

const TEN_WORDS = 'I want to build the finance function at Acme properly.';

describe('runApplicationDraft', () => {
  it('drafts every unanswered question in one call and saves the drafts with the asks', async () => {
    const tables = fixture();
    const { deps, requests, spend } = setup(tables, [
      {
        answers: [
          { answer_id: 'aa1', answer: 'I cut burn by 30% and want that here.', evidence_item_ids: ['e1'], unsupported_claims: [] },
          { answer_id: 'aa3', answer: 'The team I built was cut in half.', evidence_item_ids: [], unsupported_claims: ['team was cut in half'] },
        ],
        asks: [{ answer_id: 'aa3', question: 'Why are you leaving your current job?' }],
      },
    ]);

    const result = await runApplicationDraft(deps, { userId: ME, applicationId: APP });
    if (!result.ok) throw new Error(result.error);

    expect(requests).toHaveLength(1);
    const sent = userText(requests[0]);
    expect(sent).toContain('answer id: aa1');
    expect(sent).toContain('answer id: aa3');
    // The answered question is context, not something to draft.
    expect(sent).toContain('## Answered already on this application');
    expect(sent.split('## Answered already')[0]).not.toContain('answer id: aa2');
    // The material is the cached system block.
    const system = requests[0].system as Anthropic.TextBlockParam[];
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1].text).toContain('Cut burn by 30%.');

    expect(result.drafted).toEqual(['aa1', 'aa3']);
    expect(result.flagged).toEqual([]);
    expect(spend).toHaveLength(1);

    const row = tables['job_search.application_drafts'];
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ user_id: ME, application_id: APP, kind: 'answers' });
    expect(Object.keys(row[0].drafts as object)).toEqual(['aa1', 'aa3']);
    expect((row[0].drafts as Record<string, { evidence_item_ids: string[] }>).aa1.evidence_item_ids).toEqual(['e1']);
    expect(row[0].asks).toEqual([
      { id: 'ask-1', answer_id: 'aa3', question: 'Why are you leaving your current job?', reply: null },
    ]);
    expect(result.drafts.asks).toEqual(row[0].asks);
  });

  it('sends a reply to an ask in the next call, and keeps it', async () => {
    const tables = fixture();
    tables['job_search.application_drafts'].push({
      id: 'd1',
      user_id: ME,
      application_id: APP,
      kind: 'answers',
      drafts: { aa3: { answer: 'Old.', evidence_item_ids: [], unsupported_claims: [] } },
      asks: [{ id: 'k1', answer_id: 'aa3', question: 'Why are you leaving your current job?', reply: null }],
    });
    const { deps, requests } = setup(tables, [
      { answers: [{ answer_id: 'aa3', answer: 'My team was folded into sales.', evidence_item_ids: [], unsupported_claims: [] }], asks: [] },
    ]);

    const result = await runApplicationDraft(deps, {
      userId: ME,
      applicationId: APP,
      answerIds: ['aa3'],
      replies: { k1: 'My team was folded into sales.' },
    });
    if (!result.ok) throw new Error(result.error);

    const sent = userText(requests[0]);
    expect(sent).toContain('You asked: Why are you leaving your current job?\nThey said: My team was folded into sales.');
    // Named: only aa3 is drafted, though aa1 has no answer either.
    expect(sent).toContain('answer id: aa3');
    expect(sent.split('## Answered already')[0]).not.toContain('answer id: aa1');

    const row = tables['job_search.application_drafts'][0];
    expect(row.asks).toEqual([
      { id: 'k1', answer_id: 'aa3', question: 'Why are you leaving your current job?', reply: 'My team was folded into sales.' },
    ]);
    expect((row.drafts as Record<string, { answer: string }>).aa3.answer).toBe('My team was folded into sales.');
  });

  it('retries an answer over its limit once and keeps the shortened one', async () => {
    const tables = fixture();
    const { deps, requests, spend } = setup(tables, [
      {
        answers: [
          { answer_id: 'aa1', answer: `${TEN_WORDS} And a great deal more besides.`, evidence_item_ids: [], unsupported_claims: [] },
          { answer_id: 'aa3', answer: 'Leaving for a bigger remit.', evidence_item_ids: [], unsupported_claims: [] },
        ],
        asks: [],
      },
      { answers: [{ answer_id: 'aa1', answer: TEN_WORDS, evidence_item_ids: [], unsupported_claims: [] }], asks: [] },
    ]);

    const result = await runApplicationDraft(deps, { userId: ME, applicationId: APP });
    if (!result.ok) throw new Error(result.error);

    expect(requests).toHaveLength(2);
    const retry = requests[1].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1].role).toBe('assistant');
    expect(JSON.stringify(retry[2].content)).toContain('answer id aa1: 16 words, over the 10-word limit');
    expect(JSON.stringify(retry[2].content)).not.toContain('aa3');
    expect(spend).toHaveLength(2);

    expect(result.flagged).toEqual([]);
    const drafts = tables['job_search.application_drafts'][0].drafts as Record<string, Record<string, unknown>>;
    expect(drafts.aa1.answer).toBe(TEN_WORDS);
    expect(drafts.aa1).not.toHaveProperty('over_limit');
    expect(drafts.aa3.answer).toBe('Leaving for a bigger remit.');
  });

  it('flags an answer still over its limit after the retry, by characters as well as words', async () => {
    const tables = fixture();
    const long = 'I am leaving because the company is moving its whole finance team abroad.';
    const { deps, requests } = setup(tables, [
      {
        answers: [
          { answer_id: 'aa1', answer: TEN_WORDS, evidence_item_ids: [], unsupported_claims: [] },
          { answer_id: 'aa3', answer: long, evidence_item_ids: [], unsupported_claims: [] },
        ],
        asks: [],
      },
      { answers: [{ answer_id: 'aa3', answer: `${long} Still long.`, evidence_item_ids: [], unsupported_claims: [] }], asks: [] },
    ]);

    const result = await runApplicationDraft(deps, { userId: ME, applicationId: APP });
    if (!result.ok) throw new Error(result.error);

    expect(requests).toHaveLength(2);
    expect(result.flagged).toEqual(['aa3']);
    const drafts = tables['job_search.application_drafts'][0].drafts as Record<string, Record<string, unknown>>;
    // The retry came back longer, so the first draft is kept, and flagged.
    expect(drafts.aa3.answer).toBe(long);
    expect(drafts.aa3.over_limit).toEqual({ count: long.length, limit: 60, unit: 'characters' });
  });

  it('flags without a retry when no time is left', async () => {
    const tables = fixture();
    const { deps, requests } = setup(tables, [
      {
        answers: [{ answer_id: 'aa1', answer: `${TEN_WORDS} Over.`, evidence_item_ids: [], unsupported_claims: [] }],
        asks: [],
      },
    ]);
    const result = await runApplicationDraft(
      { ...deps, deadline: Date.now() + 1_000 },
      { userId: ME, applicationId: APP, answerIds: ['aa1'] },
    );
    if (!result.ok) throw new Error(result.error);
    expect(requests).toHaveLength(1);
    expect(result.flagged).toEqual(['aa1']);
  });

  it('saves nothing when no drafts come back', async () => {
    const tables = fixture();
    const { deps } = setup(tables, []);
    const result = await runApplicationDraft(deps, { userId: ME, applicationId: APP });
    expect(result).toEqual({ ok: false, error: 'No drafts came back.' });
    expect(tables['job_search.application_drafts']).toEqual([]);
  });

  it('refuses an application that is not theirs before calling the model', async () => {
    const tables = fixture();
    const { deps, requests } = setup(tables, []);
    const result = await runApplicationDraft(deps, { userId: 'someone-else', applicationId: APP });
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
