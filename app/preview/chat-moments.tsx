'use client';

import { useState } from 'react';
import { PeopleView } from '@/app/chat/people-view';
import { ThreadView } from '@/app/chat/people/[key]/thread-view';
import { Button } from '@/components/ui/button';
import type { PersonRow, ThreadMessage } from '@/lib/you/chat-threads-model';

/**
 * The two Chat moments (plan #2748.10), played on demand for `npm run record`.
 * Nothing is written anywhere. Live, the same thing happens when Realtime
 * says their typing began and a text arrived; here a button stands in for
 * Realtime and the steps are timed on a Web Animation, which a recording
 * slows with the page's animations (a script timer would run four times too
 * fast in a strip).
 */

/** Waits `ms` on the document's own clock, which a recording slows with the animations. */
function wait(ms: number): Promise<void> {
  if (typeof document.documentElement.animate !== 'function') return new Promise((done) => setTimeout(done, ms));
  return document.documentElement.animate([{ opacity: 1 }, { opacity: 1 }], { duration: ms }).finished.then(() => undefined);
}

/**
 * A mentor typing: the dots rise in at the foot of the thread, give way to
 * the first bubble, and rise in again below it while another is coming.
 */
export function ChatTypingDemo({
  rows,
  person,
  base,
  reply,
  typingUntil,
  timezone,
  now,
}: {
  rows: readonly PersonRow[];
  person: PersonRow;
  base: ThreadMessage[];
  reply: ThreadMessage;
  typingUntil: string;
  timezone: string;
  now: number;
}) {
  const [step, setStep] = useState<'rest' | 'typing' | 'first' | 'more'>('rest');
  const play = async () => {
    if (step !== 'rest') {
      setStep('rest');
      return;
    }
    setStep('typing');
    await wait(450);
    setStep('first');
    await wait(120);
    setStep('more');
  };
  const messages = step === 'first' || step === 'more' ? [...base, reply] : base;
  return (
    <>
      <GalleryButton onClick={play} demo="chat-typing" over>
        {step === 'rest' ? 'Play their reply' : 'Start again'}
      </GalleryButton>
      <PeopleView rows={rows} current={person.key} timezone={timezone} now={now} live={false}>
        <ThreadView
          person={person}
          chatId={person.chatId}
          page={{ messages, hasOlder: false }}
          typingUntil={step === 'typing' || step === 'more' ? typingUntil : null}
          timezone={timezone}
          now={now}
          live={false}
        />
      </PeopleView>
    </>
  );
}

/**
 * A text that arrives first: the mentor's row rises to the top of the list,
 * the rows it passes move down, its preview line changes to the new words
 * and its unread dot lands.
 */
export function ChatArrivalDemo({
  before,
  after,
  timezone,
  now,
}: {
  before: readonly PersonRow[];
  after: readonly PersonRow[];
  timezone: string;
  now: number;
}) {
  const [arrived, setArrived] = useState(false);
  return (
    <>
      <GalleryButton onClick={() => setArrived(!arrived)} demo="chat-arrival">
        {arrived ? 'Start again' : 'A text arrives first'}
      </GalleryButton>
      <PeopleView rows={arrived ? after : before} timezone={timezone} now={now} live={false} />
    </>
  );
}

function GalleryButton({
  onClick,
  demo,
  over = false,
  children,
}: {
  onClick: () => void;
  demo: string;
  /** Held over the thread's bar, which on a phone is a fixed pane that would cover a button in the page. */
  over?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Over the bar it sits clear of Edit: on a phone on the way-back row above the name, on a laptop to Edit's left.
    <div
      className={
        over
          ? 'fixed top-[calc(env(safe-area-inset-top)+5rem)] right-8 z-30 min-[720px]:top-[calc(env(safe-area-inset-top)+6.25rem)] min-[720px]:right-28'
          : 'mb-3'
      }
    >
      <Button variant="secondary" size="sm" className="active:bg-sunken" data-motion-demo={demo} onClick={onClick}>
        {children}
      </Button>
    </div>
  );
}
