'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { confirmFamily, rejectFamily } from '@/lib/share/families-store';
import type { ShareActionState } from '../actions';

const memberSchema = z.object({
  inventoryItemId: z.string().uuid(),
  role: z.enum(['base', 'expansion', 'edition', 'accessory', 'member']),
  confidence: z.number().min(0).max(1),
});

export async function acceptFamily(input: {
  slug: string;
  name: string;
  members: Array<{ inventoryItemId: string; role: string; confidence: number }>;
}): Promise<ShareActionState> {
  const parsed = z
    .object({
      slug: z.string().min(1).max(80),
      name: z.string().min(1).max(80),
      members: z.array(memberSchema).min(2).max(200),
    })
    .safeParse(input);
  if (!parsed.success) return { error: 'That is not a group.' };

  const user = await requireUser();
  const supabase = await createClient();

  try {
    const count = await confirmFamily(supabase, user.id, parsed.data);
    revalidatePath('/shopping/share/families');
    revalidatePath('/shopping/share');
    return { message: `Grouped ${count} games under ${parsed.data.name}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not group those.' };
  }
}

/**
 * Refusing a suggestion, permanently.
 *
 * Writes a tombstone rather than doing nothing, so the same proposal does not
 * come back on the next visit. That is the difference between a suggestion
 * engine people use and one they learn to ignore.
 */
export async function dismissFamily(input: {
  slug: string;
  name: string;
  inventoryItemIds: string[];
}): Promise<ShareActionState> {
  const parsed = z
    .object({
      slug: z.string().min(1).max(80),
      name: z.string().min(1).max(80),
      inventoryItemIds: z.array(z.string().uuid()).min(1).max(200),
    })
    .safeParse(input);
  if (!parsed.success) return { error: 'That is not a group.' };

  const user = await requireUser();
  const supabase = await createClient();

  try {
    await rejectFamily(supabase, user.id, parsed.data);
    revalidatePath('/shopping/share/families');
    return { message: 'Noted — these will not be suggested again.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not dismiss that.' };
  }
}
