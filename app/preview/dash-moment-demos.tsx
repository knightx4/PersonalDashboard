'use client';

import { useEffect, useRef, useState } from 'react';
import { Thread } from '@/components/thread/thread';
import { Button } from '@/components/ui/button';
import type { DevComment } from '@/lib/comments/load';

/** How long Dash is shown at work before it only acknowledges. */
const WORK_MS = 450;

/**
 * "Dash at work" ending on the seen mark (plan #1652), played on demand for
 * `npm run record`. The press hands the comment to Dash: the thread shows Dash's mark
 * working where its reply will go, then Dash only acknowledges, the working
 * row goes, its mark rests under the comment and the seen mark arrives.
 * Nothing is written anywhere; a second press puts the thread back.
 */
export function DashSeenDemo({
  subject,
  comment,
  seenAt,
}: {
  subject: string;
  /** The comment, before Dash has read it. */
  comment: DevComment;
  /** When Dash marks it seen. */
  seenAt: string;
}) {
  const [phase, setPhase] = useState<'ready' | 'working' | 'seen'>('ready');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        size="sm"
        data-motion-demo="dash-seen"
        onClick={() => {
          clearTimeout(timer.current);
          if (phase !== 'ready') {
            setPhase('ready');
            return;
          }
          setPhase('working');
          timer.current = setTimeout(() => setPhase('seen'), WORK_MS);
        }}
      >
        {phase === 'ready' ? 'Ask Dash' : 'Put it back'}
      </Button>
      <Thread
        subject={subject}
        onCard
        awaitingReply={phase === 'working'}
        turns={[phase === 'seen' ? { ...comment, acknowledgedAt: seenAt } : comment]}
      />
    </div>
  );
}
