'use client';

import { useState } from 'react';
import { OwlIcon } from '@/components/shell/owl-icon';
import { PaidHint } from '@/components/ui/paid-hint';
import { TalkThread, type TalkAssistant } from '@/components/talk/talk-thread';
import type { TalkTurn } from '@/lib/talk/talk';
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
 */
export function MayaConversation({
  threadId,
  summary: initialSummary,
  turns,
  children,
}: {
  threadId: string;
  summary: string | null;
  turns: readonly TalkTurn[];
  children: React.ReactNode;
}) {
  const [summary, setSummary] = useState(initialSummary);

  return (
    <>
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
          hint={<PaidHint action="app/vault/maya/actions.ts#replyToMaya" what="Cost of a reply from Maya" />}
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
