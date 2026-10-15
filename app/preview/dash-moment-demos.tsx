'use client';

import { useEffect, useRef, useState } from 'react';
import { Thread } from '@/components/thread/thread';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
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
        awaitingReply={phase === 'working'}
        turns={[phase === 'seen' ? { ...comment, acknowledgedAt: seenAt } : comment]}
      />
    </div>
  );
}

/** How long the press waits on the server before its run is handed over. */
const HAND_OVER_MS = 250;

/**
 * "Dash at work" on the button that started a run (plan #1964.2.1), played on
 * demand for `npm run record`. The press shows the working mark for the
 * moment the server takes, then the run is going: the mark stands where the
 * label was, pulsing, and the button keeps its width. The run is a fixture,
 * so nothing follows it over the network and nothing is written.
 */
export function DashRunButtonDemo({ label, line }: { label: string; line: string }) {
  const [phase, setPhase] = useState<'ready' | 'pending' | 'going'>('ready');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 flex-[1_1_14rem] text-small text-ink-muted" role="status">
        {phase === 'going' ? line : 'No goals yet. Dash can propose the goals this area needs.'}
      </p>
      <DashAction
        type="button"
        size="sm"
        variant="secondary"
        data-motion-demo="dash-run"
        pending={phase === 'pending'}
        run={phase === 'going' ? { table: 'goals.runs', id: 'preview-run', going: true } : null}
        onClick={() => {
          clearTimeout(timer.current);
          setPhase('pending');
          timer.current = setTimeout(() => setPhase('going'), HAND_OVER_MS);
        }}
      >
        {label}
      </DashAction>
    </div>
  );
}
