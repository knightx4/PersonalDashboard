'use client';

import { AskThread, useAskDash } from '@/components/shell/ask-dash';
import { DashStarters, DashWelcome } from '@/components/talk/dash-welcome';
import type { ChangePresses } from '@/components/talk/dash-changes';
import type { DashChange, MadeChange } from '@/lib/talk/changes';
import type { TalkTurn } from '@/lib/talk/talk';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Conversation, ConversationChat } from '@/components/patterns/conversation';
import type { AskChat } from '@/lib/talk/ask-chats';
import type { Crumb } from '@/components/shell/breadcrumb';
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
import { Skeleton } from '@/components/ui/skeleton';

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
 * Chat's Dash tab (plans #1899.2, #2748.1): the chats on the left and
 * whichever is open beside them, in the conversation pattern. On a phone the
 * list is the page at /chat/dash, and a chat at /chat/dash/<ref> is drawn in
 * its place.
 *
 * The list is handed in rather than read here, so the layout can stream it:
 * the pane, New chat and the open chat are drawn at once, and the rows land
 * in the pane when they have been read (ChatsListSkeleton until then).
 */
export function DashChatsFrame({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/chat/dash';
  const newChat = useSearchParams()?.get('chat') === 'new';
  return (
    <Conversation
      label="Chats"
      fill
      open={openChatRef(pathname) !== null || newChat}
      newChat={{ href: NEW_CHAT_HREF, label: 'New chat' }}
      list={list}
    >
      {children}
    </Conversation>
  );
}

/** The chats once read, or the line saying they could not be. */
export function DashChatsList({
  chats,
  chatsFailed = false,
  today,
  made,
  madeFailed = false,
}: {
  chats: AskChat[];
  chatsFailed?: boolean;
  today: string;
  made: MadeChange[];
  madeFailed?: boolean;
}) {
  return (
    <AskChats
      chats={chats}
      failed={chatsFailed}
      today={today}
      made={made}
      madeFailed={madeFailed}
      presses={PRESSES}
      edits={EDITS}
    />
  );
}

/** The list while the chats are read: the search, then rows under the groups they usually fall in. */
export function ChatsListSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Reading your chats"
      className="space-y-3 rounded-card bg-surface p-2 min-[720px]:rounded-none min-[720px]:bg-transparent min-[720px]:p-0"
    >
      <Skeleton className="h-(--control-h) w-full rounded-control" />
      {(['Pinned', 'Today', 'This week'] as const).map((group, g) => (
        <section key={group}>
          <h3 className="px-2 text-small font-medium text-ink-muted">{group}</h3>
          <ul className="mt-1 space-y-0.5">
            {Array.from({ length: g === 0 ? 1 : 2 }, (_, i) => (
              <li key={i} className="flex min-h-11 items-center gap-2 py-2 pl-2 pr-9">
                <Skeleton className={i === 0 ? 'h-3.5 w-3/5' : 'h-3.5 w-1/2'} />
                <Skeleton className="ml-auto h-3 w-10" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
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
  crumbs,
}: {
  title: string;
  /** The chat's path, from the catalogue (plan #1931.2). */
  crumbs?: readonly Crumb[];
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
      crumbs={crumbs}
      fill
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
      dock
      bubbles
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

/** Dash's page of how the person writes, read from their sent mail. */
export const WRITING_STYLE_HREF = '/chat/dash/writing-style';

/** On a phone, the way from an open chat back to the list it is drawn over. */
export const CHATS_BACK = { href: '/chat/dash', label: 'Chats' };

/**
 * Where New chat goes: /chat/dash itself, marked so a phone, whose /chat/dash is the
 * list, draws the new chat over it (note bd8b9a15).
 */
export const NEW_CHAT_HREF = '/chat/dash?chat=new';

/**
 * A new chat on the page (plan #1899.2): Dash's mark, what he can do, the box
 * open in the middle of the pane and questions to start from under it. Once
 * the first answer lands the chat has an address, and the page moves to it
 * so the list shows it and a reload keeps it.
 */
export function NewDashChat() {
  const router = useRouter();
  const workspaces = useAskDash()?.workspaces;
  const [asked, setAsked] = useState(false);
  // A starter pressed: the thread is drawn again with it as its question.
  const [starter, setStarter] = useState<string | null>(null);
  return (
    <ConversationChat title="New chat" back={CHATS_BACK} fill>
      <div
        className={
          asked
            ? 'flex flex-1 flex-col'
            : 'flex flex-col justify-center gap-6 py-6 min-[720px]:min-h-[calc(100dvh-14rem)]'
        }
      >
        {!asked && <DashWelcome />}
        {/* Grows to the pane's foot once a question is out, so the box docks there. */}
        <div className={asked ? 'flex flex-1 flex-col' : undefined}>
        <AskThread
          key={starter ?? 'new'}
          id="ask-new"
          conversationRef={null}
          turns={[]}
          ask={starter ?? undefined}
          onConversation={(ref) => {
            router.replace(`/chat/dash/${ref}`);
            router.refresh();
          }}
          onSend={() => setAsked(true)}
          label="Ask a question"
          placeholder="Ask about your money, jobs, todos or notes"
          dock
          bubbles
        />
        </div>
        {!asked && (
          <DashStarters
            workspaces={workspaces}
            onAsk={(question) => {
              setAsked(true);
              setStarter(question);
            }}
          />
        )}
      </div>
    </ConversationChat>
  );
}
