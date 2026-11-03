import { Suspense } from 'react';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { todayInTimezone } from '@/lib/money';
import { listAskChatsInRequest, loadAskMadeChanges } from '@/lib/talk/ask-request';
import type { AskChat } from '@/lib/talk/ask-chats';
import type { MadeChange } from '@/lib/talk/changes';
import { ChatsListSkeleton, DashChatsFrame, DashChatsList } from './view';

/**
 * Chat's Dash tab (plans #1090, #1899.2, #2748.1): Ask Dash, as one list of
 * chats beside whichever is open. The Chat layout above draws the shell.
 *
 * The list is drawn here, so moving from one chat to the next keeps it where
 * it was and only the open chat changes. It streams: the pane and the open
 * chat are drawn at once, with the list's skeleton until the chats are read.
 */
export default function DashChatsLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashChatsFrame
      list={
        <Suspense fallback={<ChatsListSkeleton />}>
          <ReadChats />
        </Suspense>
      }
    >
      {children}
    </DashChatsFrame>
  );
}

/** The chats and the changes Dash made, each failing on its own into the line that says so. */
async function ReadChats() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);
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
    <DashChatsList
      chats={chats.chats}
      chatsFailed={chats.failed}
      today={todayInTimezone(settings.timezone)}
      made={made.changes}
      madeFailed={made.failed}
    />
  );
}
