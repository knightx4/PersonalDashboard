'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { OwlIcon } from '@/components/shell/owl-icon';
import { PaidHint } from '@/components/ui/paid-hint';
import { TalkThread, type TalkAssistant } from '@/components/talk/talk-thread';
import { Button } from '@/components/ui/button';
import type { TalkTurn } from '@/lib/talk/talk';
import { threadMarkdown, type ThreadMarkdownInput } from '@/lib/vault/maya/markdown';
import { replyToMaya } from '../actions';

const MAYA: TalkAssistant = { name: 'Maya', Mark: OwlIcon };

/**
 * Where you have got to, Maya's thought, and the replies after it (plan
 * #1286).
 *
 * The summary is state here because a reply rewrites it: the action hands
 * back the new one with the turns it kept, and the section above the thought
 * changes as Maya's answer appears. `children` is the thought, drawn on the
 * server.
 *
 * "Copy as note" (plan #1287) puts the thread on the clipboard as Markdown
 * for Obsidian, built here so it carries the summary as it now stands. The
 * vault is read-only: nothing is written to it.
 */
export function MayaConversation({
  threadId,
  summary: initialSummary,
  turns,
  copy,
  children,
}: {
  threadId: string;
  summary: string | null;
  turns: readonly TalkTurn[];
  /** Everything the copied note needs apart from the summary, which is state here. */
  copy: Omit<ThreadMarkdownInput, 'summary'>;
  children: React.ReactNode;
}) {
  const [summary, setSummary] = useState(initialSummary);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <CopyAsNote text={() => threadMarkdown({ ...copy, summary })} />
      </div>

      <section aria-labelledby="summary-heading" className="mb-8">
        <h2 id="summary-heading" className="text-body font-semibold text-ink">
          Where you have got to
        </h2>
        <p className="mt-1 whitespace-pre-line text-body text-ink">
          {summary ?? (
            <span className="text-ink-muted">
              Nothing yet. Reply to Maya below, and after each answer this says what you now hold
              and what is still open.
            </span>
          )}
        </p>
      </section>

      {children}

      <section aria-labelledby="replies-heading" className="mt-8">
        <h2 id="replies-heading" className="mb-2 text-body font-semibold text-ink">
          Replies
        </h2>
        <TalkThread
          id={`maya-${threadId}`}
          turns={turns}
          assistant={MAYA}
          label="Reply to Maya"
          placeholder="Agree, push back, or take it somewhere else"
          hint={
            <PaidHint
              action="app/vault/maya/actions.ts#replyToMaya"
              what="Cost of a reply from Maya"
            />
          }
          send={async (body) => {
            const result = await replyToMaya(threadId, body);
            if (result.summary) setSummary(result.summary);
            return { turns: result.turns, error: result.error };
          }}
        />
      </section>
    </>
  );
}

/** Copies the thread's Markdown, saying so for two seconds or saying it could not. */
function CopyAsNote({ text }: { text: () => string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => {
        // Through a promise, so a browser without the clipboard API lands in the failure too.
        Promise.resolve()
          .then(() => navigator.clipboard.writeText(text()))
          .then(
            () => setState('copied'),
            () => setState('failed'),
          );
        window.setTimeout(() => setState('idle'), 2000);
      }}
    >
      {state === 'copied' ? (
        <Check className="size-3.5" strokeWidth={1.75} aria-hidden />
      ) : (
        <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
      )}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : 'Copy as note'}
    </Button>
  );
}
