'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { checkPlace, placeHref, type PlaceDraft } from '@/lib/you/places';
import { deletePlace, insertPlace, updatePlace } from '@/lib/you/places-store';

/** What the place form shows after a save that did not go through. */
export type PlaceFormState = {
  errors?: Partial<Record<keyof PlaceDraft, string>>;
  error?: string;
  /** What was typed, drawn again after a refused save. */
  values?: PlaceDraft;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function draftFrom(form: FormData): PlaceDraft {
  const read = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };
  return {
    name: read('name'),
    city: read('city'),
    region: read('region'),
    country: read('country'),
    movedIn: read('moved_in'),
    movedOut: read('moved_out'),
    note: read('note'),
  };
}

/**
 * Add a place, or change one when the form carries its id, then open it.
 * The form keeps what was typed when a field is refused.
 */
// latency: pending
export async function savePlace(_prev: PlaceFormState, form: FormData): Promise<PlaceFormState> {
  const user = await requireUser();
  const values = draftFrom(form);
  const checked = checkPlace(values);
  if (!checked.ok) return { errors: checked.errors, values };

  const idValue = form.get('id');
  const id = typeof idValue === 'string' && idValue ? idValue : null;
  if (id !== null && !UUID.test(id)) return { error: 'That place could not be found.', values };

  const client = await createYouClient();
  let savedId: string;
  try {
    if (id) {
      const row = await updatePlace(client, user.id, id, checked.row);
      if (!row) return { error: 'That place is not there any more.', values };
      savedId = id;
    } else {
      const row = await insertPlace(client, user.id, checked.row);
      savedId = String(row.id);
    }
  } catch {
    return { error: 'The place did not save. Try again.', values };
  }

  revalidatePath('/you/places');
  revalidatePath(placeHref(savedId));
  redirect(placeHref(savedId));
}

/** Remove a place for good, then go back to the list. */
// latency: pending
export async function removePlace(form: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const idValue = form.get('id');
  const id = typeof idValue === 'string' ? idValue : '';
  if (!UUID.test(id)) return { error: 'That place could not be found.' };

  try {
    await deletePlace(await createYouClient(), user.id, id);
  } catch {
    return { error: 'The place was not removed. Try again.' };
  }

  revalidatePath('/you/places');
  redirect('/you/places');
}
