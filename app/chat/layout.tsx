import { paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor } from '@/lib/shell/tabs';
import { WRITING_STYLE_HREF } from './dash/view';

/**
 * Shell for the Chat workspace (plan #2748): People, the mentors you text,
 * and Dash, your chats with Dash. Ask Dash was its own page at /ask, outside
 * every workspace, with a column of workspaces beside it; it is this
 * workspace's Dash tab now, and /ask redirects there (next.config.ts).
 *
 * A wide page: the Dash tab is the conversation pattern, whose list and chat
 * take the shell's whole box.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'chat',
    sections: ({ owner }) => tabsFor('chat', owner),
    // Dash's page of how you write, read from your sent mail. It sat in the
    // column beside the chats until the column went.
    settingsHref: WRITING_STYLE_HREF,
    settingsLabel: 'Writing style',
    // The box on a chat is a paid press: asking goes through the API route,
    // which is not under app/chat/, so it is named too (plan #2458.3).
    paidActions: [...paidActionsUnder('app/chat/'), 'app/api/ask/route.ts#POST'],
    children,
  });
}
