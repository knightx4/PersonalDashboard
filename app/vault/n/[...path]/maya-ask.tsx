'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import type { NoteThread } from '@/lib/vault/maya/store';
import { mayaThreadHref } from '@/lib/vault/paths';
import { askMaya, type AskMayaState } from './actions';

/**
 * Asking Maya about this note (plan #1285).
 *
 * Before a thread exists this is a button. Once one does, the button gives
 * way to the thread's question, the ranked claims of Maya's thought, and the
 * way into the thread, where the sources are shown and it can be answered
 * (the Maya tab, plan #1286). The page passes the thread it read; a press
 * that has just opened one revalidates the page, and the link from the
 * action's answer covers the moment before that arrives.
 */

function AskButton({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" pending={pending}>
      {pending ? 'Maya is thinking…' : again ? 'Ask Maya again' : 'Ask Maya'}
    </Button>
  );
}

function ThreadLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mt-3 inline-flex items-center gap-1 text-ui font-medium text-accent hover:underline"
    >
      Open the thread
      <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden />
    </Link>
  );
}

export function MayaAsk({ notePath, thread }: { notePath: string; thread: NoteThread | null }) {
  const [state, ask] = useActionState<AskMayaState, FormData>(askMaya, {});

  return (
    <section aria-labelledby="maya-heading" className="mt-10">
      <h2 id="maya-heading" className="text-body font-semibold text-ink">
        Maya
      </h2>

      {thread ? (
        <div className="mt-2">
          <p className="text-body text-ink">{thread.question}</p>
          {thread.thought && thread.thought.points.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-ui text-ink-muted">
              {thread.thought.points.map((point) => (
                <li key={point.rank}>{point.claim}</li>
              ))}
            </ol>
          )}
          <ThreadLink href={mayaThreadHref(thread.id)} />
        </div>
      ) : state.threadHref ? (
        <div className="mt-2">
          <p className="text-ui text-ink">Maya has written on this note.</p>
          <ThreadLink href={state.threadHref} />
        </div>
      ) : (
        <form action={ask} className="mt-2">
          <input type="hidden" name="notePath" value={notePath} />
          <p className="text-ui text-ink-muted">
            Maya sets this note against your other notes and against what others have written on
            the same question, and gives up to three points, each citing where it comes from.
          </p>
          {state.message && <p className="mt-2 text-ui text-ink">{state.message}</p>}
          {state.error && <p className="mt-2 text-ui text-caution">{state.error}</p>}
          <div className="mt-3 flex items-center gap-3">
            <AskButton again={Boolean(state.message || state.error)} />
            <PaidHint
              action="app/vault/n/[...path]/actions.ts#askMaya"
              what="Cost of asking Maya"
            />
          </div>
        </form>
      )}
    </section>
  );
}
