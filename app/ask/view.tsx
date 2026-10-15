'use client';

import { AskThread } from '@/components/shell/ask-dash';
import type { ChangePresses } from '@/components/talk/dash-changes';
import type { DashChange, MadeChange } from '@/lib/talk/changes';
import type { TalkTurn } from '@/lib/talk/talk';
import { usePathname, useRouter } from 'next/navigation';
import { Conversation, ConversationChat } from '@/components/patterns/conversation';
import type { AskChat } from '@/lib/talk/ask-chats';
import { AskChats, openChatRef, type ChatEdits } from './chats';
import { ChatUsed, type ChatUsedData } from './used';
import {
  archiveDashChat,
  confirmDashChange,
  declineDashChange,
  pinDashChat,
  renameDashChat,
  reopenDashChange,
  searchDashChats,
  undoDashChange,
} from './actions';
import { useState, useTransition } from 'react';

const PRESSES: ChangePresses = {
  confirm: confirmDashChange,
  decline: declineDashChange,
  reopen: reopenDashChange,
  undo: undoDashChange,
};

const EDITS: ChatEdits = {
  pin: pinDashChat,
  rename: renameDashChat,
  archive: archiveDashChat,
  search: searchDashChats,
};

/**
 * The Dash page's frame (plan #1899.2): the chats on the left and whichever
 * is open beside them, in the conversation pattern. On a phone the list is
 * the page at /ask, and a chat at /ask/<ref> is drawn in its place.
 */
export function DashChatsFrame({
  chats,
  chatsFailed = false,
  today,
  made,
  madeFailed = false,
  children,
}: {
  chats: AskChat[];
  chatsFailed?: boolean;
  today: string;
  made: MadeChange[];
  madeFailed?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '/ask';
  return (
    <Conversation
      label="Chats"
      open={openChatRef(pathname) !== null}
      newChat={{ href: '/ask', label: 'New chat' }}
      list={
        <>
          {chatsFailed && (
            <p className="mb-2 text-small text-danger">Your chats could not be read. Reload to try again.</p>
          )}
          <AskChats chats={chats} today={today} made={made} madeFailed={madeFailed} presses={PRESSES} edits={EDITS} />
        </>
      }
    >
      {children}
    </Conversation>
  );
}

/** What the column beside a chat is called, and its button. */
export const USED_LABEL = 'Used in this chat';
export const USED_SHORT = 'Used';

/**
 * A reopened question: its title, its turns, the changes Dash proposed in
 * it, and the box to carry it on, with what Dash used in it in the column
 * beside (plan #1899.4). Each answer that comes back re-reads the page, so
 * the column takes in what the new answer used.
 */
export function AskConversation({
  title,
  conversationRef,
  turns,
  changes,
  openHandoffs,
  used,
  archived = false,
}: {
  title: string;
  conversationRef: string;
  /** Archived out of the list (plan #1899.6): said above the thread, with the way back. */
  archived?: boolean;
  turns: TalkTurn[];
  changes: DashChange[];
  openHandoffs?: number;
  used: ChatUsedData;
}) {
  const router = useRouter();
  return (
    <ConversationChat
      title={title}
      back={CHATS_BACK}
      glance={{
        label: USED_LABEL,
        short: USED_SHORT,
        content: <ChatUsed used={used} presses={PRESSES} />,
      }}
    >
    {archived && <ArchivedNote conversationRef={conversationRef} />}
    <AskThread
      id={`ask-${conversationRef}`}
      conversationRef={conversationRef}
      turns={turns}
      changes={changes}
      openHandoffs={openHandoffs}
      onAnswered={() => router.refresh()}
      label="Ask a follow-up"
      placeholder="Ask more about this"
      startWriting
    />
    </ConversationChat>
  );
}

/** Above an archived chat: it is out of the list, and one press puts it back. */
export function ArchivedNote({
  conversationRef,
  restore = archiveDashChat,
}: {
  conversationRef: string;
  restore?: ChatEdits['archive'];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <p className="mb-4 text-small text-ink-muted">
      This chat is archived, so it is out of your list.{' '}
      <button
        type="button"
        className="press font-medium text-accent hover:underline disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const outcome = await restore(conversationRef, false);
            if (outcome.ok) router.refresh();
          })
        }
      >
        Put it back in the list
      </button>
    </p>
  );
}

/** On a phone, the way from an open chat back to the list it is drawn over. */
export const CHATS_BACK = { href: '/ask', label: 'Chats' };

const NEW_CHAT_OPENING =
  'Ask me about anything in here: what you spent, who has not replied, what you wrote about something. I look it up in your own things and link what I used. I can also add a todo, add a step to a goal or mark a return sent back, and nothing is written until you confirm it.';

/**
 * A new chat on the page (plan #1899.2): Dash's opening line and the box,
 * open. Once the first answer lands the chat has an address, and the page
 * moves to it so the list shows it and a reload keeps it.
 */
export function NewDashChat() {
  const router = useRouter();
  const [asked, setAsked] = useState(false);
  return (
    <ConversationChat title="New chat" back={CHATS_BACK}>
      <AskThread
        id="ask-new"
        conversationRef={null}
        turns={[]}
        onConversation={(ref) => {
          router.replace(`/ask/${ref}`);
          router.refresh();
        }}
        onSend={() => setAsked(true)}
        label="Ask a question"
        placeholder="What did I spend on eBay this month?"
        startWriting
        // Dash's opening line, drawn as his first turn until the first question goes.
        opening={asked ? undefined : NEW_CHAT_OPENING}
      />
    </ConversationChat>
  );
}
