'use client';

import { DashMark } from '@/components/ui/dash-mark';
import { AskThread } from '@/components/shell/ask-dash';
import { PaidHint } from '@/components/ui/paid-hint';
import type { ChangePresses } from '@/components/talk/dash-changes';
import type { DashChange, MadeChange } from '@/lib/talk/changes';
import type { TalkTurn } from '@/lib/talk/talk';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from '@/components/ui/link';
import { Conversation } from '@/components/patterns/conversation';
import type { AskChat } from '@/lib/talk/ask-chats';
import { AskChats, openChatRef } from './chats';
import { confirmDashChange, declineDashChange, undoDashChange } from './actions';

const PRESSES: ChangePresses = {
  confirm: confirmDashChange,
  decline: declineDashChange,
  undo: undoDashChange,
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
          <AskChats chats={chats} today={today} made={made} madeFailed={madeFailed} presses={PRESSES} />
        </>
      }
    >
      {children}
    </Conversation>
  );
}

/** A reopened question: its turns, the changes Dash proposed in it, and the box to carry it on. */
export function AskConversation({
  conversationRef,
  turns,
  changes,
  openHandoffs,
}: {
  conversationRef: string;
  turns: TalkTurn[];
  changes: DashChange[];
  openHandoffs?: number;
}) {
  return (
    <AskThread
      id={`ask-${conversationRef}`}
      conversationRef={conversationRef}
      turns={turns}
      changes={changes}
      openHandoffs={openHandoffs}
      label="Ask a follow-up"
      placeholder="Ask more about this"
      startWriting
      hint={<PaidHint action="app/api/ask/route.ts#POST" what="Cost of each answer from Dash" />}
    />
  );
}

/**
 * The open chat's heading: its title, and on a phone the way back to the
 * list it was opened over.
 */
export function ChatHeader({ title }: { title: string }) {
  return (
    <div className="mb-4">
      <Link
        href="/ask"
        className="press-area mb-1 inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink min-[720px]:hidden"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        Chats
      </Link>
      <h1 className="font-display line-clamp-2 break-words text-title font-semibold tracking-tight text-ink">
        {title}
      </h1>
    </div>
  );
}

/**
 * A new chat on the page (plan #1899.2): Dash's opening line and the box,
 * open. Once the first answer lands the chat has an address, and the page
 * moves to it so the list shows it and a reload keeps it.
 */
export function NewDashChat() {
  const router = useRouter();
  return (
    <>
      <ChatHeader title="New chat" />
      <div className="mb-4 flex gap-2">
        <div className="flex w-4 shrink-0 justify-center pt-1">
          <DashMark size="2xs" decorative className="text-ink-ghost" />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <span className="text-small font-semibold text-ink">Dash</span>
          <p className="text-body text-ink">
            Ask me about anything in here: what you spent, who has not replied, what you wrote about
            something. I look it up in your own things and link what I used. I can also add a todo, add a
            step to a goal or mark a return sent back, and nothing is written until you confirm it.
          </p>
        </div>
      </div>
      <AskThread
        id="ask-new"
        conversationRef={null}
        turns={[]}
        onConversation={(ref) => {
          router.replace(`/ask/${ref}`);
          router.refresh();
        }}
        label="Ask a question"
        placeholder="What did I spend on eBay this month?"
        startWriting
        hint={<PaidHint action="app/api/ask/route.ts#POST" what="Cost of each answer from Dash" />}
      />
    </>
  );
}
