'use client';

import { useCallback, useId, useState, type RefObject } from 'react';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineTextarea } from '@/components/ui/field';
import { takeKey } from '@/lib/learn/essays/research-map';
import { withPoint, withTake } from '@/lib/learn/essays/plan';
import type { PlanApi } from './essay-stages';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import type { MarkdownEditorHandle } from '@/components/learn/markdown-editor';
import { cn } from '@/lib/cn';
import { approxDollars } from '@/lib/core/spend/estimate-types';
import { deviceTimeZone, whenDay } from '@/lib/core/when';
import {
  countLine,
  DEEPER_PAGES,
  DEEPER_SEARCHES,
  footnoteFor,
  NO_RESEARCH,
  textFragmentUrl,
  VERDICT_LABELS,
  type EssayResearch,
  type EssayResearchRuns,
  type ResearchCitation,
  type ResearchLevel,
  type ResearchSource,
} from '@/lib/learn/essays/research';
import { MAP_PAGES, MAP_SEARCHES } from '@/lib/learn/essays/research-map';
import { researchEssay } from './actions';
import { linkVariants } from '@/components/ui/link';

/** Where each level's run has got to: running, or the error the last press ended with. */
type Pending = Partial<Record<ResearchLevel, 'running' | { error: string }>>;

/**
 * The research behind the card (plan #1863.9): the newest run of each level,
 * and a press that runs one. Nothing runs on its own. `frozen` is for the
 * gallery, which draws a state and never calls the server.
 */
export function useEssayResearch(
  essayId: string,
  editor: RefObject<MarkdownEditorHandle | null>,
  initial: EssayResearchRuns = NO_RESEARCH,
  initialPending: Pending = {},
) {
  const [runs, setRuns] = useState<EssayResearchRuns>(initial);
  const [pending, setPending] = useState<Pending>(initialPending);

  const run = useCallback(
    async (level: ResearchLevel) => {
      setPending((now) => ({ ...now, [level]: 'running' }));
      let result: Awaited<ReturnType<typeof researchEssay>>;
      try {
        result = await researchEssay(essayId, level, editor.current?.doc() ?? '');
      } catch {
        result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
      }
      if (!result.ok) {
        const error = result.error;
        setPending((now) => ({ ...now, [level]: { error } }));
        return;
      }
      const done = result.run;
      setRuns((now) => ({ ...now, [level]: done }));
      setPending((now) => ({ ...now, [level]: undefined }));
    },
    [editor, essayId],
  );

  /** A source becomes a numbered footnote at the cursor, linked to the quoted words. */
  const cite = useCallback(
    (source: ResearchSource, quote: string) => {
      const handle = editor.current;
      if (!handle) return;
      const note = footnoteFor(handle.doc(), source, quote);
      handle.footnote(note.ref, note.definition, { name: source.title });
    },
    [editor],
  );

  return { runs, pending, run, cite };
}

export type ResearchApi = ReturnType<typeof useEssayResearch>;

