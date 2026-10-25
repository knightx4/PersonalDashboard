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
  NowNote,
  PredictionCheck,
  PredictionOutcome,
  Verdict,
} from '@/lib/you/insights';
import { linkText } from '@/lib/you/insights';
import type { InsightRunState } from '@/lib/you/insights-run';
import { answerInsight, markInsight, saveNowNote, startInsightRun, type MarkResult } from './actions';

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
 * Look again starts a run (startInsightRun), a session on the goals routine
 * that reads everything and takes a while; while one is queued or running a
 * banner takes the button's place and the page looks again every minute.
 */

export type InsightsActions = {
  mark: (insightId: string, verdict: Verdict, note?: string | null) => Promise<MarkResult>;
  lookAgain: () => Promise<{ error: string | null }>;
  answer: (insightId: string, answer: string) => Promise<AnswerResult>;
  saveNow: (body: string) => Promise<{ error: string | null; saved?: NowNote }>;
};

type AnswerResult = { error: string | null; saved?: { answer: string | null; answeredAt: string | null } };

const REAL_ACTIONS: InsightsActions = {
  mark: markInsight,
  lookAgain: startInsightRun,
  answer: answerInsight,
  saveNow: saveNowNote,
};

/** For the gallery: draw a hidden part open. */
export type InsightsOpen = {
  evidence?: boolean;
  why?: WhyVerdict;
  earlier?: boolean;
  /** The evidence under a card brought back by a tripwire. */
  fired?: boolean;
  /** The hint on the Look again button, naming the routine. */
  lookAgain?: boolean;
  /** The note on where they are now, folded open. */
  now?: boolean;
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
  knew_it: 'Knew it',
};

const VERDICT_TONES: Record<Verdict, ChipTone> = {
  right: 'positive',
  not_quite: 'caution',
  wrong: 'danger',
  knew_it: 'neutral',
};

/** The marks that open a line of why before they save. */
type WhyVerdict = Exclude<Verdict, 'right' | 'knew_it'>;

const OUTCOME_LABELS: Record<PredictionOutcome, string> = {
  happened: 'It happened',
  did_not: 'It did not happen',
  unclear: 'The records could not tell',
};

