'use client';

import { useCallback, useId, useState, type RefObject } from 'react';
import { Disclosure } from '@/components/ui/disclosure';
import { AddTrigger } from '@/components/ui/add-trigger';
import { LinkedText } from '@/components/ui/linked-text';
import { InlineTextarea } from '@/components/ui/field';
import { takeKey } from '@/lib/learn/essays/research-map';
import { withPoint, withTake } from '@/lib/learn/essays/plan';
import type { PlanApi } from './essay-stages';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
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
  type FindingKind,
  type ResearchCitation,
  type ResearchLevel,
  type ResearchSource,
} from '@/lib/learn/essays/research';
import { MAP_SEARCHES } from '@/lib/learn/essays/research-map';
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
      {run.summary && (
        <p className="mb-3 text-small text-ink">
          <LinkedText text={run.summary} refs={false} />
        </p>
      )}
      <ol className="flex flex-col divide-y divide-border">
        {run.positions
          .filter((position) => position.kind !== 'debate')
          .map((position, i) => (
            <li key={i} className="py-3 first:pt-0 last:pb-0">
              <p className="text-ui font-medium text-ink">{position.title}</p>
              {position.summary && (
                <p className="mt-1 text-small text-ink-muted">
                  <LinkedText text={position.summary} refs={false} />
                </p>
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
  const label = running ? 'Searching…' : run ? 'Search again' : 'Search';
  return (
    <CardSection title={title}>
      {run ? (
        <p className="text-small text-ink-muted">{ranLine(run)}</p>
      ) : (
        <p className="text-small text-ink-muted">{about}</p>
      )}
      <div className="mt-2 flex items-center justify-end gap-1">
        <DashAction
          type="button"
          variant="secondary"
          size="sm"
          disabled={running}
          pending={running}
          onClick={() => onRun(level)}
          aria-label={`${label}: ${title}`}
          paid={
            level === 'first'
              ? 'app/learn/e/[id]/actions.ts#researchEssay:first'
              : 'app/learn/e/[id]/actions.ts#researchEssay:deeper'
          }
          what={level === 'first' ? 'Cost of a first pass' : 'Cost of a deeper pass'}
          hintFirst
        >
          {label}
        </DashAction>
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
        about={`Dash searches up to ${MAP_SEARCHES} times for evidence for and against your answer and material you could use, with sources. Nothing from your notes goes into a search. The Research step shows it in full.`}
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
  'Dash is searching for evidence for and against your answer and writing it up. This takes a minute or two; you can go to another step meanwhile.';

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
  // Runs from before the write-up for the writer have parts of the question instead.
  const written = run?.positions.some((p) => p.kind !== undefined) ?? false;
  const debate = run?.positions.find((p) => p.kind === 'debate');
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
              : `Dash reads your answer, searches up to ${MAP_SEARCHES} times, and comes back with where the debate stands, what supports you, what pushes back, and specific things you could use, each with its source. Your words are never pasted into a search.`
          }
          action={
            <DashAction
              paid="app/learn/e/[id]/actions.ts#researchEssay:first"
              what="Cost of researching the question"
              hintFirst
              type="button"
              size="sm"
              variant={run ? 'secondary' : 'primary'}
              disabled={running || !hasQuestion}
              pending={running}
              onClick={() => void api.run('first')}
            >
              {running ? 'Researching…' : run ? 'Research again' : 'Research it'}
            </DashAction>
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
              <p className="text-small font-medium text-ink-muted">
                {written ? 'Where the debate stands' : 'The short answer'}
              </p>
              <p className="mt-1 text-body text-ink">
                <LinkedText text={run.summary} refs={false} />{' '}
                {debate && <SourceLinks citations={debate.citations} sources={run.sources} />}
              </p>
            </div>
          )}
        </CardSection>
      </Card>

      {run && (
        <Card padding="none" aria-busy={running || undefined}>
          {written
            ? GROUPS.map((group) => {
                const items = run.positions
                  .map((finding, i) => ({ finding, i }))
                  .filter(({ finding }) => finding.kind === group.kind);
                if (items.length === 0) return null;
                return (
                  <CardSection key={group.kind} title={group.title} hint={group.hint}>
                    <ul className="flex flex-col divide-y divide-border">
                      {items.map(({ finding, i }) => {
                        const key = takeKey(run.id, { part: i });
                        return (
                          <li key={key} className="py-3 first:pt-0 last:pb-0">
                            {finding.title && (
                              <p className="text-body font-medium text-ink">{finding.title}</p>
                            )}
                            <p className="mt-0.5 text-ui text-ink">
                              <LinkedText text={finding.summary} refs={false} />{' '}
                              <SourceLinks citations={finding.citations} sources={run.sources} />
                            </p>
                            <ItemTake
                              value={takes[key] ?? ''}
                              onSave={(text) => take(key, text)}
                              onPoint={toPoint}
                              isPoint={points.has((takes[key] ?? '').trim().toLowerCase())}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </CardSection>
                );
              })
            : run.positions.map((part, i) => {
                const key = takeKey(run.id, { part: i });
                return (
                  <CardSection key={key} title={`${i + 1}. ${part.title}`}>
                    <p className="text-body text-ink">
                      <LinkedText text={part.summary} refs={false} />
                    </p>
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
        className="min-h-11 lg:min-h-0 -mx-1 text-ink"
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

/** The sections a write-up for the writer is shown in, in order. */
const GROUPS: { kind: FindingKind; title: string; hint: string }[] = [
  { kind: 'for', title: 'Supports your answer', hint: 'Evidence on your side, with who says it.' },
  {
    kind: 'against',
    title: 'Pushes back',
    hint: 'The case against your answer. Your reader may know it, so the essay should meet it.',
  },
  {
    kind: 'use',
    title: 'You could use',
    hint: 'Frameworks, figures, cases and lines worth citing.',
  },
];

/** Each page a finding rests on, as its site's name, opening at the quoted words. */
function SourceLinks({
  citations,
  sources,
}: {
  citations: ResearchCitation[];
  sources: ResearchSource[];
}) {
  const seen = new Set<number>();
  const links = citations.filter(
    (c) => !seen.has(c.source) && seen.add(c.source) && sources[c.source],
  );
  return (
    <span className="whitespace-nowrap text-small">
      {links.map((citation, n) => {
        const source = sources[citation.source]!;
        return (
          <span key={citation.source}>
            {n > 0 && <span className="text-ink-muted"> · </span>}
            <a
              href={textFragmentUrl(source.url, citation.quote)}
              target="_blank"
              rel="noreferrer"
              title={`${source.title}: “${citation.quote}”`}
              className={linkVariants()}
            >
              {source.domain || source.title}
            </a>
          </span>
        );
      })}
    </span>
  );
}

/** A note on one finding, opened when wanted so the list stays easy to read. */
function ItemTake({
  value,
  onSave,
  onPoint,
  isPoint,
}: {
  value: string;
  onSave: (text: string) => void;
  onPoint: (text: string) => void;
  isPoint: boolean;
}) {
  const [open, setOpen] = useState(Boolean(value.trim()));
  if (!open)
    return <AddTrigger label="Note your take" onClick={() => setOpen(true)} className="mt-1" />;
  return (
    <TakeLine label="Your take" value={value} onSave={onSave} onPoint={onPoint} isPoint={isPoint} />
  );
}
