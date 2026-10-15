import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';
import { draftAndSaveCoverLetter, type CoverLetterDeps } from './draft-cover-letter';
import type { JobsClient } from './gather';
import { LETTER_KEY } from './store';

const ME = '11111111-1111-4111-8111-111111111111';
const APP = 'a0000000-0000-4000-8000-000000000001';
const ROLE = 'r0000000-0000-4000-8000-000000000001';
const COMPANY = 'c0000000-0000-4000-8000-000000000001';

function fixture(): FakeTables {
  return {
    'job_search.applications': [{ id: APP, user_id: ME, role_id: ROLE, resume_version_id: null }],
    'job_search.roles': [
      {
        id: ROLE,
        user_id: ME,
        title: 'Head of Finance',
        company_id: COMPANY,
        jd_text: 'We are hiring a Head of Finance to own the model.',
        requirements: null,
        requirement_matches: [
          { requirement: 'Ten years in FP&A', kind: 'must_have', verdict: 'strong', evidenceItemId: 'e2', why: 'Ran FP&A at two firms.' },
          { requirement: 'SaaS metrics', kind: 'nice_to_have', verdict: 'gap', evidenceItemId: null, why: '' },
        ],
      },
    ],
    'job_search.companies': [{ id: COMPANY, user_id: ME, name: 'Acme', industry: 'Fintech', research: 'Series B.' }],
    'job_search.questions': [{ id: 'q1', user_id: ME, text: 'Why Acme?', kind: 'motivation', canonical_answer: null }],
    'job_search.application_answers': [
      { id: 'aa1', user_id: ME, application_id: APP, question_id: 'q1', answer: 'Because of runway discipline.', status: 'draft', word_limit: null, created_at: '2026-10-01T00:00:00Z' },
    ],
    'job_search.evidence_items': [
      { id: 'e2', user_id: ME, title: 'Cut burn', body: 'Cut burn by 30%.', context: 'Beta Corp', metrics: '30%', skills: [], strength: 5, used_count: 1 },
    ],
    'job_search.profiles': [{ id: ME, writing_style_notes: 'Short sentences.', banned_constructions: ['leverage'] }],
  };
}

type Call = { system: { text: string }[]; messages: { content: string }[] };

/** A model that reports the next letter in the queue, recording what it was sent. */
function fakeModel(reports: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const client = {
    messages: {
      create: async (params: Call) => {
        calls.push(params);
        return {
          content: [{ type: 'tool_use', id: 't', name: 'report_cover_letter', input: reports[calls.length - 1] }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 9000, output_tokens: 700 },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

function deps(tables: FakeTables, client: Anthropic, spend: SpendReport[]): CoverLetterDeps {
  let n = 0;
  return {
    jobs: fakeSchemaDb(tables)('job_search') as unknown as JobsClient,
    apiKey: 'test',
    client,
    onSpend: (report) => spend.push(report),
    newId: () => `ask-${++n}`,
  };
}

describe('draftAndSaveCoverLetter', () => {
  it('drafts in one call, keeps the letter and its asks, and sends the replies next time', async () => {
    const tables = fixture();
    const { client, calls } = fakeModel([
      {
        letter: 'Acme is getting serious about runway, and I leverage that. I cut burn by 30% at Beta Corp.',
        evidence_item_ids: ['e2', 'e-invented'],
        unsupported_claims: [],
        asks: ['Do you know anyone at Acme?', 'When could you start?'],
      },
      {
        letter: 'Acme is getting serious about runway. I cut burn by 30% at Beta Corp, and Jo Smith there can vouch for it.',
        evidence_item_ids: ['e2'],
        unsupported_claims: [],
        asks: ['Do you know anyone at Acme?'],
      },
    ]);
    const spend: SpendReport[] = [];

    const first = await draftAndSaveCoverLetter(deps(tables, client, spend), { userId: ME, applicationId: APP });
    if (!first.ok) throw new Error(first.error);

    expect(calls).toHaveLength(1);
    // The gathered material is the cached prefix; the answers and best match are in the message.
    expect(calls[0].system[1].text).toContain('Cut burn by 30%.');
    expect(calls[0].messages[0].content).toContain('A (draft): Because of runway discipline.');
    expect(calls[0].messages[0].content).toContain('- Ten years in FP&A (strong)');
    expect(calls[0].messages[0].content).not.toContain('SaaS metrics (gap)');
    expect(spend).toHaveLength(1);

    expect(first.draft.evidenceItemIds).toEqual(['e2']);
    expect(first.draft.unsupportedClaims).toEqual(['Part of this cited an evidence item that does not exist.']);
    expect(first.draft.bannedFound).toEqual(['leverage']);
    expect(first.draft.asks.map((a) => [a.id, a.question, a.reply])).toEqual([
      ['ask-1', 'Do you know anyone at Acme?', null],
      ['ask-2', 'When could you start?', null],
    ]);

    // Kept as a cover_letter row; applications.cover_letter is not touched.
    const rows = tables['job_search.application_drafts'];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: ME, application_id: APP, kind: 'cover_letter' });
    expect((rows[0].drafts as Record<string, { answer: string }>)[LETTER_KEY].answer).toContain('Beta Corp');
    expect(tables['job_search.applications'][0].cover_letter).toBeUndefined();

    // Redraft with a reply to the first ask.
    const second = await draftAndSaveCoverLetter(deps(tables, client, spend), {
      userId: ME,
      applicationId: APP,
      replies: { 'ask-1': 'Jo Smith, their controller.' },
    });
    if (!second.ok) throw new Error(second.error);

    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0].content).toContain('Q: Do you know anyone at Acme?\nA: Jo Smith, their controller.');
    expect(calls[1].messages[0].content).not.toContain('When could you start?');
    expect(calls[1].messages[0].content).toContain('## Your previous draft');

    // The answered ask stays with its reply; the unanswered one is gone, and
    // the model asking the answered one again adds nothing.
    expect(second.draft.asks).toEqual([
      { id: 'ask-1', answer_id: null, question: 'Do you know anyone at Acme?', reply: 'Jo Smith, their controller.' },
    ]);
    expect(second.draft.bannedFound).toEqual([]);
    expect(tables['job_search.application_drafts']).toHaveLength(1);
  });

  it('refuses an application that is not theirs and calls nothing', async () => {
    const { client, calls } = fakeModel([]);
    const result = await draftAndSaveCoverLetter(deps(fixture(), client, []), {
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: APP,
    });
    expect(result).toEqual({ ok: false, error: 'That application is not yours.' });
    expect(calls).toHaveLength(0);
  });

  it('keeps nothing when the model reports no letter', async () => {
    const tables = fixture();
    const { client } = fakeModel([{ letter: '', evidence_item_ids: [], unsupported_claims: [], asks: [] }]);
    const result = await draftAndSaveCoverLetter(deps(tables, client, []), { userId: ME, applicationId: APP });
    expect(result.ok).toBe(false);
    expect(tables['job_search.application_drafts'] ?? []).toHaveLength(0);
  });
});
