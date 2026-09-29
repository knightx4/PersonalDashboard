'use client';

import { Bot } from 'lucide-react';
import { AskThread, useAskDash } from '@/components/shell/ask-dash';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { commentWhen, exactTime } from '@/lib/comments/when';
import type { DashChange } from '@/lib/talk/changes';
import type { TalkTurn } from '@/lib/talk/talk';
import { useClockNow } from '@/lib/use-clock-now';

/** Opens the Dash sheet on a new question, from this page's header. */
export function AskButton() {
  const handle = useAskDash();
  if (!handle) return null;
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => handle.open()}>
      <Bot className="size-3.5" strokeWidth={1.75} aria-hidden />
      Ask Dash
    </Button>
  );
}

/** When a question was last added to, in the thread's own words for time. */
export function AskedWhen({ at }: { at: string }) {
  const now = useClockNow();
  return (
    <time dateTime={at} title={exactTime(at)}>
      {commentWhen(at, now)}
    </time>
  );
}

/** A reopened question: its turns, the changes Dash proposed in it, and the box to carry it on. */
export function AskConversation({
  conversationRef,
  turns,
  changes,
}: {
  conversationRef: string;
  turns: TalkTurn[];
  changes: DashChange[];
}) {
  return (
    <AskThread
      id={`ask-${conversationRef}`}
      conversationRef={conversationRef}
      turns={turns}
      changes={changes}
      label="Ask a follow-up"
      placeholder="Ask more about this"
      hint={<PaidHint action="app/ask/actions.ts#askDashQuestion" what="Cost of each answer from Dash" />}
    />
  );
}
