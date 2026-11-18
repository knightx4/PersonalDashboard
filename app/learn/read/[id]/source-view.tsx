import Link from '@/components/ui/link';
import { Check } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { LiveDot } from '@/components/ui/live-dot';
import { sectionSubject } from '@/lib/core/section-path';
import { nextSection } from '@/lib/learn/reader/shelves';
import type { PreparedSource } from '@/lib/learn/reader/source';
import type { ReaderSource } from '@/lib/learn/reader/store';
import { ReaderFigure } from '../figure';
import { Preparing, Verdict, YourCopy } from './source-actions';

/**
 * One source, in layers (docs/LEARN-READER-SPEC.md). First the context: who
 * wrote it, when, against what. Then the whole of it in a few sentences and
 * the one idea to take away. Then its sections, each opening to its own
 * summary, with the text one press further in. So a person can stop at the
 * depth they have time for and still have the argument.
 */
export function SourceView({ source }: { source: ReaderSource }) {
  const header = (title: string, description?: string) => (
    <PageHeader
      subject={sectionSubject('/learn/read', 'Now', {
        label: title,
        href: `/learn/read/${source.id}`,
      })}
      title={title}
      description={description}
    />
  );

  const prepared = source.prepared;
  if (!prepared) {
    return (
      <PageColumn className="space-y-5">
        {header(source.title)}
        <Card padding="dense" className="space-y-3">
          <p className="flex items-center gap-2 text-body text-ink">
            {source.status !== 'failed' && (
              <LiveDot
                tone={source.status === 'preparing' ? 'accent' : 'muted'}
                still={source.status !== 'preparing'}
              />
            )}
            {source.status === 'failed'
              ? 'Dash could not prepare this.'
              : source.status === 'preparing'
                ? 'Dash is preparing this. It takes a few minutes, and you can leave this page.'
                : 'Waiting for Dash to start.'}
          </p>
          {source.asked && (
            <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
              You asked for: {source.asked}
            </p>
          )}
          {source.error && (
            <p className="text-small text-caution [overflow-wrap:anywhere]">{source.error}</p>
          )}
          <Preparing sourceId={source.id} status={source.status} />
        </Card>
      </PageColumn>
    );
  }

  const next = nextSection(source);
  const byline = [prepared.author, prepared.published, `${prepared.minutes} min`]
    .filter(Boolean)
    .join(' · ');
  return (
    <PageColumn className="space-y-5">
      {header(prepared.title, byline)}
      {source.why && (
        <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{source.why}</p>
      )}

      <Layers prepared={prepared} />

      {next && (
        <Link
          href={`/learn/read/${source.id}/${next}`}
          className={buttonVariants({
            variant: 'primary',
            size: 'lg',
            className: 'h-auto w-full py-3 whitespace-normal',
          })}
        >
          <span className="min-w-0 text-center whitespace-normal [overflow-wrap:anywhere]">
            {source.read.length > 0 ? 'Go on' : 'Start'}: {prepared.sections[next - 1].title} ·{' '}
            {prepared.sections[next - 1].minutes} min
          </span>
        </Link>
      )}

      <Card padding="none">
        <ol className="divide-y divide-border">
          {prepared.sections.map((section, index) => {
            const n = index + 1;
            const read = source.read.includes(n);
            return (
              <li key={n} className="card-pad-x">
                <Disclosure
                  defaultOpen={n === next}
                  title={
                    <span className={read ? 'text-ink-muted' : 'text-ink'}>
                      <span className="tabular mr-2 text-ink-muted">{n}</span>
                      {section.title}
                    </span>
                  }
                  meta={
                    read ? (
                      <Check
                        className="size-4 text-positive"
                        strokeWidth={1.75}
                        aria-label="Read"
                      />
                    ) : (
                      `${section.minutes} min`
                    )
                  }
                >
                  <div className="space-y-3 pb-3">
                    <p className="text-ui text-ink [overflow-wrap:anywhere]">{section.summary}</p>
                    <Link
                      href={`/learn/read/${source.id}/${n}`}
                      className={buttonVariants({ variant: 'secondary' })}
                    >
                      {section.text ? 'Read the text' : 'Open this section'}
                    </Link>
                  </div>
                </Disclosure>
              </li>
            );
          })}
        </ol>
      </Card>

      {prepared.rights !== 'open' && (
        <CardSection title="The text itself" fold="learn.read.copy" defaultOpen={false}>
          <div className="space-y-3">
            <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">
              {source.basis === 'memory'
                ? 'This work is in copyright, so its text is not shown here. Dash wrote these summaries from what it knows of the work and has not checked them against the text.'
                : 'This work is in copyright, so its text is not shown here. Dash read it to write these summaries.'}{' '}
              Paste your own copy and Dash prepares it again from the text, with notes on the hard
              passages.
            </p>
            <YourCopy
              sourceId={source.id}
              waiting={source.status !== 'ready'}
              given={source.givenText}
            />
          </div>
        </CardSection>
      )}

      <Verdict sourceId={source.id} verdict={source.verdict} />
    </PageColumn>
  );
}

/** The top three layers: context, the work in brief, the one idea. */
function Layers({ prepared }: { prepared: PreparedSource }) {
  return (
    <>
      <section aria-label="Context" className="space-y-1">
        <h2 className="text-small font-medium text-ink-muted">Context</h2>
        <p className="text-ui text-ink [overflow-wrap:anywhere]">{prepared.context}</p>
      </section>
      <section aria-label="In brief" className="space-y-1">
        <h2 className="text-small font-medium text-ink-muted">In brief</h2>
        <p className="text-body text-ink [overflow-wrap:anywhere]">{prepared.brief}</p>
      </section>
      <Card padding="dense" className="space-y-1 bg-accent-tint">
        <h2 className="text-small font-medium text-accent">The one idea</h2>
        <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">{prepared.idea}</p>
      </Card>
      {prepared.figure && <ReaderFigure figure={prepared.figure} />}
    </>
  );
}
