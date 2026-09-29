import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { JEV_CONFIDENCE_FLOOR } from '@/lib/jev/decide';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { isMailPile, LINKER_PILES, type MailPile } from './question';
import type { AgreementRow } from './report';
import { handedOver, type Handover } from './handover';

/**
 * Routing a linker's mail by Jev's pile (plan #1180, under #1174).
 *
 * The mailroom runs first in the fan-out, so by the time a linker sees a page
 * most of its envelopes already have a pile in core.mail_piles. A linker that
 * has been handed over (handover.ts) asks this for the sure piles on its page
 * and decides each email with `routeClaim`: Jev's pile at 0.8 or more stands,
 * and its own rules decide only the rest.
 *
 * Whether a linker is handed over is read from core.mail_pile_agreement, at
 * most once every ten minutes per user, since the answer moves by a few
 * emails a day and the count scans every pile the person has.
 */

const GATE_TTL_MS = 10 * 60_000;

const gateCache = new Map<string, { at: number; rows: AgreementRow[] }>();

/** For tests. */
export function clearHandoverCache(): void {
  gateCache.clear();
}

async function agreementRows(
  core: Pick<CoreSupabaseClient, 'rpc'>,
  userId: string,
  now: number,
): Promise<AgreementRow[]> {
  const cached = gateCache.get(userId);
  if (cached && now - cached.at < GATE_TTL_MS) return cached.rows;
  const { data, error } = await core.rpc('mail_pile_agreement', {
    p_user_id: userId,
    p_floor: JEV_CONFIDENCE_FLOOR,
  });
  if (error) throw new Error(`mail pile agreement failed: ${error.message}`);
  const rows = (data ?? []) as AgreementRow[];
  gateCache.set(userId, { at: now, rows });
  return rows;
}

/**
 * The sure piles for a page of envelopes, or null when this linker still runs
 * on its rules alone: the account has not agreed to Jev, or the agreement
 * report does not yet show Jev catching what the rules catch.
 *
 * Never throws. A failed read keeps the rules in charge, which is what the
 * linker did before this existed.
 */
export async function jevRouting(
  core: Pick<CoreSupabaseClient, 'from' | 'rpc'>,
  opts: { userId: string; linker: string; ids: readonly string[]; now?: number },
): Promise<{ handover: Handover; piles: Map<string, MailPile> } | null> {
  try {
    if (opts.ids.length === 0) return null;
    if (!LINKER_PILES[opts.linker]) return null;
    if (!(await jevEnabledFor(core, opts.userId))) return null;

    const rows = await agreementRows(core, opts.userId, opts.now ?? Date.now());
    const handover = handedOver(rows.find((row) => row.linker === opts.linker));
    if (!handover.open) return null;

    const { data, error } = await core
      .from('mail_piles')
      .select('id, pile, confidence')
      .in('id', [...opts.ids])
      .gte('confidence', JEV_CONFIDENCE_FLOOR);
    if (error) throw new Error(error.message);

    const piles = new Map<string, MailPile>();
    for (const row of (data ?? []) as { id: string; pile: unknown }[]) {
      if (isMailPile(row.pile)) piles.set(row.id, row.pile);
    }
    return { handover, piles };
  } catch (err) {
    console.warn(`[mailroom] routing for ${opts.linker} fell back to rules:`, err);
    return null;
  }
}

/**
 * One email's claim. A sure pile decides it: the linker's own pile claims it,
 * with the rules' hint when they have one and `fromJev` when they do not, and
 * any other pile turns it down. With no sure pile the rules decide.
 */
export function routeClaim<H>(opts: {
  rules: H | null;
  pile: MailPile | undefined;
  own: MailPile;
  fromJev: H;
}): { claim: H | null; by: 'jev' | 'rules' } {
  if (opts.pile === undefined) return { claim: opts.rules, by: 'rules' };
  if (opts.pile !== opts.own) return { claim: null, by: 'jev' };
  return { claim: opts.rules ?? opts.fromJev, by: 'jev' };
}
