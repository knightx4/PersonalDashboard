import 'server-only';

import { createHash } from 'node:crypto';

/**
 * md5 of a résumé's text (plan #1991.4): what a job row records it was read
 * from (you.work_history.resume_hash), so the Work & school tab can tell when
 * the default résumé has changed since the last read.
 */
export function resumeHash(text: string): string {
  return createHash('md5').update(text).digest('hex');
}
