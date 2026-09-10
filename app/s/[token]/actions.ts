'use server';

import { z } from 'zod';
import { createSharePublicClient } from '@/lib/share/auth/public';
import { respondResultSchema, type RespondResult } from '@/lib/share/read/load-disposition';

/**
 * Recording an answer.
 *
 * A server action rather than a route handler, and deliberately: the browser
 * then never needs `fetch` at all, so "the shared link makes no outbound HTTP
 * call" is true on both sides of the wire rather than true on one and
 * excused on the other. The server side of this talks to Postgres and nothing
 * else.
 *
 * It is callable by anyone who loads the page, which is fine and is the whole
 * design: `share_respond()` in supabase/migrations/0042_share_rpcs.sql is the
 * authorization decision, it takes the token as its first argument, and it
 * counts the quantity itself rather than believing anything sent from here.
 * Nothing in this file is trusted by the database.
 */

const inputSchema = z.object({
  token: z.string().min(24).max(128),
  groupKey: z.string().min(1).max(200),
  keep: z.number().int().min(0).max(9999),
  sell: z.number().int().min(0).max(9999),
  giveaway: z.number().int().min(0).max(9999),
  note: z.string().max(500).nullable().optional(),
});

export type RespondInput = z.infer<typeof inputSchema>;

/** `null` means the link itself is no longer good -- revoked, expired, or wrong. */
// latency: pending
export async function respondToShare(raw: RespondInput): Promise<RespondResult | null> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'negative' };

  const supabase = createSharePublicClient();
  const { data, error } = await supabase.rpc('share_respond', {
    p_token: parsed.data.token,
    p_group_key: parsed.data.groupKey,
    p_keep: parsed.data.keep,
    p_sell: parsed.data.sell,
    p_giveaway: parsed.data.giveaway,
    p_note: parsed.data.note ?? null,
  });

  if (error || data == null) return null;

  const result = respondResultSchema.safeParse(data);
  return result.success ? result.data : null;
}
