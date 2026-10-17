'use client';

import { AskThread, useAskDash } from '@/components/shell/ask-dash';
import { ModuleMark } from '@/components/ui/module-mark';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ModuleId } from '@/lib/modules';
import type { ChangePresses } from '@/components/talk/dash-changes';
import type { DashChange, MadeChange } from '@/lib/talk/changes';
import type { TalkTurn } from '@/lib/talk/talk';
import { usePathname, useRouter } from 'next/navigation';
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
      fill
      open={openChatRef(pathname) !== null}
      newChat={{ href: NEW_CHAT_HREF, label: 'New chat' }}
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

/** Where New chat goes: a page of its own, so a phone, whose /ask is the list, opens it. */
export const NEW_CHAT_HREF = '/ask/new';

/** Under the heading of a new chat: what Dash reads and what he will not do unasked. */
const NEW_CHAT_LINE =
  'I look things up in your own orders, applications, todos, goals, notes and email, and link every row I used. Nothing is changed until you confirm it.';

/**
 * Questions a new chat offers to start from, one per workspace, shown for the
 * workspaces the account has on. Each is a question Dash can answer from
 * lookups alone, so a press costs one answer and changes nothing.
 */
export const STARTERS: readonly { workspace: ModuleId; question: string }[] = [
  { workspace: 'jobs', question: 'Which applications have not heard back in two weeks?' },
  { workspace: 'shopping', question: 'What did I spend this month, by shop?' },
  { workspace: 'todo', question: 'What is overdue on my todo list?' },
  { workspace: 'goals', question: 'Which goal have I left alone the longest?' },
  { workspace: 'learn', question: 'What is left on my reading list?' },
  { workspace: 'vault', question: 'What have I written about my job search?' },
];

/** The starters for these workspaces, or all of them when the list is not known. */
export function startersFor(workspaces: readonly ModuleId[] | undefined) {
  return workspaces ? STARTERS.filter((starter) => workspaces.includes(starter.workspace)) : STARTERS;
}

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
  const starters = startersFor(workspaces);
  return (
    <ConversationChat title="New chat" back={CHATS_BACK} fill>
      <div
        className={
          asked
            ? 'flex flex-1 flex-col'
            : 'flex flex-col justify-center gap-6 py-6 min-[720px]:min-h-[calc(100dvh-14rem)]'
        }
      >
        {!asked && (
          <div className="flex flex-col items-center text-center">
            <ModuleMark module="dash" size="lg" />
            <h2 className="font-display mt-4 text-balance text-title font-semibold tracking-tight text-ink">
              What should we look up?
            </h2>
            <p className="mt-1.5 max-w-md text-pretty text-body text-ink-muted">{NEW_CHAT_LINE}</p>
          </div>
        )}
        {/* Grows to the pane's foot once a question is out, so the box docks there. */}
        <div className={asked ? 'flex flex-1 flex-col' : undefined}>
        <AskThread
          key={starter ?? 'new'}
          id="ask-new"
          conversationRef={null}
          turns={[]}
          ask={starter ?? undefined}
          onConversation={(ref) => {
            router.replace(`/ask/${ref}`);
            router.refresh();
          }}
          onSend={() => setAsked(true)}
          label="Ask a question"
          placeholder="Ask about your money, jobs, todos or notes"
          dock
        />
        </div>
        {!asked && starters.length > 0 && (
          <ul aria-label="Questions to start from" className="flex flex-wrap justify-center gap-2">
            {starters.map(({ workspace, question }) => (
              <li key={workspace}>
                <button
                  type="button"
                  onClick={() => {
                    setAsked(true);
                    setStarter(question);
                  }}
                  className={cn(buttonVariants({ variant: 'secondary' }), 'h-auto min-h-11 text-left font-normal sm:min-h-9')}
                >
                  <ModuleMark module={workspace} size="xs" />
                  {question}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ConversationChat>
  );
}
