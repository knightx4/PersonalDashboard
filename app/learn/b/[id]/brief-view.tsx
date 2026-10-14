'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Sparkle } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { MainRail } from '@/components/patterns/main-rail';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { EditableProse } from '@/components/ui/editable-prose';
import { Switch } from '@/components/ui/field';
import { LiveDot } from '@/components/ui/live-dot';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { PaidHint } from '@/components/ui/paid-hint';
import { Chip } from '@/components/ui/chip';
import { watchLine } from '@/lib/learn/briefs/watch';
import { FOUND_KIND_LABELS, type Brief, type BriefCitation, type BriefSection } from '@/lib/learn/briefs/model';
import {
  briefStage,
  sectionSources,
  foundLine,
  sourceLine,
  sourcesFoundSince,
  type BriefOnPage,
  type BriefPage,
  type BriefSource,
} from '@/lib/learn/briefs/view';
import { QuickReadButton } from './quick/quick-read-button';
import { StartEssayButton } from './start-essay-button';
import { retryBrief, saveShortAnswer, setBriefArchived, setBriefWatch } from './actions';
import { Breadcrumb } from '@/components/shell/breadcrumb';
import type { Subject as PageSubject } from '@/components/shell/page-header';

/** How often a researching brief asks the server for what the run has written. */
const POLL_MS = 4000;
/** Stop asking after this long; a run takes about five minutes. */
const POLL_FOR_MS = 20 * 60_000;

/**
 * While the run is going, re-reads the page every few seconds so the stage
 * and the sub-questions fill in, and the answers replace them when it
 * finishes, without a reload.
 */
function useLiveWhileResearching(researching: boolean, live: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!researching || !live) return;
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
  }, [researching, live, router]);
}

/**
 * One quoted passage. Hovering it with a mouse, or tapping it, shows where
 * it came from: the source's title, what kind of publisher it is, and its
 * date. Escape or a press elsewhere closes it.
 */
function Quote({
  citation,
  source,
  defaultOpen = false,
}: {
  citation: BriefCitation;
  source: BriefSource | undefined;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const wrap = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const quote = <span className="text-ink">&ldquo;{citation.quote}&rdquo;</span>;
  if (!source) return <blockquote className="border-l-2 border-border pl-3 text-ui">{quote}</blockquote>;

  return (
    <span
      ref={wrap}
      className="relative block"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setOpen(false);
      }}
    >
      <blockquote className="border-l-2 border-border pl-3">
        <button
          type="button"
          aria-expanded={open}
          aria-describedby={open ? tipId : undefined}
          onClick={() => setOpen((was) => !was)}
          className="press rounded-control text-left text-ui hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {quote}
        </button>
      </blockquote>
      {open && (
        <Popover id={tipId} role="tooltip" anchor="trigger-below" className="w-max max-w-72 px-3 py-2">
          <span className="block text-small font-medium text-ink [overflow-wrap:anywhere]">{source.title}</span>
          <span className="mt-0.5 block text-small text-ink-muted">{sourceLine(source)}</span>
        </Popover>
      )}
    </span>
  );
}

