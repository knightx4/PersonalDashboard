'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requestOrigin } from '@/lib/auth/origin';
import { createClient, requireUser } from '@/lib/auth/server';
import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { plaidErrorMessage, plaidPort } from '@/lib/finances/plaid/client';
import { isPlaidConfigured, plaidEnv } from '@/lib/finances/plaid/env';
import { finishFix, finishLink, startFix, startLink, type LinkDeps } from '@/lib/finances/plaid/link';
import { linkStore } from '@/lib/finances/plaid/store';
import { todayInTimezone } from '@/lib/money';

/**
 * Finances settings' link actions (plan #2593.3). Each returns what the page
 * shows rather than throwing, so Plaid's own message reaches the person.
 */

export type LinkActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const SETTINGS_PATH = '/finances/settings';

async function deps(): Promise<LinkDeps> {
  const env = plaidEnv();
  return {
    plaid: plaidPort(),
    store: linkStore(),
    encrypt: (plain) => encryptToken(plain, env.TOKEN_ENCRYPTION_KEY),
    decrypt: (cipher) => decryptToken(cipher, env.TOKEN_ENCRYPTION_KEY),
    today: () => todayInTimezone('UTC'),
  };
}

async function guarded<T>(run: () => Promise<LinkActionResult<T>>): Promise<LinkActionResult<T>> {
  if (!isPlaidConfigured()) return { ok: false, error: 'Plaid is not set up on this deployment yet.' };
  try {
    return await run();
  } catch (error) {
    return { ok: false, error: plaidErrorMessage(error) };
  }
}

/** Where Chase's OAuth sign-in comes back to; registered in Plaid's dashboard. */
async function redirectUri(): Promise<string | undefined> {
  const origin = await requestOrigin();
  // Plaid takes only an https redirect, so a local run goes without one.
  return origin.startsWith('https://') ? `${origin}${SETTINGS_PATH}` : undefined;
}

const kindSchema = z.enum(['bank', 'brokerage', 'loan']);

/** A link token for a new Item of the kind chosen. */
// latency: pending
export async function createLinkToken(kind: string): Promise<LinkActionResult<{ linkToken: string }>> {
  const user = await requireUser();
  const parsed = kindSchema.safeParse(kind);
  if (!parsed.success) return { ok: false, error: 'Pick what to link.' };
  return guarded(async () => {
    const origin = await requestOrigin();
    const result = await startLink(await deps(), {
      userId: user.id,
      kind: parsed.data,
      webhook: origin.startsWith('https://') ? `${origin}/api/finances/plaid/webhook` : undefined,
      redirectUri: await redirectUri(),
    });
    return result.ok ? { ok: true, linkToken: result.linkToken } : { ok: false, error: result.reason };
  });
}

/** A link token that reopens one link's Item in update mode. */
// latency: pending
export async function createFixToken(linkId: string): Promise<LinkActionResult<{ linkToken: string }>> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(linkId);
  if (!id.success) return { ok: false, error: 'That link is no longer here.' };
  return guarded(async () => {
    const result = await startFix(await deps(), { userId: user.id, linkId: id.data, redirectUri: await redirectUri() });
    return result.ok ? { ok: true, linkToken: result.linkToken } : { ok: false, error: result.reason };
  });
}

const finishSchema = z.object({
  publicToken: z.string().min(1).max(500),
  institutionId: z.string().max(100).nullish(),
  institutionName: z.string().max(200).nullish(),
});

/** Stores the Item Link created, with its accounts. */
// latency: pending
export async function completeLink(
  input: z.input<typeof finishSchema>,
): Promise<LinkActionResult<{ institutionName: string; accounts: number }>> {
  const user = await requireUser();
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Plaid sent nothing to save.' };
  return guarded(async () => {
    const supabase = await createClient();
    const { data: profile } = await supabase.from('profiles').select('timezone').eq('id', user.id).single();
    const base = await deps();
    const result = await finishLink(
      { ...base, today: () => todayInTimezone(profile?.timezone ?? 'UTC') },
      { userId: user.id, ...parsed.data },
    );
    revalidatePath(SETTINGS_PATH);
    return result.ok
      ? { ok: true, institutionName: result.institutionName, accounts: result.accounts }
      : { ok: false, error: result.reason };
  });
}

/** After update mode: clears needs attention once Plaid reports the Item well. */
// latency: pending
export async function completeFix(linkId: string): Promise<LinkActionResult> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(linkId);
  if (!id.success) return { ok: false, error: 'That link is no longer here.' };
  return guarded(async () => {
    const result = await finishFix(await deps(), { userId: user.id, linkId: id.data });
    revalidatePath(SETTINGS_PATH);
    return result.ok ? { ok: true } : { ok: false, error: result.reason };
  });
}
