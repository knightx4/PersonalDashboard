'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { checkPlace, placeHref, type PlaceDraft } from '@/lib/you/places';
import { checkPosition, type PlacesMapDrawing } from '@/lib/you/places-map';
import { drawWorldMap } from '@/lib/you/places-map-outlines';
import { deletePlace, setPlacePosition, updatePlace } from '@/lib/you/places-store';

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
 * Change a place from its edit form, then open it. A new place is added
 * through capture (plan #1950.7), so the form always carries an id. The
 * form keeps what was typed when a field is refused.
 */
// latency: pending
export async function savePlace(_prev: PlaceFormState, form: FormData): Promise<PlaceFormState> {
  const user = await requireUser();
  const values = draftFrom(form);
  const checked = checkPlace(values);
  if (!checked.ok) return { errors: checked.errors, values };

  const idValue = form.get('id');
  const id = typeof idValue === 'string' ? idValue : '';
  if (!UUID.test(id)) return { error: 'That place could not be found.', values };

  try {
    const row = await updatePlace(await createYouClient(), user.id, id, checked.row);
    if (!row) return { error: 'That place is not there any more.', values };
  } catch {
    return { error: 'The place did not save. Try again.', values };
  }

  revalidatePath('/you/places');
  revalidatePath(placeHref(id));
  redirect(placeHref(id));
}

/**
 * Put a place on the map where it was pressed, or take it off with null
 * (plan #2091.5). The place's page and the map are drawn again with it.
 */
// latency: pending
export async function placeOnMap(id: string, position: unknown): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!UUID.test(id)) return { error: 'That place could not be found.' };
  const checked = position === null ? null : checkPosition(position);
  if (position !== null && !checked) return { error: 'That is not a spot on the map.' };

  try {
    const found = await setPlacePosition(await createYouClient(), user.id, id, checked);
    if (!found) return { error: 'That place is not there any more.' };
  } catch {
    return { error: checked ? 'The place was not put on the map. Try again.' : 'The place was not taken off the map. Try again.' };
  }

  revalidatePath('/you/places');
  revalidatePath(placeHref(id));
  return {};
}

/** The whole world, drawn on the server, for placing a place outside the region the page shows. */
// latency: pending
export async function worldMap(): Promise<PlacesMapDrawing> {
  await requireUser();
  return drawWorldMap();
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
