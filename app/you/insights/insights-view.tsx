'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Deck, type DeckItem } from '@/components/patterns/deck';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { DashAction } from '@/components/ui/dash-action';
import { DashMark } from '@/components/ui/dash-mark';
import { Disclosure, SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Label, Textarea } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { formatDateInline } from '@/lib/jobs/applications/load';
import { firedLine, firedSinceMark, type FiredTripwire } from '@/lib/you/insight-fired';
import type {
  Insight,
  InsightConfidence,
  InsightDepth,
  InsightReceipt,
  InsightVerdict,
  Verdict,
} from '@/lib/you/insights';
import type { InsightRunState } from '@/lib/you/insights-run';
import { markInsight, startFullReread, startInsightRun, type MarkResult } from './actions';

/**
 * You's Insights tab (plan #2413.5): what Dash noticed about the person, one
 * insight at a time on the deck pattern (components/patterns/deck.tsx).
 *
 * Each card reads claim first, then the layers under it, then the evidence,
 * folded, each piece opening the note or row it came from. Right, Not quite
 * and Wrong sit in the deck's forward row; Right saves at once, the other two
 * open a line of why on the card first. A mark moves the deck on and puts
 * the card under Earlier with the mark, so what the person has said is not
 * true about them stays on record. Later passes a card without marking it.
 *
 * A card whose tripwire fired since the person last marked it (plan #2413.11)
 * comes back to the front of the deck with a dated line under the claim naming
 * what happened and the evidence the nightly check recorded, folded. Marking
 * it again clears the line until the tripwire fires again.
 *
 * Look again starts a run (startInsightRun), one model call that writes in a
 * few minutes; while one is queued or running a banner takes the button's
 * place and the page looks again every minute. Under the deck, Full re-read
 * starts the slow session on the person's Claude plan (startFullReread).
 */

export type InsightsActions = {
  mark: (insightId: string, verdict: Verdict, note?: string | null) => Promise<MarkResult>;
  lookAgain: () => Promise<{ error: string | null }>;
  fullReread: () => Promise<{ error: string | null }>;
};

const REAL_ACTIONS: InsightsActions = { mark: markInsight, lookAgain: startInsightRun, fullReread: startFullReread };

/** For the gallery: draw a hidden part open. */
export type InsightsOpen = {
  evidence?: boolean;
  why?: Exclude<Verdict, 'right'>;
  earlier?: boolean;
  /** The evidence under a card brought back by a tripwire. */
  fired?: boolean;
  /** The hint on the Full re-read button, naming the routine. */
  reread?: boolean;
};

export const DEPTH_LABELS: Record<InsightDepth, string> = {
  saw: 'What you wrote shows',
  deeper: 'Under that',
  further: 'Under that again',
};

const CONFIDENCE_LABELS: Record<InsightConfidence, string> = {
  high: 'Sure',
  medium: 'Fairly sure',
  hunch: 'A hunch',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  right: 'Right',
  not_quite: 'Not quite',
  wrong: 'Wrong',
};

const VERDICT_TONES: Record<Verdict, ChipTone> = {
  right: 'positive',
  not_quite: 'caution',
  wrong: 'danger',
};

const WHY_PROMPTS: Record<Exclude<Verdict, 'right'>, string> = {
  not_quite: 'What is not quite right?',
  wrong: 'What makes it wrong?',
};

/**
 * Look again is one model call on the API; a run is refused before it starts
 * if it is estimated over two dollars (lib/you/insights-write.ts). No run has
 * been priced yet, so the figure is a guess and says so (law 16).
 */
const LOOK_AGAIN_COST = 'Up to about $2, uncertain';

/** A mark in the joined group: shared edges, the pressed or focused one drawn on top. */
const MARK_CLASS =
  'relative -ml-px rounded-none first:ml-0 first:rounded-l-control last:rounded-r-control ' +
  'focus-visible:z-over-link aria-pressed:z-over-link max-sm:px-2';

/** How often a page with a run going looks again, and for how long. */
const POLL_MS = 60_000;
const POLL_FOR_MS = 60 * 60_000;

function useRefreshWhileRunning(running: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - started > POLL_FOR_MS) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, router]);
}

