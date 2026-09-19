import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NotTheOwnerError,
  isOwner,
  isOwnerUser,
  loadOwner,
  requireOwner,
  type Owner,
} from '@/lib/dev/owner';
import type { SessionUser } from '@/lib/auth/session-user';

/**
 * The three accounts that sign in to this app, as the database has them. The
 * ids stand in for the real ones -- what matters is that one of them is the
 * row `public.app_owner()` returns and the other two are not.
 */
const OWNER: Owner = { userId: 'owner-id', email: 'selveyknight4@gmail.com' };
const OTHER_ACCOUNTS: SessionUser[] = [
  { id: 'other-id-1', email: 'ckloug4@gmail.com' },
  { id: 'other-id-2', email: 'averyjadek@gmail.com' },
];
const OWNER_SESSION: SessionUser = { id: OWNER.userId, email: OWNER.email };

/**
 * A client standing in for the database's answer. `app_owner()` is the only
 * thing this module calls, so the fake is that one function -- and it records
 * the name, because calling something else would pass every assertion below
 * while reading nothing.
 */
function fakeClient(response: { data?: unknown; error?: unknown }): {
  client: SupabaseClient;
  calls: string[];
} {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      return { data: response.data ?? null, error: response.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const answering = (owner: Owner | null) => fakeClient({ data: owner }).client;

describe('isOwner', () => {
  it('is true for the account the database names', async () => {
    expect(await isOwner({ user: OWNER_SESSION, supabase: answering(OWNER) })).toBe(true);
  });

  it.each(OTHER_ACCOUNTS)('is false for $email', async (account) => {
    expect(await isOwner({ user: account, supabase: answering(OWNER) })).toBe(false);
  });

  it('is false signed out', async () => {
    expect(await isOwner({ user: null, supabase: answering(OWNER) })).toBe(false);
  });

  it('reads the owner from the database rather than deciding here', async () => {
    const { client, calls } = fakeClient({ data: OWNER });
    await isOwner({ user: OWNER_SESSION, supabase: client });
    expect(calls).toEqual(['app_owner']);
  });

  // Fails closed: a dev page that will not open, never one that opens for
  // somebody else.
  it('is false when the database will not answer', async () => {
    const refused = fakeClient({ error: { message: 'permission denied' } }).client;
    expect(await isOwner({ user: OWNER_SESSION, supabase: refused })).toBe(false);
    expect(await isOwner({ user: OWNER_SESSION, supabase: answering(null) })).toBe(false);
  });
});

describe('requireOwner', () => {
  it('hands back the session for the owner', async () => {
    expect(await requireOwner({ user: OWNER_SESSION, supabase: answering(OWNER) })).toEqual(
      OWNER_SESSION,
    );
  });

  it.each(OTHER_ACCOUNTS)('throws for $email', async (account) => {
    await expect(requireOwner({ user: account, supabase: answering(OWNER) })).rejects.toThrow(
      NotTheOwnerError,
    );
  });

  // Two different problems, so two different errors: one is "sign in", the
  // other is "this is not yours".
  it('throws unauthenticated signed out', async () => {
    await expect(requireOwner({ user: null, supabase: answering(OWNER) })).rejects.toThrow(
      'unauthenticated',
    );
  });
});

describe('loadOwner', () => {
  it('reads the row the migration returns', async () => {
    expect(await loadOwner(answering(OWNER))).toEqual(OWNER);
  });

  it('is null on a shape it does not recognise', async () => {
    expect(await loadOwner(fakeClient({ data: { userId: 7 } }).client)).toBeNull();
  });
});

describe('isOwnerUser', () => {
  it('matches on the user id, not the address', async () => {
    const impostor: SessionUser = { id: 'other-id-1', email: OWNER.email };
    expect(isOwnerUser(impostor, OWNER)).toBe(false);
    expect(isOwnerUser({ id: OWNER.userId }, OWNER)).toBe(true);
  });

  it('is false with nothing to compare', () => {
    expect(isOwnerUser(null, OWNER)).toBe(false);
    expect(isOwnerUser(OWNER_SESSION, null)).toBe(false);
  });
});
