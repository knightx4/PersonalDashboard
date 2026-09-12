import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { decryptToken } from '@/lib/crypto/tokens';
import { TODO_SCHEMA } from '@/lib/todo/db/schema-name';

/**
 * Reading your subscriptions, and the appointments they brought.
 *
 * The address never comes back out of here. It is the credential -- anyone
 * holding a private Google link can read the whole calendar -- so what the
 * settings page gets is a hint: the host it points at and the last few
 * characters, which is enough to tell two subscriptions apart and no use to
 * anybody reading over a shoulder.
 */

export interface Feed {
  id: string;
  name: string;
  /** Enough of the address to recognise it. Never the whole thing. */
  hint: string;
  /** When it was last read successfully. Null until the first good read. */
  lastReadAt: string | null;
  /** Why the last attempt failed, or null. Set with lastReadAt still standing. */
  lastError: string | null;
  createdAt: string;
}

const keyEnv = z.object({ TOKEN_ENCRYPTION_KEY: z.string().min(1) });

/** Your subscriptions, oldest first, as they were added. */
export async function loadFeeds(userId: string): Promise<Feed[]> {
  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('calendar_feeds')
    .select('id, name, address, last_read_at, last_error, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  const key = keyEnv.safeParse(process.env);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    hint: key.success ? hintFor(row.address as string, key.data.TOKEN_ENCRYPTION_KEY) : 'a calendar',
    lastReadAt: (row.last_read_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/**
 * As much of an address as is safe to show.
 *
 * The host, which says whose calendar it is, and the last four characters,
 * which tell two calendars on the same host apart. A row that cannot be
 * decrypted says so rather than showing nothing, because that is a thing to
 * act on -- the key changed, and the subscription has to be added again.
 */
export function hintFor(ciphertext: string, key: string): string {
  let address: string;
  try {
    address = decryptToken(ciphertext, key);
  } catch {
    return 'unreadable — add it again';
  }

  try {
    const url = new URL(address.replace(/^webcal:/i, 'https:'));
    return `${url.host} …${address.slice(-4)}`;
  } catch {
    return `…${address.slice(-4)}`;
  }
}
