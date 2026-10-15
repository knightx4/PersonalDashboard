'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { Field, Textarea } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { MAX_TITLES, type EmbeddingReport, type PullReport } from '@/lib/learn/catalogue/pull';
import type { ProposeReport } from '@/lib/learn/catalogue/propose';
import { Skeleton } from '@/components/ui/skeleton';
import {
  proposeSubjectArticles,
  pullWikipediaArticles,
  type ProposeState,
  type PullState,
} from './actions';

/**
 * Naming Wikipedia articles for the catalogue, from a subject page.
 *
 * The catalogue is shared by every subject, so nothing here is tied to this
 * one. It sits on the subject page because that is where you know which
 * articles the claims in front of you would need.
 *
 * Every title gets its own line in the answer, and so does the embedding pass.
 * A title Wikipedia does not have, a missing key and a refusal from Voyage are
 * each shown here, because the next thing you would do about each is
 * different.
 *
 * Closed until asked for (law 14). It sits at the foot of every subject page,
 * under the claims and goals that page is for, and it is used now and then;
 * a five-line box standing open there on every visit is the page leading with
 * a chore. Once a pull has answered, the form stays open so the report stays
 * readable beside the titles that produced it.
 */
export function PullArticles({ subjectId, ideaCount }: { subjectId: string; ideaCount: number }) {
  const [state, pull] = useActionState<PullState, FormData>(pullWikipediaArticles, {});
  const [open, setOpen] = useState(false);

  return open || state.report ? (
    <form action={pull} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      <Field
        label="Pull Wikipedia articles into the catalogue"
        id="catalogue-titles"
        hint={`One article per line, by title or by link, up to ${MAX_TITLES}. Each is split into its sections and embedded, and the embedding is charged to your account. Pressing Find a reading on this idea then looks through them.`}
      >
        <Textarea
          id="catalogue-titles"
          name="titles"
          rows={5}
          required
          autoFocus
          placeholder={'Marginal utility\nIndifference curve'}
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PullButton />
        <CloseButton onClose={() => setOpen(false)} hasReport={Boolean(state.report)} />
        {state.error && (
          <span role="alert" className="text-ui text-danger">
            {state.error}
          </span>
        )}
      </div>

      {state.report && <Report report={state.report} />}
    </form>
  ) : (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-1">
        <AddTrigger
          label="Pull Wikipedia articles into the catalogue"
          onClick={() => setOpen(true)}
        />
        {ideaCount > 0 && <FindArticles subjectId={subjectId} ideaCount={ideaCount} />}
      </div>
    </div>
  );
}

/**
 * Find articles for this subject (plan #2157.1): one press looks each idea's
 * name up on Wikipedia and lists the articles it would pull, beside the line
 * that pulls ones you name. It costs nothing, so there is no hint; pulling
 * the kept ones is the paid step and has its own.
 */
function FindArticles({ subjectId, ideaCount }: { subjectId: string; ideaCount: number }) {
  const [state, find, pending] = useActionState<ProposeState, FormData>(proposeSubjectArticles, {});

  return (
    <>
      {/* The button's own padding is pulled back so that, wrapped onto a line
          of its own on a phone, its text starts where the line above does. */}
      <form action={find} className="-ml-2.5">
        <input type="hidden" name="subjectId" value={subjectId} />
        <Button type="submit" variant="ghost" size="sm" pending={pending}>
          {pending ? 'Looking…' : state.report ? 'Find again' : 'Find articles for this subject'}
        </Button>
      </form>
      <div className="basis-full" aria-live="polite">
        {pending ? (
          <ProposalLoading ideaCount={ideaCount} />
        ) : state.error ? (
          <ProposalNotice tone="error">{state.error}</ProposalNotice>
        ) : state.report ? (
          <ProposalResult report={state.report} />
        ) : null}
      </div>
    </>
  );
}

