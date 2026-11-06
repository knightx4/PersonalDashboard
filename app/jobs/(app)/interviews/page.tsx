import { redirect } from 'next/navigation';
import { INTERVIEWS_HREF } from '@/lib/jobs/pipeline-view';

/**
 * Interviews was opened once in a month (plan #1496.3), so it folded into
 * Pipeline (plan #1496.7.1): the address lands on the roles in process. Each
 * role's rounds, with their prep and debriefs, are on that role's page, and
 * the week's interviews are on Now. The debriefs still owed reach the Inbox
 * as nudges (lib/jobs/today/debrief.ts).
 */
export default function InterviewsRedirect() {
  redirect(INTERVIEWS_HREF);
}
