import { paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { shellFor } from '@/lib/shell/shell-for';
import { todayInTimezone } from '@/lib/money';
import { listAskChatsInRequest, loadAskMadeChanges } from '@/lib/talk/ask-request';
import type { AskChat } from '@/lib/talk/ask-chats';
import type { MadeChange } from '@/lib/talk/changes';
import { DashChatsFrame } from './view';

/**
 * Dash's page (plans #1090, #1899.2), in the account's chrome rather than a
 * workspace's: Dash reads every workspace, so wearing one of their
 * navigations would say otherwise.
 *
 * The list of chats is drawn here, so moving from one chat to the next keeps
 * it where it was and only the open chat changes. It is a wide page: the list
 * and the chat take the shell's whole box (the conversation pattern).
 */
export default async function AskLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: null,
    narrow: false,
    // The box on a chat is a paid press.
    paidActions: paidActionsUnder('app/ask/'),
    children: async ({ settings }) => {
      const [chats, made] = await Promise.all([
        listAskChatsInRequest(settings.timezone).then(
          (found): { chats: AskChat[]; failed?: true } => ({ chats: found }),
          (error: unknown) => {
            console.error('ask chats were not read', error);
            return { chats: [], failed: true as const };
          },
        ),
        loadAskMadeChanges().then(
          (changes): { changes: MadeChange[]; failed?: true } => ({ changes }),
          (error: unknown) => {
            console.error('ask made changes were not read', error);
            return { changes: [], failed: true as const };
          },
        ),
      ]);
      return (
        <DashChatsFrame
          chats={chats.chats}
          chatsFailed={chats.failed}
          today={todayInTimezone(settings.timezone)}
          made={made.changes}
          madeFailed={made.failed}
        >
          {children}
        </DashChatsFrame>
      );
    },
  });
}