const capitalised = (word: string) => {
  const spaced = word.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function InsightsView({
  insights,
  run,
  runWhen,
  available,
  rereadAvailable = false,
  timezone = 'UTC',
  actions = REAL_ACTIONS,
  open = {},
}: {
  /** Every insight that is shown, or that they have marked, newest first. */
  insights: readonly Insight[];
  run: InsightRunState;
  /** When the newest run was asked for, already written in their zone. */
  runWhen: string | null;
  /** Whether the deployment can write a run (the API key is set). */
  available: boolean;
  /** Whether the deployment can start a full re-read (both routine variables set). */
  rereadAvailable?: boolean;
  /** Their timezone, for the date on a card brought back. */
  timezone?: string;
  actions?: InsightsActions;
  open?: InsightsOpen;
}) {
  const [marks, setMarks] = useState<ReadonlyMap<string, InsightVerdict>>(new Map());
  const [choosing, setChoosing] = useState<{ id: string; verdict: Exclude<Verdict, 'right'> } | null>(() => {
    const first = insights.find((insight) => insight.status === 'shown' && !insight.verdict && !insight.fired.length);
    return open.why && first ? { id: first.id, verdict: open.why } : null;
  });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pass, setPass] = useState(0);
  const [starting, startTransition] = useTransition();
  const [runError, setRunError] = useState<string | null>(null);
  const running = run.kind === 'running';
  useRefreshWhileRunning(running);

  const verdictOf = (insight: Insight) => marks.get(insight.id) ?? insight.verdict;
  const broughtBack = (insight: Insight): FiredTripwire | null =>
    insight.status === 'shown' ? firedSinceMark(insight.fired, verdictOf(insight)?.decidedAt) : null;
  const isWaiting = (insight: Insight) =>
    insight.status === 'shown' && (!verdictOf(insight) || broughtBack(insight) !== null);
  // Cards brought back by a tripwire come first, the newest fire first; the
  // rest keep their order.
  const waiting = insights
    .filter(isWaiting)
    .map((insight, index) => ({ insight, index, fired: broughtBack(insight) }))
    .sort((a, b) => {
      if (a.fired && b.fired) return Date.parse(b.fired.firedAt) - Date.parse(a.fired.firedAt);
      if (a.fired || b.fired) return a.fired ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ insight }) => insight);
  const earlier = insights
    .flatMap((insight) => {
      const verdict = verdictOf(insight);
      return verdict && !isWaiting(insight) ? [{ insight, verdict }] : [];
    })
    .sort((a, b) => b.verdict.decidedAt.localeCompare(a.verdict.decidedAt));

  const mark = (insight: Insight, verdict: Verdict, why?: string) => {
    const decided: InsightVerdict = { verdict, note: why?.trim() || null, decidedAt: new Date().toISOString() };
    setError(null);
    setChoosing(null);
    setNote('');
    // The deck moves on now; a save that fails puts the card back.
    setMarks((current) => new Map(current).set(insight.id, decided));
    void actions.mark(insight.id, verdict, decided.note).then((result) => {
      if (result.error) {
        setError(`Your mark on “${insight.claim.slice(0, 60)}${insight.claim.length > 60 ? '…' : ''}” was not saved. ${result.error}`);
        setMarks((current) => {
          const next = new Map(current);
          next.delete(insight.id);
          return next;
        });
      } else if (result.saved) {
        const saved = result.saved;
        setMarks((current) => new Map(current).set(insight.id, saved));
      }
    });
  };

  const lookAgain = () =>
    startTransition(async () => {
      const result = await actions.lookAgain();
      setRunError(result.error);
    });
  const fullReread = () =>
    startTransition(async () => {
      const result = await actions.fullReread();
      setRunError(result.error);
    });

  const showLookAgain = available && run.kind !== 'running' && run.kind !== 'failed';
  const lookAgainButton = (
    <DashAction
      type="button"
      variant="secondary"
      pending={starting}
      onClick={lookAgain}
      costText={LOOK_AGAIN_COST}
      what="Cost of looking again"
      align="end"
    >
      {starting ? 'Starting…' : 'Look again'}
    </DashAction>
  );

  const items: DeckItem[] = waiting.map((insight) => {
    const choice = choosing?.id === insight.id ? choosing.verdict : null;
    return {
      key: insight.id,
      body: (
        <InsightCard
          insight={insight}
          fired={broughtBack(insight)}
          timezone={timezone}
          evidenceOpen={open.evidence}
          firedOpen={open.fired}
          why={
            choice ? (
              <WhyLine
                id={insight.id}
                prompt={WHY_PROMPTS[choice]}
                note={note}
                onNote={setNote}
                onSave={() => mark(insight, choice, note)}
                onCancel={() => {
                  setChoosing(null);
                  setNote('');
                }}
              />
            ) : null
          }
        />
      ),
      actions: (
        // One joined group, so the three marks, Previous and Later share one
        // line at 390 (each mark is a choice of the same question).
        <div role="group" aria-label="Your mark" className="flex">
          <Button type="button" variant="secondary" className={MARK_CLASS} onClick={() => mark(insight, 'right')}>
            Right
          </Button>
          {(['not_quite', 'wrong'] as const).map((verdict) => (
            <Button
              key={verdict}
              type="button"
              variant="secondary"
              pressed={choice === verdict}
              className={MARK_CLASS}
              onClick={() => {
                setChoosing(choice === verdict ? null : { id: insight.id, verdict });
                if (choice !== verdict) setNote('');
              }}
            >
              {VERDICT_LABELS[verdict]}
            </Button>
          ))}
        </div>
      ),
    };
  });

  const nothing = insights.length === 0;

  return (
    <PageColumn>
      <PageHeader title="Insights" actions={showLookAgain && !nothing ? lookAgainButton : undefined} />
      <div className="space-y-5">
        {running && (
          <Card padding="standard" className="flex items-start gap-2.5" role="status">
            <DashMark state="working" activity="reading" decorative className="mt-0.5" />
            <p className="text-body text-ink">
              Dash is looking again{runWhen ? `, started ${runWhen}` : ''}. This page fills in when it is done.
              {run.run.runUrl && (
                <>
                  {' '}
                  <a
                    href={run.run.runUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={linkVariants({ tone: 'quiet' })}
                  >
                    Watch the run
                  </a>
                </>
              )}
            </p>
          </Card>
        )}

        {run.kind === 'failed' && (
          <Banner tone="warn">
            <div className="space-y-2">
              <p>{run.error}</p>
              {available && (
                <DashAction
                  type="button"
                  size="sm"
                  variant="secondary"
                  pending={starting}
                  onClick={lookAgain}
                  costText={LOOK_AGAIN_COST}
                  what="Cost of trying again"
                >
                  {starting ? 'Starting…' : 'Try again'}
                </DashAction>
              )}
            </div>
          </Banner>
        )}

        <FieldError>{runError}</FieldError>
        {error && <Banner tone="bad">{error}</Banner>}

        {!available && (
          <p className="text-ui text-ink-muted">
            Runs are not set up on this deployment yet. They need ANTHROPIC_API_KEY in the
            project’s environment variables.
          </p>
        )}

        {nothing ? (
          <EmptyState
            icon={Sparkles}
            title="Nothing noticed yet"
            description="When Dash notices something about you across your notes, tests and history, it will be written here with what it rests on."
          >
            {showLookAgain && lookAgainButton}
          </EmptyState>
        ) : (
          <Deck
            key={pass}
            items={items}
            countOnPhone={false}
            forward="Later"
            done={
              <Card padding="standard">
                {waiting.length === 0 ? (
                  <EmptyState
                    tone="finished"
                    title="That is every insight"
                    description="Your marks are kept under Earlier, and the next run reads them before it writes anything."
                  />
                ) : (
                  <EmptyState
                    tone="finished"
                    title="That is every insight for now"
                    description={`${waiting.length} left for later ${waiting.length === 1 ? 'waits' : 'wait'} for a mark.`}
                  >
                    <Button variant="secondary" size="sm" onClick={() => setPass((p) => p + 1)}>
                      Go through them again
                    </Button>
                  </EmptyState>
                )}
              </Card>
            }
          />
        )}

        {rereadAvailable && !nothing && run.kind !== 'running' && (
          <DashAction
            type="button"
            variant="link"
            pending={starting}
            onClick={fullReread}
            routine="goals"
            what="Cost of a full re-read"
            hintOpen={open.reread}
          >
            Full re-read
          </DashAction>
        )}

        {earlier.length > 0 && (
          <SectionFold title="Earlier" count={earlier.length} defaultOpen={open.earlier ?? false}>
            <ul className={cn(cardVariants(), 'mt-2 divide-y divide-border overflow-hidden')}>
              {earlier.map(({ insight, verdict }) => (
                <li key={insight.id} className="space-y-1 px-4 py-3">
                  <Chip tone={VERDICT_TONES[verdict.verdict]}>{VERDICT_LABELS[verdict.verdict]}</Chip>
                  <p className="text-body text-ink">{insight.claim}</p>
                  {verdict.note && <p className="text-ui text-ink-muted">You said: {verdict.note}</p>}
                </li>
              ))}
            </ul>
          </SectionFold>
        )}
      </div>
    </PageColumn>
  );
}

