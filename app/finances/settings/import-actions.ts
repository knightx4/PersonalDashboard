'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { parseBalance, parseDay, parseOptionalBalance } from '@/lib/finances/import/input';
import {
  addManualAccount,
  importStatement,
  MANUAL_KINDS,
  previewStatement,
  type ImportPreview,
} from '@/lib/finances/import/store';
import { parseWalletExport } from '@/lib/finances/import/wallet';
import type { AccountKind } from '@/lib/finances/accounts';

/**
 * Finances settings' import and manual-account actions (plan #2593.5). Each
 * returns what the page shows rather than throwing. The statement is read
 * again on import rather than trusting the preview the browser holds.
 */

export type ImportActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function refresh(accountId?: string) {
  revalidatePath('/finances/settings');
  revalidatePath('/finances/accounts');
  revalidatePath('/finances/spending');
  if (accountId) revalidatePath(`/finances/accounts/${accountId}`);
}

/** What importing the file would add: the count, how many are new, the closing balance. */
// latency: pending
export async function previewImport(
  text: string,
): Promise<ImportActionResult<{ preview: ImportPreview }>> {
  const user = await requireUser();
  const parsed = parseWalletExport(text);
  if (!parsed.ok) return parsed;
  try {
    return {
      ok: true,
      preview: await previewStatement(await createClient(), user.id, parsed.statement),
    };
  } catch (error) {
    console.error('Previewing an import failed', error);
    return {
      ok: false,
      error: 'The statement could not be checked against what is already imported. Try again.',
    };
  }
}

/** Imports the file into the Apple Card account, with the closing balance given. */
// latency: pending
export async function commitImport(
  text: string,
  closingBalance: string | null,
): Promise<ImportActionResult<{ accountId: string; added: number; skipped: number }>> {
  const user = await requireUser();
  const parsed = parseWalletExport(text);
  if (!parsed.ok) return parsed;
  const balance = parseOptionalBalance(closingBalance);
  if (!balance.ok) return balance;
  try {
    const result = await importStatement(
      await createClient(),
      user.id,
      parsed.statement,
      balance.cents,
    );
    refresh(result.accountId);
    return { ok: true, ...result };
  } catch (error) {
    console.error('Importing a statement failed', error);
    return {
      ok: false,
      error: 'The statement could not be imported. Nothing was added; try again.',
    };
  }
}

const accountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the account.')
    .max(200, 'Shorten the name to 200 characters.'),
  kind: z.enum(MANUAL_KINDS as [AccountKind, ...AccountKind[]]),
  institutionName: z.string().trim().max(200).optional(),
  balance: z.string(),
  readOn: z.string(),
});

/** Adds an account kept by hand, with its first balance. */
// latency: pending
export async function addAccount(input: {
  name: string;
  kind: string;
  institutionName?: string;
  balance: string;
  readOn: string;
}): Promise<ImportActionResult<{ accountId: string }>> {
  const user = await requireUser();
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the fields.' };
  const balance = parseBalance(parsed.data.balance);
  if (!balance.ok) return balance;
  const day = parseDay(parsed.data.readOn);
  if (!day.ok) return day;
  try {
    const accountId = await addManualAccount(await createClient(), user.id, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      institutionName: parsed.data.institutionName || null,
      balanceCents: balance.cents,
      readOn: day.day,
    });
    refresh(accountId);
    return { ok: true, accountId };
  } catch (error) {
    console.error('Adding an account failed', error);
    return { ok: false, error: 'The account could not be added. Try again.' };
  }
}
