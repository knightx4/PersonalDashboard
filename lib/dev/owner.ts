import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/auth/server';
import type { SessionUser } from '@/lib/auth/session-user';

/**
 * Whether the signed-in account is the one the Dev workspace belongs to.
 *
 * Three accounts sign in to this app and nothing here could tell them apart
 * until now. #413 settled where that fact lives: in the database, named by
 * `public.owner_email()` in migration 0085, and not in an environment
 * variable. So this module asks rather than decides -- it reads
 * `public.app_owner()` over the signed-in connection every other query already
 * uses, and compares the user id it gets back with the session's.
 *
 * Two things come out of that choice and are worth knowing before you call
 * this in a loop:
 *
 *   * It costs one round trip. Cheap, but not free, and it is a round trip per
 *     call rather than per request -- a page that needs the answer twice should
 *     read it once and pass it down.
 *   * It fails closed. A read that errors, a session that has expired, a
 *     database with no such account in it: all of them are "not the owner", so
 *     the failure mode is a dev page that will not open rather than one that
 *     opens for somebody else.
 *
 * The matching half of the same fact lives in `public.is_owner()`, which is
 * the same rule written for RLS. Use that in a policy; use this in the app.
 */

/** The owner as the database names them. */
export type Owner = { userId: string; email: string };

/**
 * The wire shape of `public.app_owner()`. Parsed rather than cast, for the
 * same reason `share_page()` is parsed in lib/share/read: the function is in a
 * migration and this is TypeScript, and nothing but this schema notices when
 * the two drift apart.
 */
const ownerSchema = z.object({ userId: z.string(), email: z.string() });

/** Thrown by `requireOwner` when a signed-in account is not the owner. */
export class NotTheOwnerError extends Error {
  constructor() {
    super('not the owner');
    this.name = 'NotTheOwnerError';
  }
}

export type OwnerCheck = {
  /**
   * The session, when the caller has already read it. Pass `null` for a
   * visitor who is signed out; leave it out and it is read here.
   */
  user?: SessionUser | null;
  /** The signed-in client, when the caller already made one. */
  supabase?: SupabaseClient;
};

/**
 * Who the database says the owner is, or null when it will not say.
 *
 * Null covers every way the answer can be missing -- the function refused, the
 * session has gone, no account with that address exists -- because the caller
 * does the same thing with all of them.
 */
export async function loadOwner(supabase: SupabaseClient): Promise<Owner | null> {
  try {
    const { data, error } = await supabase.rpc('app_owner');
    if (error) return null;
    const parsed = ownerSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The rule itself: this session, against that owner.
 *
 * On the user id rather than the email, because the id is the claim that is
 * always on the token and is what every row in this app is keyed by. The email
 * is what names the account in the migration; resolving it to an id is the
 * database's job, done once in `public.app_owner()`.
 */
export function isOwnerUser(user: SessionUser | null, owner: Owner | null): boolean {
  if (!user || !owner) return false;
  return user.id === owner.userId;
}

/** Whether the signed-in account is the owner. False for everyone else. */
export async function isOwner({ user, supabase }: OwnerCheck = {}): Promise<boolean> {
  const client = supabase ?? (await createClient());
  const session = user !== undefined ? user : await getUser();
  if (!session) return false;
  return isOwnerUser(session, await loadOwner(client));
}

/**
 * `isOwner`, but throws instead of returning false. For server actions, where
 * the check is the first line and there is nothing to render.
 *
 * Signed out throws `unauthenticated`, the same word `requireUser` throws, so a
 * caller can tell "sign in" from "this is not yours". Everything else throws
 * `NotTheOwnerError`.
 */
export async function requireOwner(options: OwnerCheck = {}): Promise<SessionUser> {
  const { user, supabase } = options;
  const client = supabase ?? (await createClient());
  const session = user !== undefined ? user : await getUser();
  if (!session) throw new Error('unauthenticated');
  if (!isOwnerUser(session, await loadOwner(client))) throw new NotTheOwnerError();
  return session;
}
