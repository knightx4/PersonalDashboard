import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import { encryptToken } from '@/lib/crypto/tokens';

/**
 * Adding and removing a subscription.
 *
 * The address is encrypted before it reaches the database, by the same helper
 * and the same key the mailbox tokens use. The table's own check constraint
 * refuses anything that did not come out of encryptToken(), so a caller that
 * forgets is refused rather than quietly storing a private link in plain text.
 */

/**
 * What the form can send.
 *
 * webcal:// is what a calendar app hands you when you press subscribe, so it
 * is accepted here and turned into https when the address is read. http:// is
 * refused outright: the address is a credential and sending it in the clear is
 * not something to warn about after the fact.
 */
export const feedInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the calendar a name.')
    .max(200, 'That name is too long.'),
  address: z
    .string()
    .trim()
    .min(1, 'Paste the calendar address.')
    .max(2000, 'That address is too long.')
    .refine(
      (value) => /^(https|webcal):\/\//i.test(value),
      'That address must start with https:// or webcal://.',
    ),
});

export type FeedInput = z.infer<typeof feedInput>;

const keyEnv = z.object({ TOKEN_ENCRYPTION_KEY: z.string().min(1) });

export async function createFeed(
  userId: string,
  input: FeedInput,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createTodoClient();

  let address: string;
  try {
    address = encryptToken(input.address, keyEnv.parse(process.env).TOKEN_ENCRYPTION_KEY);
  } catch {
    return { id: null, error: 'This app cannot store a calendar address right now.' };
  }

  const { data, error } = await supabase
    .from('calendar_feeds')
    .insert({ user_id: userId, name: input.name, address })
    .select('id')
    .single();

  return { id: (data?.id as string) ?? null, error: error?.message ?? null };
}

/**
 * Draw a subscription, or stop drawing it.
 *
 * The other switch a subscription has, and the reason it needed one: turning a
 * noisy calendar off used to mean deleting it and pasting the address back in
 * afterwards. Nothing is removed here -- the appointments stay in the table
 * and simply are not read, so switching it back on costs no re-fetch.
 */
export async function setFeedShown(
  userId: string,
  id: string,
  shown: boolean,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('calendar_feeds')
    .update({ shown })
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

/** Remove a subscription. Its appointments go with it, by the foreign key. */
export async function deleteFeed(userId: string, id: string): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('calendar_feeds')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}
