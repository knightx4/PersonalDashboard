import { NextResponse } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { summarizeReads } from '@/lib/review/read-order';
import {
  loadReadOrderContext,
  readWaitingConfirmations,
} from '@/lib/review/read-order-server';

export const dynamic = 'force-dynamic';
// Each email is a Gmail fetch and usually a model call, two at a time.
export const maxDuration = 300;

/**
 * Reads every order confirmation waiting in review and says how many came
 * back with items, and why the rest did not. Writes nothing.
 *
 * Open it signed in on the deployed site: this is how plan #830's count gets
 * taken, since only the deployment has the Gmail and Anthropic credentials.
 * Nothing links here; a GET is enough because it changes nothing.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = await createClient();
  const core = await createCoreClient();
  const context = await loadReadOrderContext(supabase, user.id);
  const outcomes = await readWaitingConfirmations(supabase, core, context);

  return NextResponse.json(
    {
      summary: summarizeReads(outcomes),
      emails: outcomes.map((outcome) =>
        outcome.ok
          ? {
              subject: outcome.subject,
              merchant: outcome.draft.merchantName,
              orderDate: outcome.draft.orderDate,
              orderNumber: outcome.draft.externalOrderNumber,
              items: outcome.draft.lines.length,
              reconciled: outcome.draft.reconciled,
              source: outcome.draft.source,
              issues: outcome.draft.issues,
            }
          : { subject: outcome.subject, error: outcome.error },
      ),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
