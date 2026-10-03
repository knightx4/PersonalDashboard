import { describe, expect, it, vi } from 'vitest';
import { undoDashAction } from '@/lib/core/dash-actions';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '../../../tests/stubs/fake-schema-db';

/**
 * The cover letter a role comment files is recorded in core.dash_actions with
 * the application before and after (plan #1459), and undoing it puts the old
 * letter back. The model is stubbed; the database is one in memory.
 */

const mocks = vi.hoisted(() => ({ askRoleReplyModel: vi.fn() }));
vi.mock('./model', () => ({ askRoleReplyModel: mocks.askRoleReplyModel }));
vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));

import { askDashOnRole } from './ask';

const ME = '00000000-0000-4000-8000-0000000000bb';
const ROLE = '00000000-0000-4000-8000-000000000201';
const APPLICATION = '00000000-0000-4000-8000-000000000202';

function setup(coverLetter: string | null) {
  const tables: FakeTables = {
    'job_search.roles': [
      {
        id: ROLE,
        user_id: ME,
        title: 'Staff Engineer',
        seniority: null,
        location: null,
        work_mode: null,
        jd_text: 'Build things.',
        requirement_matches: [],
        companies: { name: 'Acme', industry: null, stage: null, research: null },
      },
    ],
    'job_search.applications': [
      { id: APPLICATION, user_id: ME, role_id: ROLE, attempt: 1, status: 'drafting', cover_letter: coverLetter, updated_at: '2026-10-01T09:00:00Z' },
    ],
    'job_search.notes': [{ id: 'q', user_id: ME, role_id: ROLE, author: 'me', body: '@dash write my letter', created_at: '2026-10-03T08:00:00Z' }],
  };
  const dash = fakeDashDeps(tables, ME);
  const client = fakeSchemaDb(tables)('job_search') as unknown as AppSupabaseClient;
  return { tables, dash, client };
}

const ask = (client: AppSupabaseClient, dash: ReturnType<typeof fakeDashDeps>) =>
  askDashOnRole({ client, userId: ME, roleId: ROLE, commentId: 'q', question: 'write my letter', apiKey: 'key', dash });

describe('a cover letter written from a role comment', () => {
  it('is recorded with the letter it replaced, and undoing it puts that letter back', async () => {
    mocks.askRoleReplyModel.mockResolvedValue({ ok: true, input: { answer: '', cover_letter: 'Dear Acme, the new letter.' } });
    const { tables, dash, client } = setup('The letter I wrote myself.');

    const outcome = await ask(client, dash);
    expect(outcome).toEqual({ ok: true, message: 'Cover letter written, under Application.' });
    expect(tables['job_search.applications'][0].cover_letter).toBe('Dear Acme, the new letter.');

    const [action] = tables['core.dash_actions'];
    expect(action).toMatchObject({
      surface: 'thread',
      kind: 'write_cover_letter',
      status: 'done',
      op: 'update',
      subject_ref: `job_search.applications:${APPLICATION}`,
      before_values: { cover_letter: 'The letter I wrote myself.' },
      after_values: { cover_letter: 'Dear Acme, the new letter.' },
      summary: 'Rewrote the cover letter for Staff Engineer at Acme.',
    });

    expect((await undoDashAction(dash, action.id as string)).ok).toBe(true);
    expect(tables['job_search.applications'][0].cover_letter).toBe('The letter I wrote myself.');
  });

  it('records nothing when the reply only answers', async () => {
    mocks.askRoleReplyModel.mockResolvedValue({ ok: true, input: { answer: 'It asks for Go.' } });
    const { tables, dash, client } = setup(null);
    await ask(client, dash);
    expect(tables['core.dash_actions'] ?? []).toHaveLength(0);
  });
});
