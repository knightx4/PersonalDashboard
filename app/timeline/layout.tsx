import { paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { shellFor } from '@/lib/shell/shell-for';

/**
 * What you did across the app, month by month (plan #1118). In the account's
 * chrome rather than a workspace's, the same as /ask and /account: the page
 * reads every workspace, so wearing one of their navigations would say
 * otherwise.
 */
export default async function TimelineLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: null,
    // Writing a year's review is a paid press (plan #1121).
    paidActions: paidActionsUnder('app/timeline/'),
    children,
  });
}