/** Names are resolving one at a time, so the wait grows with the subject. */
export function ProposalLoading({ ideaCount }: { ideaCount: number }) {
  return (
    <div className={cn(cardVariants({ padding: 'standard' }), 'mt-3')} role="status">
      <p className="text-ui text-ink-muted">
        Looking up {ideaCount} {ideaCount === 1 ? 'idea' : 'ideas'} on Wikipedia…
      </p>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </div>
  );
}

export function ProposalNotice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div className={cn(cardVariants({ padding: 'standard' }), 'mt-3')}>
      <p
        className={cn('text-ui', tone === 'error' ? 'text-danger' : 'text-ink-muted')}
        role={tone === 'error' ? 'alert' : undefined}
      >
        {children}
      </p>
    </div>
  );
}

/** What the lookup left out, in one line, so a short list is explained. */
export function leftOutLine(report: ProposeReport): string {
  const parts: string[] = [];
  if (report.inCatalogue > 0) parts.push(`${report.inCatalogue} already in the catalogue`);
  if (report.duplicates > 0) parts.push(`${report.duplicates} named an article another idea had`);
  if (report.unmatched > 0) parts.push(`${report.unmatched} found no article`);
  if (report.overLimit > 0) parts.push(`${report.overLimit} more than one press can pull`);
  return parts.length > 0 ? `Left out: ${parts.join(', ')}.` : '';
}

export function ProposalResult({ report }: { report: ProposeReport }) {
  if (report.proposals.length === 0) {
    return (
      <ProposalNotice tone={report.stopped ? 'error' : 'info'}>
        {report.stopped
          ? `Wikipedia stopped answering (${report.stopped}), and nothing had been found yet. Try again in a minute.`
          : report.inCatalogue > 0 && report.unmatched === 0
            ? 'Every article these ideas name is already in the catalogue.'
            : `Wikipedia had no article to propose for these ideas. ${leftOutLine(report)}`.trim()}
      </ProposalNotice>
    );
  }
  return <ProposalCard report={report} />;
}

/**
 * The list to keep or strike. Everything starts kept; Strike crosses a line
 * out and leaves it out of what Pull sends. The pull is the same action the
 * titles box uses, so its caps and its report are the same.
 */