/** One insight: the claim, the layers under it, and the evidence folded beneath. */
function InsightCard({
  insight,
  fired,
  timezone,
  evidenceOpen,
  firedOpen,
  why,
}: {
  insight: Insight;
  fired: FiredTripwire | null;
  timezone: string;
  evidenceOpen?: boolean;
  firedOpen?: boolean;
  why: React.ReactNode;
}) {
  return (
    // On a phone the card reaches the foot of the screen, so the row of marks
    // and Later under it sits at the same height on every insight.
    <Card
      padding="standard"
      className="space-y-4 max-lg:min-h-[calc(100svh-var(--dock-h)-env(safe-area-inset-bottom)-9rem)]"
    >
      <div className="space-y-1.5" data-insight-claim>
        <p className="text-small text-ink-muted">
          {capitalised(insight.kind)} · {CONFIDENCE_LABELS[insight.confidence]}
        </p>
        <h2 className="font-display text-title tracking-tight text-ink [overflow-wrap:anywhere]">{insight.claim}</h2>
      </div>

      {fired && <BroughtBack fired={fired} timezone={timezone} defaultOpen={firedOpen} />}

      {insight.layers.length > 0 && (
        <ol className="space-y-3">
          {insight.layers.map((layer, index) => (
            <li key={index} className="space-y-0.5">
              <p className="text-small font-medium text-ink-muted">{DEPTH_LABELS[layer.depth]}</p>
              <p className="text-body text-ink [overflow-wrap:anywhere]">{layer.text}</p>
            </li>
          ))}
        </ol>
      )}

      {insight.liveRef && <p className="text-ui text-ink-muted">Tied to {insight.liveRef}</p>}

      {insight.receipts.length > 0 && (
        <Disclosure
          title="Evidence"
          meta={`${insight.receipts.length} ${insight.receipts.length === 1 ? 'piece' : 'pieces'}`}
          defaultOpen={evidenceOpen}
        >
          <ul className="space-y-3">
            {insight.receipts.map((receipt, index) => (
              <Receipt key={index} receipt={receipt} />
            ))}
          </ul>
        </Disclosure>
      )}

      {why}
    </Card>
  );
}

