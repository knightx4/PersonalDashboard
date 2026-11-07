/**
 * Where Jobs' whole activity feed is. It was a tab of Now from plan #1496.7.2
 * until the person asked for its own tab back (note eb898bfd), so it has its
 * page at /jobs/activity again, and `/jobs?tab=activity`, the address it had
 * in between, redirects there. Since you last looked, the status line's brief
 * and the updates list all link to it.
 */
export const ACTIVITY_HREF = '/jobs/activity';