function ranLine(run: EssayResearch): string {
  const searches = run.queries.length;
  const parts = [
    searches > 0 ? `${searches} ${searches === 1 ? 'search' : 'searches'}` : null,
    run.level === 'deeper'
      ? `${run.sources.length} ${run.sources.length === 1 ? 'page' : 'pages'} quoted`
      : null,
    run.costMicros !== null ? `cost ${approxDollars(run.costMicros)}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** One quoted passage: the words, the page they open at, and the footnote it can become. */
function Quote({
  citation,
  source,
  onCite,
}: {
  citation: ResearchCitation;
  source: ResearchSource;
  onCite: (source: ResearchSource, quote: string) => void;
}) {
  return (
    <li className="flex flex-col gap-1">
      <blockquote className="border-l-2 border-border pl-3 text-small text-ink">
        {citation.stance && (
          <span className="font-medium">{citation.stance === 'for' ? 'For: ' : 'Against: '}</span>
        )}
        {citation.quote}
      </blockquote>
      <div className="flex items-center gap-1 pl-1">
        <a
          href={textFragmentUrl(source.url, citation.quote)}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex min-h-11 min-w-0 flex-1 items-center px-2 text-small lg:min-h-8',
            linkVariants(),
          )}
          title={source.title}
        >
          <span className="truncate">{source.domain || source.title}</span>
        </a>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onCite(source, citation.quote)}
          className="shrink-0"
          aria-label={`Insert a footnote to ${source.title}`}
        >
          Insert footnote
        </Button>
      </div>
    </li>
  );
}

function Quotes({
  citations,
  sources,
  onCite,
}: {
  citations: ResearchCitation[];
  sources: ResearchSource[];
  onCite: (source: ResearchSource, quote: string) => void;
}) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {citations.map((citation, i) => (
        <Quote key={i} citation={citation} source={sources[citation.source]} onCite={onCite} />
      ))}
    </ul>
  );
}

function FirstPass({
  run,
  onCite,
}: {
  run: EssayResearch;
  onCite: (source: ResearchSource, quote: string) => void;
}) {
  return (
    <>
      {run.summary && <p className="mb-3 text-small text-ink">{run.summary}</p>}
      <ol className="flex flex-col divide-y divide-border">
        {run.positions.map((position, i) => (
          <li key={i} className="py-3 first:pt-0 last:pb-0">
            <p className="text-ui font-medium text-ink">{position.title}</p>
            {position.summary && (
              <p className="mt-1 text-small text-ink-muted">{position.summary}</p>
            )}
            <Quotes citations={position.citations} sources={run.sources} onCite={onCite} />
          </li>
        ))}
      </ol>
    </>
  );
}

function DeeperPass({
  run,
  onCite,
}: {
  run: EssayResearch;
  onCite: (source: ResearchSource, quote: string) => void;
}) {
  return (
    <>
      <ol className="flex flex-col divide-y divide-border">
        {run.claims.map((claim, i) => (
          <li key={i} className="py-3 first:pt-0 last:pb-0">
            <p className="text-ui text-ink">{claim.claim}</p>
            <p className="mt-1 text-small text-ink-muted">
              <span
                className={cn(
                  'font-medium',
                  claim.verdict === 'opposed' ? 'text-danger' : 'text-ink',
                )}
              >
                {VERDICT_LABELS[claim.verdict]}
              </span>
              {` · ${countLine(claim)}`}
            </p>
            {claim.citations.length > 0 && (
              <Quotes citations={claim.citations} sources={run.sources} onCite={onCite} />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-small text-ink-muted">
        The counts are of the pages that speak to each claim. They are not weighed by how good each
        page is.
      </p>
    </>
  );
}

function Level({
  level,
  title,
  about,
  run,
  pending,
  onRun,
  onCite,
}: {
  level: ResearchLevel;
  title: string;
  about: string;
  run: EssayResearch | null;
  pending: Pending[ResearchLevel];
  onRun: (level: ResearchLevel) => void;
  onCite: (source: ResearchSource, quote: string) => void;
}) {
  const running = pending === 'running';
  const error = typeof pending === 'object' ? pending.error : null;
  const label = running ? 'Searching…' : run ? 'Run again' : 'Run';
  return (
    <CardSection title={title}>
      {run ? (
        <p className="text-small text-ink-muted">{ranLine(run)}</p>
      ) : (
        <p className="text-small text-ink-muted">{about}</p>
      )}
      <div className="mt-2 flex items-center justify-end gap-1">
        {level === 'first' ? (
          <PaidHint
            action="app/learn/e/[id]/actions.ts#researchEssay:first"
            what="Cost of a first pass"
          />
        ) : (
          <PaidHint
            action="app/learn/e/[id]/actions.ts#researchEssay:deeper"
            what="Cost of a deeper pass"
          />
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={running}
          pending={running}
          onClick={() => onRun(level)}
          aria-label={`${label}: ${title}`}
        >
          {label}
        </Button>
      </div>
      {run && (
        <div aria-busy={running || undefined} className="mt-3">
          {level === 'first' ? (
            <FirstPass run={run} onCite={onCite} />
          ) : (
            <DeeperPass run={run} onCite={onCite} />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-small text-danger">
          {error}
        </p>
      )}
    </CardSection>
  );
}

/**
 * Research, when you ask (plan #1863.9; spec, "Research, when you ask"): two
 * levels, each with its price beside the button that runs it. The first pass
 * searches the web on the essay's question and lists the positions people
 * take, each with the words its pages say; the deeper pass reads up to five
 * pages and marks each claim in the draft by what they say. Every quote
 * links to its page scrolled to those words, and Insert footnote adds it to
 * the essay as a numbered footnote.
 */
export function EssayResearchCard({ api, className }: { api: ResearchApi; className?: string }) {
  return (
    <Card padding="none" className={className}>
      <Level
        level="first"
        title="Research the question"
        about={`Dash breaks your question down, searches up to ${MAP_SEARCHES} times, reads ${MAP_PAGES} pages and writes up what they say, quoting them. Nothing from your notes goes into a search. The Research step shows it in full.`}
        run={api.runs.first}
        pending={api.pending.first}
        onRun={(level) => void api.run(level)}
        onCite={api.cite}
      />
      <Level
        level="deeper"
        title="Check the draft’s claims"
        about={`Up to ${DEEPER_SEARCHES} searches and ${DEEPER_PAGES} pages read in full, then each claim in your draft marked supported, opposed or mixed, with the words that say so.`}
        run={api.runs.deeper}
        pending={api.pending.deeper}
        onRun={(level) => void api.run(level)}
        onCite={api.cite}
      />
    </Card>
  );
}

/** Where the research has got to while it runs, said once rather than as a spinner alone. */
const RUNNING_LINE =
  'Dash is breaking your question down, searching, reading up to five pages and writing up what they say. This takes a minute or two; you can stay on this page or go to another step.';

/**
 * Research, as its own step (LEARN-ESSAYS-SPEC, "The stages"): the first pass
 * in full, laid out to be read top to bottom. The short answer comes first;
 * then each part of the question as a heading with the answer the pages give
 * and, folded under it, the words quoted from them; then the questions the
 * run ends on. Under every part and question is a line for what the person
 * makes of it, in their words, and Make it a point copies that line into the
 * plan. The sources are listed at the foot, numbered.
 */
export function ResearchStage({
  api,
  plan,
  hasQuestion,
  footer,
}: {
  api: ResearchApi;
  plan: PlanApi;
  hasQuestion: boolean;
  footer?: React.ReactNode;
}) {
  const run = api.runs.first;
  const pending = api.pending.first;
  const running = pending === 'running';
  const error = typeof pending === 'object' ? pending.error : null;
  const takes = plan.plan.takes;
  const points = new Set(plan.plan.points.map((p) => p.text.trim().toLowerCase()));

  const take = (key: string, text: string) =>
    plan.change({ kind: 'take', key, text }, (now) => withTake(now, key, text));
  const toPoint = (text: string) =>
    plan.change({ kind: 'add', text }, (now) => withPoint(now, text));

  return (
    <div className="flex flex-col gap-4">
      <Card padding="none">
        <CardSection
          title={run ? 'Research on your question' : 'Research your question'}
          hint={
            run
              ? `${ranLine(run)} · ${whenRan(run.createdAt)}`
              : `Dash breaks the question into the parts a writer needs, searches up to ${MAP_SEARCHES} times, reads ${MAP_PAGES} pages in full, and writes up what they say, quoting them. Only your question and what would change your mind go into the searches.`
          }
          action={
            <span className="flex items-center gap-1">
              <PaidHint
                action="app/learn/e/[id]/actions.ts#researchEssay:first"
                what="Cost of researching the question"
              />
              <Button
                type="button"
                size="sm"
                variant={run ? 'secondary' : 'primary'}
                disabled={running || !hasQuestion}
                pending={running}
                onClick={() => void api.run('first')}
              >
                {running ? 'Researching…' : run ? 'Research again' : 'Research it'}
              </Button>
            </span>
          }
        >
          {!hasQuestion && (
            <p className="text-ui text-ink-muted">
              Write the essay’s question on the Discover step first; the research starts from it.
            </p>
          )}
          {running && (
            <p role="status" className="text-ui text-ink-muted">
              {RUNNING_LINE}
            </p>
          )}
          {error && (
            <p role="alert" className="text-ui text-danger">
              {error}
            </p>
          )}
          {run && run.summary && (
            <div className="mt-1">
              <p className="text-small font-medium text-ink-muted">The short answer</p>
              <p className="mt-1 text-body text-ink">{run.summary}</p>
            </div>
          )}
        </CardSection>
      </Card>

      {run && (
        <Card padding="none" aria-busy={running || undefined}>
          {run.positions.map((part, i) => {
            const key = takeKey(run.id, { part: i });
            return (
              <CardSection key={key} title={`${i + 1}. ${part.title}`}>
                <p className="text-body text-ink">{part.summary}</p>
                {part.citations.length > 0 && (
                  <Disclosure
                    title={`What the pages say (${part.citations.length})`}
                    className="mt-2"
                    summaryClassName="text-small"
                  >
                    <MapQuotes citations={part.citations} sources={run.sources} />
                  </Disclosure>
                )}
                <TakeLine
                  label="What you make of it"
                  value={takes[key] ?? ''}
                  onSave={(text) => take(key, text)}
                  onPoint={toPoint}
                  isPoint={points.has((takes[key] ?? '').trim().toLowerCase())}
                />
              </CardSection>
            );
          })}
          {run.asks.length > 0 && (
            <CardSection
              title="Questions for you"
              hint="Where do you stand? Answer in your own words."
            >
              <ol className="flex flex-col gap-4">
                {run.asks.map((ask, i) => {
                  const key = takeKey(run.id, { ask: i });
                  return (
                    <li key={key}>
                      <p className="text-ui font-medium text-ink">{ask}</p>
                      <TakeLine
                        label="Your answer"
                        value={takes[key] ?? ''}
                        onSave={(text) => take(key, text)}
                        onPoint={toPoint}
                        isPoint={points.has((takes[key] ?? '').trim().toLowerCase())}
                      />
                    </li>
                  );
                })}
              </ol>
            </CardSection>
          )}
          <CardSection
            title="Sources"
            fold="essay-research-sources"
            defaultOpen={false}
            meta={`${run.sources.length}`}
          >
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-ui">
              {run.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn('break-words', linkVariants())}
                  >
                    {source.title}
                  </a>
                  <span className="text-ink-muted"> · {source.domain}</span>
                </li>
              ))}
            </ol>
          </CardSection>
        </Card>
      )}
      {plan.error && (
        <p role="alert" className="text-small text-danger">
          {plan.error}
        </p>
      )}
      {footer}
    </div>
  );
}

function whenRan(iso: string): string {
  const day = whenDay(iso, { timeZone: deviceTimeZone() ?? 'UTC' });
  return day === 'Today' || day === 'Yesterday' ? `run ${day.toLowerCase()}` : `run on ${day}`;
}

/** The quotes under one part of the map, each opening its page at the words. */
function MapQuotes({
  citations,
  sources,
}: {
  citations: ResearchCitation[];
  sources: ResearchSource[];
}) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {citations.map((citation, i) => {
        const source = sources[citation.source];
        if (!source) return null;
        return (
          <li key={i}>
            <blockquote className="border-l-2 border-border pl-3 text-ui text-ink">
              {citation.quote}
            </blockquote>
            <a
              href={textFragmentUrl(source.url, citation.quote)}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'ml-3 inline-flex min-h-11 items-center text-small lg:min-h-8',
                linkVariants(),
              )}
            >
              {source.domain || source.title}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** The person's line under a part of the research, saved when they leave it, and offered as a point. */
function TakeLine({
  label,
  value,
  onSave,
  onPoint,
  isPoint,
}: {
  label: string;
  value: string;
  onSave: (text: string) => void;
  onPoint: (text: string) => void;
  isPoint: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  return (
    <div className="mt-3 flex flex-col gap-0.5 border-l-2 border-accent pl-3">
      <label htmlFor={id} className="text-small text-ink-muted">
        {label}
      </label>
      <InlineTextarea
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="In your own words: agree, disagree, or what it makes you think"
        onBlur={() => {
          if (text.trim() !== value.trim()) onSave(text);
        }}
        className="-mx-1 text-ink"
      />
      {text.trim() && (
        <div>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={isPoint}
            onClick={() => {
              if (text.trim() !== value.trim()) onSave(text);
              onPoint(text);
            }}
          >
            {isPoint ? 'In your plan' : 'Make it a point'}
          </Button>
        </div>
      )}
    </div>
  );
}
