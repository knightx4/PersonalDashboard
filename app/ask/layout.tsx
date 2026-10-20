import { paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { shellFor } from '@/lib/shell/shell-for';
import { todayInTimezone } from '@/lib/money';
import { listAskChatsInRequest, loadAskMadeChanges } from '@/lib/talk/ask-request';
import type { AskChat } from '@/lib/talk/ask-chats';
import type { MadeChange } from '@/lib/talk/changes';
import { DashChatsFrame } from './view';
import { switchableModules, moduleById, type ModuleId } from '@/lib/modules';
import type { NavSection } from '@/components/shell/app-shell';
import type { NavIconName } from '@/components/shell/nav-icons';

/** Each workspace's front page in the column, by the icon its own column uses for it. */
const WORKSPACE_ICONS: Record<ModuleId, NavIconName> = {
  shopping: 'orders',
  jobs: 'jobsHome',
  todo: 'agenda',
  vault: 'notes',
  learn: 'readNow',
  news: 'newsletters',
  goals: 'goalsHome',
  you: 'personality',
  dev: 'devHome',
};

/**
 * The shell's column on Dash's page: Home and every workspace the account
 * has on, since Dash reads all of them and a chat often ends with going to
 * one. Without it the column stood empty beside the chats.
 */
function workspaceSections(enabled: readonly ModuleId[] | undefined, owner: boolean): NavSection[] {
  return [
    { href: '/home', label: 'Home', icon: 'home', exact: true },
    ...switchableModules(enabled, owner).flatMap((id): NavSection[] => {
      const workspace = moduleById(id);
      return workspace ? [{ href: workspace.home, label: workspace.label, icon: WORKSPACE_ICONS[id] }] : [];
    }),
  ];
}

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
    sections: ({ settings, owner }) => workspaceSections(settings.enabledModules, owner),
    // The box on a chat is a paid press: asking goes through the API route,
    // which is not under app/ask/, so it is named too (plan #2458.3).
    paidActions: [...paidActionsUnder('app/ask/'), 'app/api/ask/route.ts#POST'],
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
