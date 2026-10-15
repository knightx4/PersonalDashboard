import { describe, expect, it } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';
import type { MemoryRpcClient, QuestionEmbedder } from '@/lib/memory/search';
import { BUDGETS, GATHER_BUDGET } from './budget';
import { chooseResume, gather, roleRequirements, type GatherDeps, type JobsClient } from './gather';
import { renderGathered, renderMaterial, renderQuestions } from './render';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const APP = 'a0000000-0000-4000-8000-000000000001';
const OTHER_APP = 'a0000000-0000-4000-8000-000000000002';
const ROLE = 'r0000000-0000-4000-8000-000000000001';
const COMPANY = 'c0000000-0000-4000-8000-000000000001';

function fixture(): FakeTables {
  return {
    'job_search.applications': [
      { id: APP, user_id: ME, role_id: ROLE, resume_version_id: 'rv-old' },
      { id: OTHER_APP, user_id: ME, role_id: 'r-other', resume_version_id: null },
    ],
    'job_search.roles': [
      {
        id: ROLE,
        user_id: ME,
        title: 'Head of Finance',
        company_id: COMPANY,
        jd_text: 'We are hiring a Head of Finance to own the model.',
        requirements: [
          { kind: 'nice_to_have', text: 'SaaS experience' },
          { kind: 'must_have', text: 'Ten years in FP&A' },
        ],
        requirement_matches: null,
      },
    ],
    'job_search.companies': [
      { id: COMPANY, user_id: ME, name: 'Acme', industry: 'Fintech', research: 'Series B, 80 people.' },
    ],
    'job_search.questions': [
      { id: 'q1', user_id: ME, text: 'Why Acme?', kind: 'motivation', canonical_answer: null },
      { id: 'q2', user_id: ME, text: 'Tell us about a model you built (140 characters)', kind: 'technical', canonical_answer: null },
      { id: 'q3', user_id: ME, text: 'Describe a hard call. 200 words max', kind: 'behavioral', canonical_answer: 'The default story.', canonical_answer_updated_at: '2026-09-01T00:00:00Z' },
      { id: 'q4', user_id: ME, text: 'What is your notice period?', kind: 'logistics', canonical_answer: 'One month.', canonical_answer_updated_at: '2026-08-01T00:00:00Z' },
      { id: 'q5', user_id: ME, text: 'Why fintech?', kind: 'motivation', canonical_answer: null },
    ],
    'job_search.application_answers': [
      { id: 'aa1', user_id: ME, application_id: APP, question_id: 'q1', answer: null, status: 'draft', word_limit: 150, created_at: '2026-10-01T00:00:01Z' },
      { id: 'aa2', user_id: ME, application_id: APP, question_id: 'q2', answer: 'A three-statement model.', status: 'draft', word_limit: null, created_at: '2026-10-01T00:00:02Z' },
      { id: 'aa3', user_id: ME, application_id: APP, question_id: 'q3', answer: null, status: 'draft', word_limit: null, created_at: '2026-10-01T00:00:03Z' },
      // Elsewhere: one sent, one only drafted (not drawn on), and someone else's.
      { id: 'aa4', user_id: ME, application_id: OTHER_APP, question_id: 'q5', answer: 'Because money moves everything.', status: 'submitted', updated_at: '2026-09-20T00:00:00Z' },
      { id: 'aa5', user_id: ME, application_id: OTHER_APP, question_id: 'q1', answer: 'Half-written.', status: 'draft', updated_at: '2026-09-25T00:00:00Z' },
      { id: 'aa6', user_id: THEM, application_id: 'x', question_id: 'q9', answer: 'Not mine.', status: 'approved', updated_at: '2026-09-30T00:00:00Z' },
    ],
    'job_search.evidence_items': [
      { id: 'e1', user_id: ME, title: 'Weak story', body: 'Small win.', context: null, metrics: null, skills: [], strength: 1, used_count: 0 },
      { id: 'e2', user_id: ME, title: 'Strong story', body: 'Cut burn by 30%.', context: 'Acme Corp', metrics: '30%', skills: ['finance'], strength: 5, used_count: 2 },
      { id: 'e3', user_id: THEM, title: 'Theirs', body: 'Not mine.', skills: [], strength: 5 },
    ],
    'job_search.resume_versions': [
      { id: 'rv-old', user_id: ME, label: 'Finance', text_content: 'Finance résumé text', created_at: '2026-01-01T00:00:00Z' },
      { id: 'rv-new', user_id: ME, label: 'General', text_content: 'General résumé text', created_at: '2026-09-01T00:00:00Z' },
    ],
    'job_search.thoughts': [
      { id: 't1', user_id: ME, body: 'I want a smaller company.', created_at: '2026-10-10T00:00:00Z' },
      { id: 't2', user_id: ME, body: 'Older thought.', created_at: '2026-09-10T00:00:00Z' },
    ],
    'job_search.notes': [
      { id: 'n1', user_id: ME, body: 'Met their CFO at a meetup.', pinned: false, company_id: COMPANY, role_id: null, application_id: null, updated_at: '2026-10-02T00:00:00Z' },
      { id: 'n2', user_id: ME, body: 'Pinned: they care about runway.', pinned: true, company_id: null, role_id: ROLE, application_id: null, updated_at: '2026-09-02T00:00:00Z' },
      { id: 'n3', user_id: ME, body: 'About another company.', pinned: true, company_id: 'c-other', role_id: null, application_id: null },
    ],
    'job_search.profiles': [
      { id: ME, writing_style_notes: 'Short sentences.', banned_constructions: ['leverage'] },
    ],
  };
}

