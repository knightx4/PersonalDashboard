import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA } from '@/lib/core/db/schema-name';

/**
 * The people an account shops for.
 *
 * One login, several people. This is not a membership model and deliberately
 * so -- there is one user_id and one session, and a person is a label on a
 * mailbox and on the orders that came from it. See migration 0030.
 */

/** Palette tokens rather than hex, so a person's colour survives a theme. */
export const PERSON_COLOURS = ['brand', 'orange', 'pink', 'green', 'purple', 'slate'] as const;
export type PersonColour = (typeof PERSON_COLOURS)[number];

export interface Person {
  id: string;
  name: string;
  colour: PersonColour;
  isDefault: boolean;
}

/**
 * Tailwind classes per colour, written out in full.
 *
 * Not interpolated (`bg-${colour}-tint`): Tailwind scans source text for class
 * names, and a name assembled at runtime is never in the output CSS. A badge
 * with no background is the failure that produces.
 */
export const PERSON_BADGE_CLASS: Record<PersonColour, string> = {
  brand: 'bg-brand-tint text-brand',
  orange: 'bg-accent-orange-tint text-accent-orange',
  pink: 'bg-accent-pink-tint text-accent-pink',
  green: 'bg-status-offer-tint text-status-offer',
  purple: 'bg-status-final-tint text-status-final',
  slate: 'bg-status-lead-tint text-status-lead',
};

export const PERSON_DOT_CLASS: Record<PersonColour, string> = {
  brand: 'bg-brand',
  orange: 'bg-accent-orange',
  pink: 'bg-accent-pink',
  green: 'bg-status-offer',
  purple: 'bg-status-final',
  slate: 'bg-status-lead',
};

function toPerson(row: Record<string, unknown>): Person {
  const colour = row.colour as string;
  return {
    id: row.id as string,
    name: row.name as string,
    // A colour the database allows but the app has not heard of should not
    // render as a missing class.
    colour: (PERSON_COLOURS as readonly string[]).includes(colour)
      ? (colour as PersonColour)
      : 'brand',
    isDefault: Boolean(row.is_default),
  };
}

/**
 * Everyone on the account, default first then alphabetical.
 *
 * Takes a client rather than building one, like everything else in lib/.
 */
export async function loadPeople(
  core: CoreSupabaseClient,
  userId: string,
): Promise<Person[]> {
  const { data, error } = await core
    .from('people')
    .select('id, name, colour, is_default')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('name');

  assertSchemaExposed(error, CORE_SCHEMA);
  return (data ?? []).map(toPerson);
}

/** Id → person, for labelling rows without a join PostgREST cannot do. */
export function peopleById(people: readonly Person[]): Map<string, Person> {
  return new Map(people.map((person) => [person.id, person]));
}

/**
 * The person a manual order belongs to unless told otherwise.
 *
 * The account owner, which the migration seeded as the oldest mailbox's
 * person. Null when nobody has been set up yet, which is the normal state
 * before the feature is used and must not become a blocker.
 */
export function defaultPerson(people: readonly Person[]): Person | null {
  return people.find((person) => person.isDefault) ?? people[0] ?? null;
}

/** Resolve `?person=` into an id, ignoring one that is not on the account. */
export function parsePersonFilter(
  value: string | undefined,
  people: readonly Person[],
): string | null {
  if (!value) return null;
  return people.some((person) => person.id === value) ? value : null;
}