export function ProposalCard({ report }: { report: ProposeReport }) {
  const [state, pull] = useActionState<PullState, FormData>(pullWikipediaArticles, {});
  const [struck, setStruck] = useState<ReadonlySet<string>>(new Set());
  const kept = report.proposals.filter((proposal) => !struck.has(proposal.title));

  function toggle(title: string) {
    setStruck((current) => {
      const next = new Set(current);
      if (!next.delete(title)) next.add(title);
      return next;
    });
  }

  return (
    <form action={pull} className={cn(cardVariants({ padding: 'standard' }), 'mt-3')}>
      <input type="hidden" name="titles" value={kept.map((proposal) => proposal.title).join('\n')} />
      <p className="text-ui text-ink-muted">
        {report.proposals.length} {report.proposals.length === 1 ? 'article' : 'articles'} from the names of
        this subject&rsquo;s ideas. Strike the ones that are wrong.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {report.proposals.map((proposal) => {
          const isStruck = struck.has(proposal.title);
          return (
            <li key={proposal.title} className="flex items-center justify-between gap-3 py-2 text-ui">
              <span className={cn('min-w-0', isStruck && 'text-ink-muted line-through')}>
                <span className={cn('block break-words', !isStruck && 'text-ink')}>{proposal.title}</span>
                <span
                  className="block truncate text-small text-ink-muted"
                  title={`From the idea: ${proposal.idea}`}
                >
                  from {proposal.idea}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={`${isStruck ? 'Put back' : 'Strike'} ${proposal.title}`}
                aria-pressed={isStruck}
                onClick={() => toggle(proposal.title)}
                className="shrink-0"
              >
                {isStruck ? 'Put back' : 'Strike'}
              </Button>
            </li>
          );
        })}
      </ul>
      {leftOutLine(report) && <p className="mt-2 text-small text-ink-muted">{leftOutLine(report)}</p>}
      {report.stopped && (
        <p role="alert" className="mt-2 text-small text-danger">
          Wikipedia stopped answering ({report.stopped}), so the ideas after this point were not looked up.
          Find again to carry on.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PullKept count={kept.length} />
        {state.error && (
          <span role="alert" className="text-ui text-danger">
            {state.error}
          </span>
        )}
      </div>
      {state.report && <Report report={state.report} />}
    </form>
  );
}

function PullKept({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <DashAction
      type="submit"
      variant="secondary"
      pending={pending}
      disabled={count === 0}
      paid="app/learn/s/[id]/actions.ts#pullWikipediaArticles"
      what="Cost of pulling the articles"
    >
      {pending ? 'Fetching and embedding…' : count === 0 ? 'Nothing kept' : `Pull ${count} ${count === 1 ? 'article' : 'articles'}`}
    </DashAction>
  );
}

/**
 * Folds the form back to its trigger. Hidden once a pull has answered, because
 * the report is kept open on purpose and a Cancel beside it would only lose it.
 */
function CloseButton({ onClose, hasReport }: { onClose: () => void; hasReport: boolean }) {
  const { pending } = useFormStatus();
  if (hasReport) return null;
  return (
    <Button type="button" variant="ghost" onClick={onClose} pending={pending}>
      Cancel
    </Button>
  );
}

function PullButton() {
  const { pending } = useFormStatus();
  return (
    <DashAction
      type="submit"
      variant="secondary"
      pending={pending}
      paid="app/learn/s/[id]/actions.ts#pullWikipediaArticles"
      what="Cost of pulling the articles"
    >
      {pending ? 'Fetching and embedding…' : 'Pull them in'}
    </DashAction>
  );
}

export function Report({ report }: { report: PullReport }) {
  const { articles, embedding } = report;

  return (
    <div className="mt-4" aria-live="polite">
      <ul className="divide-y divide-border">
        {articles.map((article) => (
          <li key={article.asked} className="py-2 text-ui">
            {article.ok ? (
              <>
                <span className="text-ink">{article.title}</span>
                <span className="text-ink-muted">
                  {' '}
                  · {article.segments} {article.segments === 1 ? 'section' : 'sections'}
                  {article.removed > 0 ? `, ${article.removed} dropped since last time` : ''}
                </span>
              </>
            ) : (
              <>
                <span className="text-ink">{article.asked}</span>
                <span className="text-danger">
                  {' '}
                  · not stored ({article.reason}): {article.detail}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <p
        className={cn('mt-3 text-ui', embedding?.stopped ? 'text-danger' : 'text-ink-muted')}
        role={embedding?.stopped ? 'alert' : undefined}
      >
        {embeddingLine(embedding)}
      </p>
    </div>
  );
}

/**
 * The embedding pass as one line. Shared with the course form, which names
 * what it embedded as segments rather than sections.
 */
export function embeddingLine(
  embedding: EmbeddingReport | null,
  noun: { one: string; many: string } = { one: 'section', many: 'sections' },
): string {
  if (!embedding) return 'Nothing was stored, so nothing was embedded.';

  const done = `${embedding.embedded} ${embedding.embedded === 1 ? noun.one : noun.many} embedded`;
  if (embedding.stopped?.reason === 'time') {
    return `${done} before the press ran out of time. Press again to embed the rest.`;
  }
  if (embedding.stopped) {
    const why =
      embedding.stopped.reason === 'no-key'
        ? 'EMBEDDING_API_KEY is not set on this deployment, so nothing new can be searched yet.'
        : `Embedding stopped (${embedding.stopped.reason}): ${embedding.stopped.detail}.`;
    return `${done} before it stopped. ${why} Press again once it is fixed and it carries on from here.`;
  }
  if (embedding.capped) {
    return `${done}, which is as many as one press does. Press again to embed the rest.`;
  }
  return `${done}. They can be found from an idea now.`;
}