function Section({
  index,
  text,
  section,
  sources,
  openQuote,
}: {
  index: number;
  text: string;
  section: BriefSection | undefined;
  sources: Record<string, BriefSource>;
  openQuote?: string;
}) {
  const from = section ? sectionSources(section, sources) : [];
  return (
    <Card padding="standard" className="flex flex-col gap-3">
      <h2 className="text-body font-semibold text-ink">
        <span className="mr-2 tabular-nums text-ink-muted">{index}.</span>
        {text}
      </h2>
      {section ? (
        <>
          <p className="max-w-prose text-body text-ink">{section.position}</p>
          {section.citations.length > 0 && (
            <ul className="flex flex-col gap-2">
              {section.citations.map((citation, i) => (
                <li key={i}>
                  <Quote
                    citation={citation}
                    source={sources[citation.reading_id]}
                    defaultOpen={openQuote === `${section.sub_question_id}:${i}`}
                  />
                </li>
              ))}
            </ul>
          )}
          {from.length > 0 && (
            <div>
              <h3 className="text-small text-ink-muted">From</h3>
              <ul className="mt-1 flex flex-col">
                {from.map((source) => (
                  <li key={source.readingId} className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/learn/r/${source.readingId}`}
                      className={cn('inline-flex min-h-11 items-center text-ui lg:min-h-8', linkVariants())}
                    >
                      {source.title}
                    </Link>
                    {source.kind && (
                      <span className="text-small text-ink-muted">{FOUND_KIND_LABELS[source.kind]}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-ui text-ink-muted">The sources found had nothing to say on this one.</p>
      )}
    </Card>
  );
}

function Researching({ brief, sourcesFound }: { brief: Brief; sourcesFound: number }) {
  const stage = briefStage(brief, sourcesFound);
  return (
    <Card padding="standard" aria-live="polite" className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-body font-semibold text-ink">
        <LiveDot />
        {stage.label}
      </p>
      <p className="text-ui text-ink-muted">{stage.detail} This page fills in when it is done, usually within five minutes.</p>
      {brief.subQuestions.length > 0 && (
        <ol className="flex flex-col gap-1 border-t border-border pt-3">
          {brief.subQuestions.map((sub, i) => (
            <li key={sub.id} className="flex gap-2 text-ui text-ink">
              <span className="tabular-nums text-ink-muted">{i + 1}.</span>
              {sub.text}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Failed({ brief }: { brief: Brief }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card padding="standard" role="alert" className="flex flex-col items-start gap-3">
      <p className="text-body font-semibold text-ink">The research stopped before it finished</p>
      <p className="text-ui text-ink-muted">{brief.error?.trim() || 'Dash did not say why.'}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          pending={pending}
          onClick={() =>
            start(async () => {
              const result = await retryBrief(brief.id);
              if (result.error) setError(result.error);
              else router.refresh();
            })
          }
        >
          Try again
        </Button>
        <PaidHint action="app/learn/b/[id]/actions.ts#retryBrief" what="Cost of researching it again" />
      </div>
      {error && <p className="text-small text-danger">{error}</p>}
    </Card>
  );
}

function ShortAnswer({ brief, editing }: { brief: Brief; editing: boolean }) {
  const [by, setBy] = useState(brief.shortAnswerBy);
  return (
    <Card padding="standard" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-body font-semibold text-ink">The short answer</h2>
        <span className="text-small text-ink-muted">{by === 'you' ? 'Edited by you' : 'Written by Dash'}</span>
      </div>
      <EditableProse
        value={brief.shortAnswer}
        label="Short answer"
        editLabel="Edit the short answer"
        empty="No short answer yet."
        startEditing={editing}
        className="max-w-prose text-body [&_textarea]:max-h-none"
        onSave={async (next) => {
          const failed = await saveShortAnswer(brief.id, next);
          if (!failed) setBy('you');
          return failed;
        }}
      />
    </Card>
  );
}

/**
 * The sources the weekly check found since the brief was written (plan
 * #2023.8), newest first: each with the line on what it changes in the
 * answer, and marked new until it is opened from the list.
 */
function NewSince({ sources }: { sources: BriefSource[] }) {
  if (sources.length === 0) return null;
  return (
    <Card padding="standard" className="flex flex-col gap-3">
      <h2 className="text-body font-semibold text-ink">New since you asked</h2>
      <ul className="flex flex-col divide-y divide-border">
        {sources.map((source) => (
          <li key={source.readingId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={`/learn/r/${source.readingId}`}
                className={cn('inline-flex min-h-11 items-center text-ui [overflow-wrap:anywhere] lg:min-h-8', linkVariants())}
              >
                {source.title}
              </Link>
              {source.isNew && (
                <Chip>
                  <Sparkle strokeWidth={1.75} aria-hidden />
                  New
                </Chip>
              )}
            </p>
            <p className="max-w-prose text-body text-ink">{source.change}</p>
            <p className="text-small text-ink-muted">{foundLine(source)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Rail({ brief, sourcesFound }: { brief: BriefOnPage; sourcesFound: number }) {
  const [watch, setWatch] = useState(brief.watchOn);
  const [archived, setArchived] = useState(brief.archivedAt !== null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const switchId = useId();

  return (
    <Card padding="none">
      <CardSection title="Reading list">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-ui">
          {brief.trackId ? (
            <Link
              href={`/learn/t/${brief.trackId}`}
              className={linkVariants({ className: 'inline-flex min-h-11 items-center lg:min-h-0' })}
            >
              {brief.trackTitle ?? 'The sources it found'}
            </Link>
          ) : (
            <span className="text-ink-muted">No reading list yet</span>
          )}
          <span className="text-small text-ink-muted tabular-nums">
            {sourcesFound === 0 ? 'No sources' : `${sourcesFound} ${sourcesFound === 1 ? 'source' : 'sources'}`}
          </span>
        </p>
      </CardSection>
      <CardSection title="New sources">
        <label htmlFor={switchId} className="flex min-h-11 items-center justify-between gap-3 lg:min-h-8">
          <span>
            <span className="block text-ui text-ink">Check every week</span>
            <span className="block text-small text-ink-muted">
              {watchLine(brief)}
            </span>
          </span>
          <Switch
            id={switchId}
            checked={watch}
            disabled={archived}
            onChange={(event) => {
              const on = event.target.checked;
              setWatch(on);
              setError(null);
              void setBriefWatch(brief.id, on).then((result) => {
                if (result.error) {
                  setWatch(!on);
                  setError(result.error);
                }
              });
            }}
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            pending={pending}
            onClick={() =>
              start(async () => {
                const result = await setBriefArchived(brief.id, !archived);
                if (result.error) setError(result.error);
                else setArchived(!archived);
              })
            }
          >
            {archived ? 'Restore' : 'Archive'}
          </Button>
          <span className="text-small text-ink-muted">
            {archived ? 'Off your list in Learn.' : 'Takes it off your list in Learn.'}
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-small text-danger">
            {error}
          </p>
        )}
      </CardSection>
    </Card>
  );
}

/**
 * A researched topic on its own page (plan #2023.4), read top to bottom: the
 * question and why, the short answer, then one section per sub-question with
 * the position the sources take, the quoted words and the readings they came
 * from. The rail holds the reading list, the weekly check and archive.
 *
 * `live` is off in the gallery; `openQuote` and `editing` draw a hidden part
 * open there (a quote's source as `<sub-question id>:<index>`, and the short
 * answer's editor).
 */
export function BriefView({
  page,
  live = true,
  openQuote,
  editing = false,
  path,
}: {
  page: BriefPage;
  live?: boolean;
  openQuote?: string;
  editing?: boolean;
  /** The path to the brief, from the page (rowSubject); the gallery passes none and keeps the link to Now. */
  path?: PageSubject;
}) {
  const { brief, sources } = page;
  const sourcesFound = Object.keys(sources).length;
  useLiveWhileResearching(brief.status === 'researching', live);
  const sections = new Map(brief.sections.map((section) => [section.sub_question_id, section]));

  const main = (
    <div className="flex flex-col gap-4">
      {/* The path, Learn › this brief, leads back to Now as well, so the page
          draws it once (plan #1931.2). */}
      {path ? (
        <Breadcrumb crumbs={path.path} className="-mb-1" />
      ) : (
        <Link
          href="/learn/now"
          className="-mb-1 inline-flex min-h-11 items-center gap-1 self-start text-ui text-ink-muted hover:text-ink lg:min-h-8"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          Now
        </Link>
      )}
      <header>
        <h1 className="font-display text-title tracking-tight text-ink [overflow-wrap:anywhere]">{brief.question}</h1>
      </header>
      {brief.angle && (
        <section aria-label="Why you asked" className="rounded-card bg-sunken px-4 py-3">
          <h2 className="text-small text-ink-muted">Why you asked</h2>
          <p className="mt-1 max-w-prose text-body text-ink">{brief.angle}</p>
        </section>
      )}
      {brief.status === 'researching' && <Researching brief={brief} sourcesFound={sourcesFound} />}
      {brief.status === 'failed' && <Failed brief={brief} />}
      {brief.status === 'ready' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <StartEssayButton briefId={brief.id} />
            <QuickReadButton briefId={brief.id} />
          </div>
          <ShortAnswer brief={brief} editing={editing} />
          <NewSince sources={sourcesFoundSince(sources)} />
          {brief.subQuestions.map((sub, i) => (
            <Section
              key={sub.id}
              index={i + 1}
              text={sub.text}
              section={sections.get(sub.id)}
              sources={sources}
              openQuote={openQuote}
            />
          ))}
        </>
      )}
    </div>
  );

  return <MainRail main={main} rail={<Rail brief={brief} sourcesFound={sourcesFound} />} />;
}