const WHY_PROMPTS: Record<WhyVerdict, string> = {
  not_quite: 'What is not quite right?',
  wrong: 'What makes it wrong?',
};

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
  now = { body: '', updatedAt: null },
  timezone = 'UTC',
  actions = REAL_ACTIONS,
  open = {},
}: {
  /** Every insight that is shown, or that they have marked, newest first. */
  insights: readonly Insight[];
  run: InsightRunState;
  /** When the newest run was asked for, already written in their zone. */
  runWhen: string | null;
  /** Whether the deployment can start a run (both goals routine variables set). */
  available: boolean;
  /** Their note on where they are now, which every run reads first. */
  now?: NowNote;
  /** Their timezone, for the date on a card brought back. */
  timezone?: string;
  actions?: InsightsActions;
  open?: InsightsOpen;
}) {
  const [marks, setMarks] = useState<ReadonlyMap<string, InsightVerdict>>(new Map());
  const [choosing, setChoosing] = useState<{ id: string; verdict: WhyVerdict } | null>(() => {
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

  const showLookAgain = available && run.kind !== 'running' && run.kind !== 'failed';
  const lookAgainButton = (
    <DashAction
      type="button"
      variant="secondary"
      pending={starting}
      onClick={lookAgain}
      routine="goals"
      what="Cost of looking again"
      align="end"
      hintOpen={open.lookAgain}
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
          question={
            insight.question ? (
              <Question key={insight.id} insight={insight} onAnswer={actions.answer} />
            ) : null
          }
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
          <Button type="button" variant="secondary" className={MARK_CLASS} onClick={() => mark(insight, 'knew_it')}>
            Knew it
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
                  routine="goals"
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
            Runs are not set up on this deployment yet. They need CLAUDE_GOALS_ROUTINE_ID and
            CLAUDE_GOALS_ROUTINE_TOKEN in the project’s environment variables.
          </p>
        )}

        <NowFold initial={now} timezone={timezone} onSave={actions.saveNow} defaultOpen={open.now ?? (nothing || !now.body)} />

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

        {earlier.length > 0 && (
          <SectionFold title="Earlier" count={earlier.length} defaultOpen={open.earlier ?? false}>
            <ul className={cn(cardVariants(), 'mt-2 divide-y divide-border overflow-hidden')}>
              {earlier.map(({ insight, verdict }) => (
                <li key={insight.id} className="space-y-1 px-4 py-3">
                  <Chip tone={VERDICT_TONES[verdict.verdict]}>{VERDICT_LABELS[verdict.verdict]}</Chip>
                  <p className="text-body text-ink">{insight.claim}</p>
                  {verdict.note && <p className="text-ui text-ink-muted">You said: {verdict.note}</p>}
                  {insight.answer && <p className="text-ui text-ink-muted">You answered: {insight.answer}</p>}
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
  question,
  why,
}: {
  insight: Insight;
  fired: FiredTripwire | null;
  timezone: string;
  evidenceOpen?: boolean;
  firedOpen?: boolean;
  question: React.ReactNode;
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

      {insight.check && <Checked insight={insight} check={insight.check} timezone={timezone} />}

      {insight.layers.length > 0 && (
        <ol className="space-y-3">
          {insight.layers.map((layer, index) => (
            <li key={index} className="space-y-0.5">
              <p className="text-small font-medium text-ink-muted">{DEPTH_LABELS[layer.depth]}</p>
              <p className="text-body text-ink [overflow-wrap:anywhere]">
                <LinkedText text={layer.text} receipts={insight.receipts} />
              </p>
            </li>
          ))}
        </ol>
      )}

      {insight.liveRef && (
        <p className="text-ui text-ink-muted">
          Tied to <LinkedText text={insight.liveRef} receipts={insight.receipts} />
        </p>
      )}

      {question}

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
 * What a run found when it checked a prediction: the result, when Dash made
 * the prediction and when it checked, and what the records showed. A
 * prediction reaches the tab only once it has this.
 */
function Checked({ insight, check, timezone }: { insight: Insight; check: PredictionCheck; timezone: string }) {
  const date = (iso: string | null) => (iso ? formatDateInline(iso, timezone) : '');
  const when = [
    insight.createdAt && `Predicted ${date(insight.createdAt)}`,
    check.checkedAt && `checked ${date(check.checkedAt)}`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="space-y-1" data-insight-checked>
      <p className="text-body font-medium text-ink">{OUTCOME_LABELS[check.outcome]}</p>
      {when && <p className="text-small text-ink-muted">{when}</p>}
      {check.note && <p className="text-body text-ink [overflow-wrap:anywhere]">{check.note}</p>}
    </div>
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

/**
 * A layer's text with its links in place: the ones the run wrote, and the
 * first place it quotes a piece of evidence or names a note it came from.
 */
function LinkedText({ text, receipts }: { text: string; receipts: readonly InsightReceipt[] }) {
  return (
    <>
      {linkText(text, receipts).map((part, index) =>
        !part.link ? (
          <span key={index}>{part.text}</span>
        ) : part.link.startsWith('/') ? (
          <Link key={index} href={part.link} className={linkVariants()}>
            {part.text}
          </Link>
        ) : (
          <a key={index} href={part.link} target="_blank" rel="noreferrer noopener" className={linkVariants()}>
            {part.text}
          </a>
        ),
      )}
    </>
  );
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

/**
 * The question a card ends with and their answer (you 0018). Answering does
 * not mark the card; the next run reads the answer before anything else.
 */
function Question({
  insight,
  onAnswer,
}: {
  insight: Insight;
  onAnswer: InsightsActions['answer'];
}) {
  const [saved, setSaved] = useState(insight.answer ?? '');
  const [draft, setDraft] = useState(insight.answer ?? '');
  const [editing, setEditing] = useState(!insight.answer);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const fieldId = `answer-${insight.id}`;
  const save = () =>
    startSaving(async () => {
      const result = await onAnswer(insight.id, draft);
      setError(result.error);
      if (!result.error) {
        const answer = result.saved?.answer ?? '';
        setSaved(answer);
        setDraft(answer);
        setEditing(!answer);
      }
    });
  return (
    <div className="space-y-2 rounded-control bg-sunken p-3" data-insight-question>
      <Label htmlFor={fieldId} className="text-body font-medium text-ink">
        {insight.question}
      </Label>
      {editing ? (
        <>
          <Textarea
            id={fieldId}
            value={draft}
            maxLength={4000}
            placeholder="The next run starts from your answer."
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" pending={saving} onClick={save} disabled={!draft.trim()}>
              Save answer
            </Button>
            {saved && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(saved);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <p className="text-body text-ink [overflow-wrap:anywhere]">{saved}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change answer
          </Button>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}

/**
 * Where they are now (you 0018): money, focus, what they have decided
 * against. Every run reads it first, so a choice they made on purpose is not
 * read as a gap.
 */
function NowFold({
  initial,
  timezone,
  onSave,
  defaultOpen,
}: {
  initial: NowNote;
  timezone: string;
  onSave: InsightsActions['saveNow'];
  defaultOpen: boolean;
}) {
  const [note, setNote] = useState(initial);
  const [draft, setDraft] = useState(initial.body);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const save = () =>
    startSaving(async () => {
      const result = await onSave(draft);
      setError(result.error);
      if (result.saved) {
        setNote(result.saved);
        setDraft(result.saved.body);
      }
    });
  const changed = draft.trim() !== note.body.trim();
  return (
    <SectionFold
      title="Where you are now"
      hint={note.updatedAt ? `Updated ${formatDateInline(note.updatedAt, timezone)}` : 'Not written yet'}
      defaultOpen={defaultOpen}
    >
      <div className="mt-2 space-y-2">
        <Label htmlFor="insights-now" className="text-ui font-normal text-ink-muted">
          What is going on for you at the moment: money, what you are focused on, what you have decided against.
          Dash reads this before every run, so it does not take a choice you made for a gap.
        </Label>
        <Textarea id="insights-now" value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} />
        <Button type="button" size="sm" variant="secondary" pending={saving} onClick={save} disabled={!changed}>
          Save
        </Button>
        <FieldError>{error}</FieldError>
      </div>
    </SectionFold>
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
