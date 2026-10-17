'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link, { linkVariants } from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { LiveDot } from '@/components/ui/live-dot';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { cn } from '@/lib/cn';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import type { PreparationLine, PreparationLineState, PreparationView } from '@/lib/learn/prepare/view';
import { continuePreparation, type PreparationPressState } from './actions';

/**
 * A subject's preparation, on its page (plan #2276.2).
 *
 * While the run works, this block leads the page: the eight steps in order,
 * the one being worked marked with what it is doing, the ones done with what
 * they found, the ones to come in a lighter ink. It re-reads the page every
 * few seconds, as a researching brief does (app/learn/b/[id]/brief-view.tsx),
 * so the lines change as the runner moves without a reload. A failed step
 * says why and carries a Continue press that calls the runner again. A
 * finished run folds to one line.
 *
 * A subject made before preparation existed has no run, and gets a Prepare
 * press instead.
 */

/** How often a working run asks the server for what the runner has written. */
const POLL_MS = 4000;
/** Ask that often for this long, then more slowly. */
const POLL_FAST_FOR_MS = 20 * 60_000;
/**
 * The slower pace past that. A preparation can take an hour, and a page that
 * stopped asking kept the block on screen after the run finished (note
 * 49a6e14d), so it keeps asking until the run is done.
 */
const POLL_SLOW_MS = 30_000;

function useLiveWhileWorking(working: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!working) return;
    const started = Date.now();
    let last = started;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - started > POLL_FAST_FOR_MS && now - last < POLL_SLOW_MS) return;
      last = now;
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [working, router]);
}

const MARK: Record<Exclude<PreparationLineState, 'current'>, { glyph: GlyphName; tone: string; word: string }> = {
  // Ink, not green: green is kept for money coming back (law 4); the tick says done.
  done: { glyph: 'check', tone: 'text-ink-muted', word: 'Done' },
  pending: { glyph: 'empty', tone: 'text-ink-ghost', word: 'To come' },
  skipped: { glyph: 'slash', tone: 'text-ink-muted', word: 'Skipped' },
  failed: { glyph: 'bar', tone: 'text-danger', word: 'Stopped' },
};

function StepMark({ state }: { state: PreparationLineState }) {
  if (state === 'current') {
    return (
      <span className="flex size-3.5 items-center justify-center" role="img" aria-label="Working">
        <LiveDot />
      </span>
    );
  }
  const mark = MARK[state];
  return <StatusGlyph glyph={mark.glyph} label={mark.word} className={mark.tone} />;
}

function ContinueForm({ subjectId, branch = null, label, onStarted, costText }: {
  subjectId: string;
  /** A branch run's key (plan #2276.7), so Continue works that run. */
  branch?: string | null;
  label: string;
  onStarted: () => void;
  costText?: string;
}) {
  const router = useRouter();
  const [state, press, pending] = useActionState<PreparationPressState, FormData>(continuePreparation, {});
  useEffect(() => {
    if (state.started) {
      onStarted();
      router.refresh();
    }
  }, [state, onStarted, router]);
  return (
    <form action={press} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <input type="hidden" name="subjectId" value={subjectId} />
      {branch && <input type="hidden" name="branch" value={branch} />}
      <DashAction type="submit" variant="secondary" size="sm" pending={pending} costText={costText} what="Cost of preparing the subject">
        {pending ? 'Starting…' : label}
      </DashAction>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
      {state.started && !state.error && <p className="text-small text-ink-muted">Started. The steps fill in here.</p>}
    </form>
  );
}

function StepRow({ line, index, action }: { line: PreparationLine; index: number; action?: React.ReactNode }) {
  const quiet = line.state === 'pending';
  return (
    <li className="flex gap-3 py-2" aria-current={line.state === 'current' ? 'step' : undefined}>
      <span className="mt-[3px] shrink-0">
        <StepMark state={line.state} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-ui', quiet ? 'text-ink-muted' : 'text-ink', line.state === 'current' && 'font-semibold')}>
          <span className="sr-only">Step {index + 1}: </span>
          {line.label}
        </p>
        {line.detail && (
          <p className={cn('mt-0.5 text-small', line.state === 'failed' ? 'text-danger' : 'text-ink-muted')}>
            {line.detail}
          </p>
        )}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </li>
  );
}

export function PreparationBlock({
  subjectId,
  view,
  live = true,
  sourcesHref = null,
  branch = null,
}: {
  subjectId: string;
  view: PreparationView;
  /**
   * A run for one branch of the territory (plan #2276.7): its key, for
   * Continue, and its name, for the heading. Absent on the subject's own run.
   */
  branch?: { key: string; name: string } | null;
  /** False in the gallery, which has no server to re-read. */
  live?: boolean;
  /** Where the finished line's Sources link goes, once the page has that section (#2276.6). */
  sourcesHref?: string | null;
}) {
  // A press that started the runner keeps the page re-reading until the run shows as working.
  const [kicked, setKicked] = useState(false);
  const working = view.kind === 'working' || (kicked && view.kind !== 'finished');
  useLiveWhileWorking(live && working);
  const markKicked = useCallback(() => setKicked(true), []);

  if (view.kind === 'finished') {
    // Folded: the one line on the block's own panel, the tick beside its
    // first word and Sources at its end, wrapping as one line of text.
    return (
      <Card padding="dense" className="mb-6 flex items-start gap-2">
        <span className="mt-[3px] shrink-0">
          <StatusGlyph glyph="check" label="Prepared" className="text-ink-muted" />
        </span>
        <p className="min-w-0 text-ui text-ink-muted">
          {view.summary}
          {sourcesHref && (
            <>
              {' · '}
              <Link href={sourcesHref} className={linkVariants()}>
                Sources
              </Link>
            </>
          )}
        </p>
      </Card>
    );
  }

  if (view.kind === 'none') {
    return (
      <Card padding="standard" className="mb-6">
        <h2 className="text-body font-semibold text-ink">Not prepared yet</h2>
        <p className="mt-1 text-ui text-ink-muted">
          This subject was made before Dash prepared new ones. Preparing it finds syllabi and other
          structure documents for it, lays out its territory and drafts its topics, step by step on
          this page.
        </p>
        <div className="mt-3">
          <ContinueForm subjectId={subjectId} label="Prepare this subject" onStarted={markKicked} costText="About $2 to $4" />
        </div>
      </Card>
    );
  }

  const failed = view.kind === 'failed';
  return (
    <Card padding="standard" className="mb-6" aria-live="polite">
      <h2 className="text-body font-semibold text-ink">
        {branch
          ? failed
            ? `Going deeper on ${branch.name} stopped`
            : `Going deeper on ${branch.name}`
          : failed
            ? 'Preparation stopped'
            : 'Preparing this subject'}
        <span className="font-normal text-ink-muted">
          {' · '}step {view.position} of {view.total}
        </span>
      </h2>
      {!failed && (
        <p className="mt-0.5 text-small text-ink-muted">You can leave the page; it carries on.</p>
      )}
      <ol className="mt-2 divide-y divide-border">
        {view.lines.map((line, i) => (
          <StepRow
            key={line.key}
            line={line}
            index={i}
            action={
              failed && line.state === 'failed' ? (
                <ContinueForm subjectId={subjectId} branch={branch?.key ?? null} label="Continue" onStarted={markKicked} />
              ) : undefined
            }
          />
        ))}
      </ol>
    </Card>
  );
}
