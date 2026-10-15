'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { DETAIL_KEYS, DETAIL_LABELS, DETAIL_MAX, whyNotSaved, type DetailKey, type Details } from '@/lib/you/details';
import { saveDetails } from '@/lib/you/details-store';

/** What the Details form shows after a save. */
export type DetailsFormState = {
  /** All six as saved, after a save that went through. */
  saved?: Details;
  /** What was typed, drawn again after a refused save. */
  values?: Record<DetailKey, string>;
  errors?: Partial<Record<DetailKey, string>>;
  error?: string;
};

/**
 * Save the six details from the Details tab's form (plan #2124.2). A field
 * left empty clears that detail. A refused save sends back what was typed,
 * since React clears a form after its action.
 */
// latency: pending
export async function saveDetailsForm(_prev: DetailsFormState, form: FormData): Promise<DetailsFormState> {
  const user = await requireUser();
  const values = {} as Record<DetailKey, string>;
  for (const key of DETAIL_KEYS) {
    const value = form.get(key);
    values[key] = typeof value === 'string' ? value : '';
  }

  const errors: Partial<Record<DetailKey, string>> = {};
  for (const key of DETAIL_KEYS) {
    if (values[key].trim().length > DETAIL_MAX[key]) {
      errors[key] = `${DETAIL_LABELS[key]} can be at most ${DETAIL_MAX[key]} characters.`;
    }
  }
  if (Object.keys(errors).length > 0) return { errors, values };

  let saved: Details;
  try {
    saved = await saveDetails(await createYouClient(), user.id, values);
  } catch (error) {
    return { error: whyNotSaved(error), values };
  }

  revalidatePath('/you/details');
  return { saved };
}
