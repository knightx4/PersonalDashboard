/**
 * Deleting the account clears this app's buckets as well as its rows.
 *
 * Rows go with auth.users (tests/account-cascade.test.ts holds that rule);
 * storage objects do not, so the route removes them itself. Pinned here: the
 * goals documents folder and the vault attachments folder, nested one folder
 * per connection, are both gone afterwards, and nobody else's files are
 * touched. Every client shares one fake project, as they share one real one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from './stubs/fake-storage';

const state = vi.hoisted(() => ({
  store: null as null | ReturnType<typeof import('./stubs/fake-storage').fakeStorage>,
  deleted: [] as string[],
}));

const rows = () => ({
  select: () => ({ eq: async () => ({ data: [], error: null }) }),
});

vi.mock('@/lib/auth/server', () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: 'user-1', email: 'a@example.com' } } }),
      signOut: async () => ({ error: null }),
    },
  }),
}));
vi.mock('@/lib/jobs/auth/server', () => ({
  createClient: async () => ({ from: rows, storage: state.store!.client.storage }),
}));
vi.mock('@/lib/core/auth/server', () => ({ createCoreClient: async () => ({ from: rows }) }));
vi.mock('@/lib/goals/auth/server', () => ({
  createGoalsClient: async () => ({ storage: state.store!.client.storage }),
}));
vi.mock('@/lib/goals/extract', () => ({ DOCUMENT_BUCKET: 'goals-documents' }));
vi.mock('@/lib/crypto/tokens', () => ({ decryptToken: () => '' }));
vi.mock('@/lib/email/providers/gmail', () => ({ gmailProvider: { revokeToken: async () => {} } }));
vi.mock('@/inngest/jobs/supabase-admin', () => ({
  createServiceSupabase: () => ({
    storage: state.store!.client.storage,
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          state.deleted.push(id);
          return { error: null };
        },
      },
    },
  }),
}));

const { POST } = await import('@/app/api/account/delete/route');

function request(confirm: string) {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    body: JSON.stringify({ confirm }),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  state.deleted = [];
  state.store = fakeStorage({
    'goals-documents': ['user-1/form.pdf', 'user-2/theirs.pdf'],
    'vault-attachments': [
      'user-1/conn-1/aaa',
      'user-1/conn-1/bbb',
      'user-1/conn-2/ccc',
      'user-2/conn-9/ddd',
    ],
    'vault-transcripts': ['user-1/t1-record.pdf', 'user-2/t2-theirs.pdf'],
  });
});

describe('POST /api/account/delete', () => {
  it('removes the vault attachments, transcripts and goals documents folders', async () => {
    const res = await POST(request('delete everything'));

    expect(res.status).toBe(200);
    expect(state.deleted).toEqual(['user-1']);
    expect(state.store!.left('vault-attachments')).toEqual(['user-2/conn-9/ddd']);
    expect(state.store!.left('goals-documents')).toEqual(['user-2/theirs.pdf']);
    expect(state.store!.left('vault-transcripts')).toEqual(['user-2/t2-theirs.pdf']);
  });

  it('removes nothing without the confirmation', async () => {
    const res = await POST(request('delete'));

    expect(res.status).toBe(400);
    expect(state.deleted).toEqual([]);
    expect(state.store!.left('vault-attachments')).toHaveLength(4);
  });
});