/**
 * The dated line under the claim of a card a tripwire brought back: what
 * happened, when the check saw it, and what it recorded, folded.
 */
function BroughtBack({
  fired,
  timezone,
  defaultOpen,
}: {
  fired: FiredTripwire;
  timezone: string;
  defaultOpen?: boolean;
}) {
  const date = (iso: string) => (iso ? formatDateInline(iso, timezone) : '');
  const line = firedLine(fired, date);
  return (
    <div className="space-y-1" data-insight-fired>
      <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">{line.headline}</p>
      <p className="text-small text-ink-muted">Back on {date(fired.firedAt)} because of this</p>
      {line.details.length > 0 && (
        <Disclosure title="What was seen" meta={String(line.details.length)} defaultOpen={defaultOpen}>
          <ul className="space-y-1.5">
            {line.details.map((detail, index) => (
              <li key={index} className="text-ui text-ink-muted [overflow-wrap:anywhere]">
                {detail}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

/**
 * Where a receipt came from, as the person would name it: a note by its
 * name, a table (`you.personality_results`) by its words ("Personality
 * results").
 */
export function sourceName(source: string): string {
  if (source.includes('/') || source.endsWith('.md')) {
    const name = source.split('/').pop() ?? source;
    return name.replace(/\.md$/, '');
  }
  const table = (source.split('.').pop() ?? source).replace(/_/g, ' ').trim();
  return table ? table.charAt(0).toUpperCase() + table.slice(1) : source;
}

function Receipt({ receipt }: { receipt: InsightReceipt }) {
  const name = sourceName(receipt.source);
  const external = receipt.link && !receipt.link.startsWith('/');
  return (
    <li className="space-y-0.5">
      {receipt.quote && (
        <blockquote className="border-l-2 border-border-strong pl-3 text-body text-ink-muted italic [overflow-wrap:anywhere]">
          {receipt.quote}
        </blockquote>
      )}
      {receipt.link ? (
        external ? (
          <a
            href={receipt.link}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(linkVariants(), 'inline-flex items-center gap-1 text-ui text-ink-muted')}
          >
            {name}
            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
          </a>
        ) : (
          <Link href={receipt.link} className={cn(linkVariants(), 'text-ui text-ink-muted')}>
            {name}
          </Link>
        )
      ) : (
        <p className="text-ui text-ink-muted">{name}</p>
      )}
    </li>
  );
}

/** The line of why under a card marked Not quite or Wrong; saving it moves the deck on. */
function WhyLine({
  id,
  prompt,
  note,
  onNote,
  onSave,
  onCancel,
}: {
  id: string;
  prompt: string;
  note: string;
  onNote: (note: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest' });
  }, []);
  const fieldId = `why-${id}`;
  return (
    <div className="space-y-2" data-insight-why>
      <Label htmlFor={fieldId}>
        {prompt} <span className="font-normal text-ink-muted">Optional</span>
      </Label>
      <Textarea
        ref={box}
        id={fieldId}
        value={note}
        maxLength={2000}
        onChange={(event) => onNote(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onSave}>
          Save mark
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