const embed: QuestionEmbedder = async () => ({ ok: true, vector: Array.from({ length: 1024 }, () => 0.01), model: 'test' });

function memory(rows: Record<string, unknown>[], seen: Record<string, unknown>[] = []): MemoryRpcClient {
  return {
    rpc: async (fn, args) => {
      seen.push({ fn, ...args });
      return { data: rows, error: null };
    },
  };
}

function deps(tables: FakeTables, extra: Partial<GatherDeps> = {}): GatherDeps {
  return { jobs: fakeSchemaDb(tables)('job_search') as unknown as JobsClient, ...extra };
}

describe('gather', () => {
  it('returns every part for a fixture application', async () => {
    const calls: Record<string, unknown>[] = [];
    const core = memory(
      [
        { source_table: 'obsidian.notes', source_ref: 'note-1', chunk_index: 0, author: 'me', body: 'Acme notes\n\nThey raised in May.', similarity: 0.6 },
        { source_table: 'obsidian.notes', source_ref: 'note-1', chunk_index: 1, author: 'me', body: 'Acme notes\n\nSecond passage.', similarity: 0.5 },
      ],
      calls,
    );
    const result = await gather(deps(fixture(), { core, embed }), { userId: ME, applicationId: APP });
    if (!result.ok) throw new Error(result.error);
    const m = result.material;

    expect(m.role).toMatchObject({
      roleId: ROLE,
      title: 'Head of Finance',
      company: 'Acme',
      industry: 'Fintech',
      posting: 'We are hiring a Head of Finance to own the model.',
      research: 'Series B, 80 people.',
    });
    // Must-haves first; no match run, so no verdicts.
    expect(m.role.requirements.map((r) => [r.kind, r.verdict])).toEqual([
      ['must_have', null],
      ['nice_to_have', null],
    ]);
    // The company's and the role's notes, pinned first; another company's left out.
    expect(m.role.notes).toEqual(['Pinned: they care about runway.', 'Met their CFO at a meetup.']);

    // The whole bank, strongest first, nobody else's.
    expect(m.evidence.items.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(m.evidence.omitted).toBe(0);

    expect(m.resume).toMatchObject({ versionId: 'rv-old', from: 'application', text: 'Finance résumé text' });

    // Sent elsewhere and default answers, newest first; the default for a
    // question on this application rides on the question instead.
    expect(m.pastAnswers.items).toEqual([
      { question: 'Why fintech?', answer: 'Because money moves everything.', status: 'submitted', at: '2026-09-20T00:00:00Z' },
      { question: 'What is your notice period?', answer: 'One month.', status: 'default', at: '2026-08-01T00:00:00Z' },
    ]);

    expect(m.thoughts.items.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(m.style).toEqual({ notes: 'Short sentences.', banned: ['leverage'] });

    expect(m.questions.map((q) => [q.answerId, q.text, q.kind, q.answer, q.limit, q.defaultAnswer])).toEqual([
      ['aa1', 'Why Acme?', 'motivation', null, { count: 150, unit: 'words', from: 'set' }, null],
      [
        'aa2',
        'Tell us about a model you built (140 characters)',
        'technical',
        'A three-statement model.',
        { count: 140, unit: 'characters', from: 'question' },
        null,
      ],
      ['aa3', 'Describe a hard call. 200 words max', 'behavioral', null, { count: 200, unit: 'words', from: 'question' }, 'The default story.'],
    ]);

    // One passage per note, asked about the role and the company in the vault.
    expect(m.vault).toEqual({
      skipped: null,
      passages: [{ sourceTable: 'obsidian.notes', sourceRef: 'note-1', title: 'Acme notes', text: 'They raised in May.', similarity: 0.6 }],
    });
    expect(calls[0]).toMatchObject({ fn: 'search_memory', p_user_id: ME, p_sources: ['obsidian.notes'] });

    const text = renderGathered(m);
    for (const part of ['Head of Finance at Acme', 'Ten years in FP&A', 'Series B', 'id: e2', 'Finance résumé text', 'Why fintech?', 'smaller company', 'They raised in May.', 'Never use: "leverage"', 'answer id: aa2', 'limit: 140 characters']) {
      expect(text).toContain(part);
    }
    expect(renderMaterial(m)).not.toContain('answer id:');
    expect(renderQuestions(m.questions)).toContain('limit: 150 words');
  });

  it('skips vault passages quietly when no embedding key is set, and with no core client', async () => {
    const noKey: QuestionEmbedder = async () => ({ ok: false, reason: 'no-key', detail: 'EMBEDDING_API_KEY is not set' });
    const withoutKey = await gather(deps(fixture(), { core: memory([]), embed: noKey }), { userId: ME, applicationId: APP });
    expect(withoutKey.ok && withoutKey.material.vault).toEqual({ passages: [], skipped: 'no-key' });

    const withoutCore = await gather(deps(fixture()), { userId: ME, applicationId: APP });
    expect(withoutCore.ok && withoutCore.material.vault).toEqual({ passages: [], skipped: 'no-client' });
  });

  it('refuses an application that is not the person’s', async () => {
    const result = await gather(deps(fixture()), { userId: THEM, applicationId: APP });
    expect(result).toEqual({ ok: false, error: 'That application is not yours.' });
  });

  it('falls back to the default banned list when the profile has none', async () => {
    const tables = fixture();
    tables['job_search.profiles'] = [];
    const result = await gather(deps(tables), { userId: ME, applicationId: APP });
    expect(result.ok && result.material.style.banned).toContain('passionate about');
  });

  it('stays under its size budget however much is on file', async () => {
    const long = (n: number, word = 'lorem') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');
    const tables = fixture();
    tables['job_search.roles'][0].jd_text = long(10_000, 'posting');
    tables['job_search.roles'][0].requirements = Array.from({ length: 200 }, (_, i) => ({ kind: 'must_have', text: long(20, `req${i}`) }));
    tables['job_search.companies'][0].research = long(5_000, 'research');
    tables['job_search.evidence_items'] = Array.from({ length: 120 }, (_, i) => ({
      id: `ev${i}`, user_id: ME, title: `Story ${i}`, body: long(1_000), context: long(100), metrics: long(100), skills: ['a', 'b'], strength: i % 5, used_count: 0,
    }));
    tables['job_search.resume_versions'] = [{ id: 'rv-old', user_id: ME, label: 'Long', text_content: long(20_000), created_at: '2026-01-01' }];
    tables['job_search.thoughts'] = Array.from({ length: 40 }, (_, i) => ({ id: `th${i}`, user_id: ME, body: long(1_000), created_at: `2026-10-${String((i % 28) + 1).padStart(2, '0')}` }));
    tables['job_search.notes'] = Array.from({ length: 30 }, (_, i) => ({ id: `no${i}`, user_id: ME, body: long(500), pinned: false, company_id: COMPANY }));
    tables['job_search.profiles'][0].writing_style_notes = long(3_000);
    for (let i = 0; i < 80; i += 1) {
      tables['job_search.questions'].push({ id: `pq${i}`, user_id: ME, text: long(50, `question${i}`), kind: 'other', canonical_answer: long(800, `default${i}`), canonical_answer_updated_at: '2026-09-01' });
      tables['job_search.application_answers'].push({ id: `pa${i}`, user_id: ME, application_id: OTHER_APP, question_id: `pq${i}`, answer: long(800, `sent${i}`), status: 'approved', updated_at: '2026-09-02' });
    }
    for (let i = 0; i < 25; i += 1) {
      tables['job_search.questions'].push({ id: `mq${i}`, user_id: ME, text: `${long(200, `ask${i}`)} (500 words max)`, kind: 'other', canonical_answer: long(800) });
      tables['job_search.application_answers'].push({ id: `ma${i}`, user_id: ME, application_id: APP, question_id: `mq${i}`, answer: long(800), status: 'draft', word_limit: null, created_at: `2026-10-02T00:00:${String(i).padStart(2, '0')}Z` });
    }
    const passages = Array.from({ length: 20 }, (_, i) => ({ source_table: 'obsidian.notes', source_ref: `vn${i}`, chunk_index: 0, author: 'me', body: `Note ${i}\n\n${long(600)}`, similarity: 0.9 - i / 100 }));

    const result = await gather(deps(tables, { core: memory(passages), embed }), { userId: ME, applicationId: APP });
    if (!result.ok) throw new Error(result.error);
    const m = result.material;

    expect(renderGathered(m).length).toBeLessThan(GATHER_BUDGET);
    // Every question on the application is still there, each with its limit.
    expect(m.questions).toHaveLength(28);
    expect(m.questions.slice(3).every((q) => q.limit?.count === 500 && q.limit.unit === 'words')).toBe(true);
    // The lists were cut and say so; the texts were cut and stay inside their budgets.
    expect(m.evidence.omitted).toBeGreaterThan(0);
    expect(m.pastAnswers.omitted).toBeGreaterThan(0);
    expect(m.thoughts.omitted).toBeGreaterThan(0);
    expect(m.role.posting!.length).toBeLessThanOrEqual(BUDGETS.posting);
    expect(m.resume!.text.length).toBeLessThanOrEqual(BUDGETS.resume);
    expect(m.role.research!.length).toBeLessThanOrEqual(BUDGETS.companyResearch);
    expect(m.vault.passages.length).toBeGreaterThan(0);
    expect(m.vault.passages.length).toBeLessThan(20);
  });
});

describe('chooseResume', () => {
  const versions = [
    { id: 'old', label: 'Old', text_content: 'old text', created_at: '2026-01-01' },
    { id: 'blank', label: 'Blank', text_content: '  ', created_at: '2026-10-01' },
    { id: 'new', label: 'New', text_content: 'new text', created_at: '2026-09-01' },
  ];

  it('takes the version on the application when it has text', () => {
    expect(chooseResume(versions, 'old')).toMatchObject({ versionId: 'old', from: 'application' });
  });

  it('falls back to the newest version with text', () => {
    expect(chooseResume(versions, null)).toMatchObject({ versionId: 'new', from: 'newest' });
    expect(chooseResume(versions, 'blank')).toMatchObject({ versionId: 'new', from: 'newest' });
  });

  it('is null when no version has text', () => {
    expect(chooseResume([{ id: 'x', label: null, text_content: null, created_at: null }], 'x')).toBeNull();
  });
});

describe('roleRequirements', () => {
  it('prefers the requirement match, with its verdicts', () => {
    const got = roleRequirements(
      [{ requirement: 'SQL', kind: 'must_have', verdict: 'strong', evidenceItemId: 'e1', why: 'Built the warehouse.' }],
      [{ text: 'ignored', kind: 'must_have' }],
    );
    expect(got).toEqual([{ text: 'SQL', kind: 'must_have', verdict: 'strong', evidenceItemId: 'e1', why: 'Built the warehouse.' }]);
  });
});
