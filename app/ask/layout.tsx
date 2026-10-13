import { paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { shellFor } from '@/lib/shell/shell-for';

/**
 * The questions you have asked Dash (plan #1090), in the account's chrome
 * rather than a workspace's: Dash reads every workspace, so wearing one of
 * their navigations would say otherwise. Same shell as /account.
 */
export default async function AskLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: null,
    // The follow-up box on a reopened question is a paid press.
    paidActions: paidActionsUnder('app/ask/'),
    children,
  });
}
