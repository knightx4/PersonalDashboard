'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PERSON_COLOURS } from '@/lib/people/load';

/**
 * Managing the people an account shops for.
 *
 * Everything here writes to core, because a person is attached to a mailbox
 * and the mailbox is core's. The commerce tables reference the same rows
 * across the schema boundary.
 */

export type PeopleState = { error?: string; message?: string };

/** Every page that shows a person's name or badge. */
function revalidatePeople(): void {
  for (const path of [
    '/shopping/settings',
    '/shopping/orders',
    '/shopping/inventory',
    '/shopping/dashboard',
  ]) {
    revalidatePath(path);
  }
}

const addSchema = z.object({
  name: z.string().trim().min(1, 'Give them a name.').max(60, 'That name is too long.'),
  colour: z.enum(PERSON_COLOURS).default('brand'),
});

export async function addPerson(_prev: PeopleState, formData: FormData): Promise<PeopleState> {
  const parsed = addSchema.safeParse({
    name: formData.get('name') ?? '',
    colour: formData.get('colour') || 'brand',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const core = await createCoreClient();

  // The first person added becomes the default, so a fresh account never has
  // manual orders with nowhere to go.
  const { count } = await core
    .from('people')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const { error } = await core.from('people').insert({
    user_id: user.id,
    name: parsed.data.name,
    colour: parsed.data.colour,
    is_default: (count ?? 0) === 0,
  });

  if (error) {
    // The unique index is case-insensitive on purpose; say so rather than
    // showing the constraint name.
    if (error.code === '23505') return { error: 'Somebody with that name is already on the list.' };
    return { error: error.message };
  }

  revalidatePeople();
  return { message: `${parsed.data.name} added.` };
}

const updateSchema = z.object({
  personId: z.string().uuid(),
  name: z.string().trim().min(1).max(60).optional(),
  colour: z.enum(PERSON_COLOURS).optional(),
});

export async function updatePerson(
  input: z.input<typeof updateSchema>,
): Promise<{ error: string | null }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const core = await createCoreClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.colour !== undefined) patch.colour = parsed.data.colour;

  const { error } = await core
    .from('people')
    .update(patch)
    .eq('id', parsed.data.personId)
    .eq('user_id', user.id);

  if (error) {
    if (error.code === '23505') return { error: 'Somebody with that name is already on the list.' };
    return { error: error.message };
  }

  revalidatePeople();
  return { error: null };
}

/**
 * Remove a person. Their shopping stays.
 *
 * Every reference is `on delete set null`, so the orders and items they were
 * attached to become unattributed rather than disappearing. An order that
 * happened still happened, and deleting somebody's purchase history because a
 * label was wrong would be the worst possible reading of this button.
 */
export async function removePerson(personId: string): Promise<{ error: string | null }> {
  const parsed = z.string().uuid().safeParse(personId);
  if (!parsed.success) return { error: 'That is not a person.' };

  const user = await requireUser();
  const core = await createCoreClient();

  const { error } = await core
    .from('people')
    .delete()
    .eq('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePeople();
  return { error: null };
}

const assignSchema = z.object({
  accountId: z.string().uuid(),
  // Empty string is "nobody", which is a legitimate choice and not a failure.
  personId: z.union([z.string().uuid(), z.literal('')]),
});

/**
 * Say whose mailbox this is.
 *
 * The single most load-bearing setting in the feature: every order imported
 * from here inherits it, which is what makes the split happen without anybody
 * tagging anything by hand.
 */
export async function assignInboxToPerson(
  input: z.input<typeof assignSchema>,
): Promise<{ error: string | null }> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const core = await createCoreClient();

  const { error } = await core
    .from('email_accounts')
    .update({
      person_id: parsed.data.personId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.accountId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  // Apply it to what this mailbox already imported, not only to what arrives
  // next. Without this, setting the people up after the first sync leaves
  // every order from it unattributed. See core.attribute_mailbox().
  const { error: attributionError } = await core.rpc('attribute_mailbox', {
    p_account_id: parsed.data.accountId,
  });
  if (attributionError) {
    // The mailbox is assigned either way; only the backfill failed, and the
    // next assignment or sync will pick it up.
    console.error('mailbox re-attribution failed', attributionError.message);
  }

  revalidatePeople();
  return { error: null };
}
