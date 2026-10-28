import { NextResponse, type NextRequest } from 'next/server';
import { plaidApi } from '@/lib/finances/plaid/client';
import { isPlaidConfigured } from '@/lib/finances/plaid/env';
import { createFinancesServiceClient } from '@/lib/finances/plaid/store';
import {
  linkPatchFor,
  parseWebhook,
  tokenKeyId,
  verifyPlaidWebhook,
  type VerificationKey,
} from '@/lib/finances/plaid/webhook';

// node:crypto for the signature, and nothing here is ever cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Plaid sends webhooks about the person's Items (plan #2593.3). Public
 * in proxy.ts: Plaid carries no session, so the Plaid-Verification JWT is
 * what proves the post came from Plaid.
 *
 *   401  the signature, its age or the body's hash did not check out.
 *   200  recorded, or about an Item nobody here holds, or not a webhook.
 *        A retry would bring back the same thing.
 *   500  the database or Plaid's key endpoint could not be reached; Plaid
 *        retries.
 *
 * The event goes to finances.plaid_events for the sync (#2593.4). A login
 * Plaid says must be repeated also marks the link needing attention here, so
 * Fix sign-in shows on its row before the next sync runs.
 */

/** Plaid's verification keys by kid, kept while the function instance lives. */
const keys = new Map<string, VerificationKey>();

async function verificationKey(kid: string): Promise<VerificationKey | null> {
  const cached = keys.get(kid);
  if (cached) return cached;
  const { data } = await plaidApi().webhookVerificationKeyGet({ key_id: kid });
  keys.set(kid, data.key);
  return data.key;
}

export async function POST(request: NextRequest) {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'not configured' }, { status: 404 });

  const body = await request.text();
  const token = request.headers.get('plaid-verification');
  const kid = tokenKeyId(token);
  if (!kid) return NextResponse.json({ error: 'unverified' }, { status: 401 });

  let key: VerificationKey | null;
  try {
    key = await verificationKey(kid);
  } catch {
    return NextResponse.json({ error: 'key unavailable' }, { status: 500 });
  }
  const verified = verifyPlaidWebhook({ token, body, key });
  if (!verified.ok) return NextResponse.json({ error: 'unverified' }, { status: 401 });

  const hook = parseWebhook(body);
  if (!hook) return NextResponse.json({ ok: true });

  const db = createFinancesServiceClient();
  const { data: link, error: lookupError } = await db
    .from('links')
    .select('id, user_id')
    .eq('plaid_item_id', hook.item_id)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  if (!link) return NextResponse.json({ ok: true });
  const { id: linkId, user_id: userId } = link as { id: string; user_id: string };

  const { error: insertError } = await db.from('plaid_events').insert({
    user_id: userId,
    link_id: linkId,
    webhook_type: hook.webhook_type.slice(0, 64),
    webhook_code: hook.webhook_code.slice(0, 64),
    error_code: hook.error?.error_code ?? null,
    body: JSON.parse(body),
  });
  if (insertError) return NextResponse.json({ error: 'record failed' }, { status: 500 });

  const patch = linkPatchFor(hook);
  if (patch) {
    const { error } = await db.from('links').update(patch).eq('user_id', userId).eq('id', linkId);
    if (error) return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
