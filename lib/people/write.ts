import type { SchemaClient } from '@/lib/ask/db';
import type { PersonColour } from './load';

/**
 * Adding and changing someone the person shops for (core.people), as
 * Shopping's settings page and Dash's change_person both do it (plan
 * #2473.4). Each takes the user explicitly, so it works the same on the
 * page's client (RLS) and on the connector's service role. The name comes
 * in already trimmed and checked by the caller.
 */

type Row = Record<string, unknown>;
type Client = SchemaClient;

/** The case-insensitive unique index on (user_id, name) refused it. */
export const PERSON_TAKEN = 'Somebody with that name is already on the list.';

export type PersonWrite = { person: Row; error?: undefined; taken?: undefined } | { person?: undefined; error: string; taken?: boolean };

function failed(error: { code?: string; message: string }): PersonWrite {
  return error.code === '23505' ? { error: PERSON_TAKEN, taken: true } : { error: error.message };
}

/** Add someone. The first person added becomes the default, so manual orders always have somewhere to go. */
export async function addPersonRow(
  core: Client,
  opts: { userId: string; name: string; colour: PersonColour },
): Promise<PersonWrite> {
  const { data: existing, error: readError } = await core.from('people').select('id').eq('user_id', opts.userId);
  if (readError) return { error: readError.message };
  const { data, error } = await core
    .from('people')
    .insert({ user_id: opts.userId, name: opts.name, colour: opts.colour, is_default: (existing ?? []).length === 0 })
    .select('*')
    .single();
  if (error) return failed(error);
  if (!data) return { error: 'The person was not added.' };
  return { person: data as Row };
}

/** Rename someone or give them another colour. */
export async function updatePersonRow(
  core: Client,
  opts: { userId: string; personId: string; name?: string; colour?: PersonColour },
): Promise<PersonWrite> {
  const patch: Row = { updated_at: new Date().toISOString() };
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.colour !== undefined) patch.colour = opts.colour;
  const { data, error } = await core
    .from('people')
    .update(patch)
    .eq('id', opts.personId)
    .eq('user_id', opts.userId)
    .select('*')
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { error: 'That person is no longer on the list.' };
  return { person: data as Row };
}
