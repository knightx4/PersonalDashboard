import { describe, expect, it } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';
import type { FireRoutineResult } from '@/lib/feedback/routine';
import type { JobsClient } from './gather';
import { letterBrief, letterRequestOpen, queueCoverLetter, settleLetterRequest, type LetterRequest } from './letter-request';

const ME = '11111111-1111-4111-8111-111111111111';
const APP = 'a0000000-0000-4000-8000-000000000001';

function tables(): FakeTables {
  return {
    'job_search.applications': [{ id: APP, user_id: ME }],
    'job_search.application_drafts': [
      {
        id: 'd1',
        user_id: ME,
        application_id: APP,
        kind: 'cover_letter',
        drafts: {},
        asks: [{ id: 'ask-1', answer_id: null, question: 'Why this role?', reply: null }],
      },
    ],
  };
}

function firing(result: FireRoutineResult) {
  const briefs: string[] = [];
  return { briefs, fire: async (brief: string) => (briefs.push(brief), result) };
}

const STARTED: FireRoutineResult = {
  ok: true,
  detail: 'started',
  status: 200,
  body: { claude_code_session_url: 'https://claude.ai/code/session_1' },
  runId: 'session_1',
};

describe('queueCoverLetter', () => {
  it('saves the replies, queues the letter and fires the routine with the skill', async () => {
    const db = tables();
    const { briefs, fire } = firing(STARTED);
    const jobs = fakeSchemaDb(db)('job_search') as unknown as JobsClient;

    const result = await queueCoverLetter(
      { jobs, fire },
      { userId: ME, applicationId: APP, replies: { 'ask-1': 'I want to own the model.' } },
    );
    if (!result.ok) throw new Error(result.error);

    const [row] = db['job_search.cover_letter_requests'];
    expect(row).toMatchObject({ id: result.requestId, user_id: ME, application_id: APP, status: 'queued', run_url: 'https://claude.ai/code/session_1' });
    expect(briefs).toEqual([letterBrief({ requestId: result.requestId, userId: ME, applicationId: APP })]);
    expect(briefs[0].split('\n')[0]).toBe('Follow .claude/skills/cover-letters/SKILL.md');
    // The reply is on the stored ask before the routine reads it.
    expect((db['job_search.application_drafts'][0].asks as { reply: string | null }[])[0].reply).toBe('I want to own the model.');
  });

  it('marks the request failed when the routine will not start', async () => {
    const db = tables();
    const { fire } = firing({ ok: false, error: '401 Token is not authorized', status: 401, body: null });
    const jobs = fakeSchemaDb(db)('job_search') as unknown as JobsClient;

    const result = await queueCoverLetter({ jobs, fire }, { userId: ME, applicationId: APP });
    expect(result).toEqual({ ok: false, error: '401 Token is not authorized' });
    expect(db['job_search.cover_letter_requests'][0]).toMatchObject({ status: 'failed' });
    expect(String(db['job_search.cover_letter_requests'][0].error)).toContain('401');
  });

  it('refuses an application that is not theirs and fires nothing', async () => {
    const { briefs, fire } = firing(STARTED);
    const jobs = fakeSchemaDb(tables())('job_search') as unknown as JobsClient;
    const result = await queueCoverLetter({ jobs, fire }, { userId: '22222222-2222-4222-8222-222222222222', applicationId: APP });
    expect(result).toEqual({ ok: false, error: 'That application is not yours.' });
    expect(briefs).toEqual([]);
  });
});

describe('settleLetterRequest and letterRequestOpen', () => {
  it('moves a request through drafting to done', async () => {
    const db: FakeTables = {
      'job_search.cover_letter_requests': [{ id: 'r1', user_id: ME, application_id: APP, status: 'queued' }],
    };
    const jobs = fakeSchemaDb(db)('job_search') as unknown as JobsClient;
    await settleLetterRequest(jobs, ME, 'r1', { status: 'drafting' });
    expect(db['job_search.cover_letter_requests'][0]).toMatchObject({ status: 'drafting' });
    await settleLetterRequest(jobs, ME, 'r1', { status: 'done' });
    expect(db['job_search.cover_letter_requests'][0]).toMatchObject({ status: 'done', error: null });
  });

  it('counts a request open only while queued or drafting and under an hour old', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    const at = (status: LetterRequest['status'], requestedAt: string): LetterRequest => ({
      id: 'r',
      applicationId: APP,
      status,
      error: null,
      requestedAt,
    });
    expect(letterRequestOpen(at('queued', '2026-11-20T11:50:00Z'), now)).toBe(true);
    expect(letterRequestOpen(at('drafting', '2026-11-20T11:50:00Z'), now)).toBe(true);
    expect(letterRequestOpen(at('drafting', '2026-11-20T10:30:00Z'), now)).toBe(false);
    expect(letterRequestOpen(at('done', '2026-11-20T11:50:00Z'), now)).toBe(false);
    expect(letterRequestOpen(null, now)).toBe(false);
  });
});
