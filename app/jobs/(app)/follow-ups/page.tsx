import { redirect } from 'next/navigation';
import { PIPELINE_PATH } from '@/lib/jobs/pipeline-view';

/**
 * Follow-ups was opened once in a month (plan #1496.3), so it folded into
 * Pipeline (plan #1496.7.1). Each role's follow-up card, with the person to
 * tell and the note to them, stays on that role's page (follow-up-card.tsx in
 * this folder). The address keeps working for bookmarks and old links.
 */
export default function FollowUpsRedirect() {
  redirect(PIPELINE_PATH);
}
