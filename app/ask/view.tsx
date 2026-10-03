'use client';

import { DashMark } from '@/components/ui/dash-mark';
import { AskThread, useAskDash } from '@/components/shell/ask-dash';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import type { ChangePresses } from '@/components/talk/dash-changes';
import { MadeChanges } from '@/components/talk/made-changes';
import { commentWhen, exactTime } from '@/lib/comments/when';
import type { DashChange, MadeChange } from '@/lib/talk/changes';
import type { TalkTurn } from '@/lib/talk/talk';
import { useClockNow } from '@/lib/use-clock-now';
import { confirmDashChange, declineDashChange, undoDashChange } from './actions';

const PRESSES: ChangePresses = {
  confirm: confirmDashChange,
  decline: declineDashChange,
  undo: undoDashChange,
};

/** The changes Dash made, with Undo bound to the server action (plan #1191). */
export function AskMadeChanges({ changes, today }: { changes: MadeChange[]; today: string }) {
  return <MadeChanges changes={changes} presses={PRESSES} today={today} />;
}

/** Opens the Dash sheet on a new question, from this page's header. */
export function AskButton() {
  const handle = useAskDash();
  if (!handle) return null;
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => handle.open()}>
      <DashMark size="2xs" decorative />
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
      hint={<PaidHint action="app/api/ask/route.ts#POST" what="Cost of each answer from Dash" />}
    />
  );
}
