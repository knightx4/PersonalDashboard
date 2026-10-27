'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import {
  checkCustomFields,
  customFieldErrors,
  DETAIL_KEYS,
  DETAIL_LABELS,
  DETAIL_MAX,
  letterheadFrom,
  readCustomFields,
  whyNotSaved,
  type CustomField,
  type DetailKey,
  type Details,
  type Letterhead,
} from '@/lib/you/details';
import { getDetails, saveDetails } from '@/lib/you/details-store';

/** What the Details form shows after a save. */
export type DetailsFormState = {
  /** The fixed details and their own fields as saved, after a save that went through. */
  saved?: Details;
  /** What was typed, drawn again after a refused save. */
  values?: Record<DetailKey, string>;
  errors?: Partial<Record<DetailKey, string>>;
  /** Their own fields as typed, drawn again after a refused save (plan #2531.2). */
  fields?: CustomField[];
  /** What is wrong with each of their own fields, by its id. */
  fieldErrors?: Record<string, string>;
  error?: string;
};

/**
 * Save the fixed details and their own fields from the Details tab's form
 * (plan #2124.2, #2531.2). A field left empty clears that detail. Their own
 * fields come as one hidden `custom_fields` JSON list that replaces the
 * stored one; a form without it leaves the list alone. A refused save sends
 * back what was typed, since React clears a form after its action.
 */
// latency: pending
export async function saveDetailsForm(_prev: DetailsFormState, form: FormData): Promise<DetailsFormState> {
  const user = await requireUser();
  const values = {} as Record<DetailKey, string>;
  for (const key of DETAIL_KEYS) {
    const value = form.get(key);
    values[key] = typeof value === 'string' ? value : '';
  }

  const rawFields = form.get('custom_fields');
  let parsed: unknown = undefined;
  if (typeof rawFields === 'string') {
    try {
      parsed = JSON.parse(rawFields);
    } catch {
      return { error: 'Your own fields did not reach the server whole. Press Save to try again.', values };
    }
  }
  const fields = parsed === undefined ? undefined : readCustomFields(parsed);

  const errors: Partial<Record<DetailKey, string>> = {};
  for (const key of DETAIL_KEYS) {
    if (values[key].trim().length > DETAIL_MAX[key]) {
      errors[key] = `${DETAIL_LABELS[key]} can be at most ${DETAIL_MAX[key]} characters.`;
    }
  }
  const fieldErrors = fields ? customFieldErrors(fields) : {};
  const listProblem = parsed === undefined ? null : checkCustomFields(parsed);
  if (Object.keys(errors).length > 0 || Object.keys(fieldErrors).length > 0) {
    return { errors, values, fields, fieldErrors };
  }
  if (listProblem) return { error: listProblem, values, fields };

  let saved: Details;
  try {
    saved = await saveDetails(await createYouClient(), user.id, {
      ...values,
      ...(fields ? { custom_fields: fields } : {}),
    });
  } catch (error) {
    return { error: whyNotSaved(error), values, fields };
  }

  revalidatePath('/you/details');
  return { saved };
}

/**
 * Who signs a cover letter and its contact line, from their details, for the
 * PDF the roles page builds in the browser. Empty, rather than an error, when
 * the read fails, so the letter still downloads, signed without them.
 */
export async function letterheadAction(): Promise<Letterhead> {
  const user = await requireUser();
  try {
    return letterheadFrom(await getDetails(await createYouClient(), user.id));
  } catch {
    return { signer: null, contact: null };
  }
}
