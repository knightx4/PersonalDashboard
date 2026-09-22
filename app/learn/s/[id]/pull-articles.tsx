'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { MAX_TITLES, type PullReport } from '@/lib/learn/catalogue/pull';
import { pullWikipediaArticles, type PullState } from './actions';

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
 */
export function PullArticles() {
  const [state, pull] = useActionState<PullState, FormData>(pullWikipediaArticles, {});

  return (
    <form action={pull} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      <Field
        label="Pull Wikipedia articles into the catalogue"
        id="catalogue-titles"
        hint={`One article per line, by title or by link, up to ${MAX_TITLES}. Each is split into its sections and embedded, and the embedding is charged to your account. Pressing Find something to read on a claim then looks through them.`}
      >
        <Textarea
          id="catalogue-titles"
          name="titles"
          rows={5}
          required
          placeholder={'Marginal utility\nIndifference curve'}
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PullButton />
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

function PullButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Fetching and embedding…' : 'Pull them in'}
    </Button>
  );
}

function Report({ report }: { report: PullReport }) {
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

function embeddingLine(embedding: PullReport['embedding']): string {
  if (!embedding) return 'Nothing was stored, so nothing was embedded.';

  const done = `${embedding.embedded} ${embedding.embedded === 1 ? 'section' : 'sections'} embedded`;
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
  return `${done}. They can be found from a claim now.`;
}
