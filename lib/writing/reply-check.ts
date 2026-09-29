import 'server-only';

import { after } from 'next/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { checkWriting, writingWarning } from '@/lib/writing/check';

/**
 * Score a reply Dash just saved in a comment thread against the writing guide
 * (plan #1175), once the response has gone back, so the person never waits
 * on it. What it finds goes to the server log, naming each pattern; the reply
 * stays as it was written. Jev is asked only for an account with jev_enabled
 * on, and the rules alone run for any other.
 *
 * Called from server actions, where `after` may open the core client on the
 * person's session. Never throws.
 */
export function checkReplyAfterResponse(userId: string, body: string, where: string): void {
  after(async () => {
    try {
      const core = await createCoreClient();
      const enabled = await jevEnabledFor(core, userId);
      const spend: SpendReport[] = [];
      const result = await checkWriting({
        text: { reply: body },
        enabled,
        onSpend: (report) => spend.push(report),
      });
      await recordSpendReports(core, userId, { module: 'core', operation: 'check-writing' }, spend);
      const warning = writingWarning(result);
      if (warning) console.warn(`[writing] Dash's reply on ${where}: ${warning}`);
    } catch (error) {
      console.warn('[writing] reply check did not run', error instanceof Error ? error.message : error);
    }
  });
}
