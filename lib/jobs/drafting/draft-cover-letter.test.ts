import { describe, expect, it } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';
import { keepLetter, letterPrompt } from './draft-cover-letter';
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

function deps(tables: FakeTables) {
  let n = 0;
  return {
    jobs: fakeSchemaDb(tables)('job_search') as unknown as JobsClient,
    newId: () => `ask-${++n}`,
  };
}

/** Render the prompt, then keep the report the routine wrote from it. */
async function draft(tables: FakeTables, report: Record<string, unknown>, replies?: Record<string, string>) {
  const d = deps(tables);
  if (replies) {
    const rows = tables['job_search.application_drafts'] as { asks: { id: string; reply: string | null }[] }[];
    for (const ask of rows[0].asks) if (replies[ask.id] !== undefined) ask.reply = replies[ask.id];
  }
  const prepared = await letterPrompt(d, { userId: ME, applicationId: APP });
  if (!prepared.ok) throw new Error(prepared.error);
  const kept = await keepLetter(d, { userId: ME, applicationId: APP, prompt: prepared.prompt }, report);
  return { prompt: prepared.prompt, kept };
}

describe('letterPrompt and keepLetter', () => {
  it('renders the material, keeps the letter and its asks, and renders the replies next time', async () => {
    const tables = fixture();
    const first = await draft(tables, {
      letter: 'Acme is getting serious about runway, and I leverage that. I cut burn by 30% at Beta Corp.',
      evidence_item_ids: ['e2', 'e-invented'],
      unsupported_claims: [],
      asks: ['Do you know anyone at Acme?', 'When could you start?'],
    });
    if (!first.kept.ok) throw new Error(first.kept.error);

    expect(first.prompt.materialText).toContain('Cut burn by 30%.');
    expect(first.prompt.requestText).toContain('A (draft): Because of runway discipline.');
    expect(first.prompt.requestText).toContain('- Ten years in FP&A (strong)');
    expect(first.prompt.requestText).not.toContain('SaaS metrics (gap)');

    expect(first.kept.draft.evidenceItemIds).toEqual(['e2']);
    expect(first.kept.draft.unsupportedClaims).toEqual(['Part of this cited an evidence item that does not exist.']);
    expect(first.kept.draft.bannedFound).toEqual(['leverage']);
    expect(first.kept.draft.asks.map((a) => [a.id, a.question, a.reply])).toEqual([
      ['ask-1', 'Do you know anyone at Acme?', null],
      ['ask-2', 'When could you start?', null],
    ]);

    // Kept as a cover_letter row; applications.cover_letter is not touched.
    const rows = tables['job_search.application_drafts'];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: ME, application_id: APP, kind: 'cover_letter' });
    expect((rows[0].drafts as Record<string, { answer: string }>)[LETTER_KEY].answer).toContain('Beta Corp');
    expect(tables['job_search.applications'][0].cover_letter).toBeUndefined();

    // Redraft after a reply to the first ask.
    const second = await draft(
      tables,
      {
        letter: 'Acme is getting serious about runway. I cut burn by 30% at Beta Corp, and Jo Smith there can vouch for it.',
        evidence_item_ids: ['e2'],
        unsupported_claims: [],
        asks: ['Do you know anyone at Acme?'],
      },
      { 'ask-1': 'Jo Smith, their controller.' },
    );
    if (!second.kept.ok) throw new Error(second.kept.error);

    expect(second.prompt.requestText).toContain('Q: Do you know anyone at Acme?\nA: Jo Smith, their controller.');
    expect(second.prompt.requestText).not.toContain('When could you start?');
    expect(second.prompt.requestText).toContain('## Your previous draft');

    // The answered ask stays with its reply; the unanswered one is gone, and
    // asking the answered one again adds nothing.
    expect(second.kept.draft.asks).toEqual([
      { id: 'ask-1', answer_id: null, question: 'Do you know anyone at Acme?', reply: 'Jo Smith, their controller.' },
    ]);
    expect(second.kept.draft.bannedFound).toEqual([]);
    expect(tables['job_search.application_drafts']).toHaveLength(1);
  });

  it('refuses an application that is not theirs', async () => {
    const result = await letterPrompt(deps(fixture()), {
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: APP,
    });
    expect(result).toEqual({ ok: false, error: 'That application is not yours.' });
  });

  it('keeps nothing when the report has no letter', async () => {
    const tables = fixture();
    const { kept } = await draft(tables, { letter: '', evidence_item_ids: [], unsupported_claims: [], asks: [] });
    expect(kept.ok).toBe(false);
    expect(tables['job_search.application_drafts'] ?? []).toHaveLength(0);
  });
});
