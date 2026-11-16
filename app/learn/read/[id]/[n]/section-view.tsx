import Link, { linkVariants } from '@/components/ui/link';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { sectionSubject } from '@/lib/core/section-path';
import type { Section } from '@/lib/learn/reader/source';
import type { ReaderSource } from '@/lib/learn/reader/store';
import { ReaderFigure } from '../../figure';
import { Deeper, Finish } from './section-actions';
import { SectionText } from './section-text';

/**
 * One section of a source (docs/LEARN-READER-SPEC.md). In the order a person
 * reads it: where they are in the argument, the author's own text with a
 * note behind each hard phrase, then the one idea the section leaves. A
 * question to think through is folded under that, for whoever wants it; none
 * is ever put in the way. The forward row finishes the section and goes on.
 *
 * A section whose text may not be shown reads as its summary, and says so.
 */
export function SectionView({
  source,
  section,
  n,
  total,
}: {
  source: ReaderSource;
  section: Section;
  n: number;
  total: number;
}) {
  const next = n < total ? (source.prepared?.sections[n] ?? null) : null;
  return (
    <PageColumn className="space-y-5">
      <PageHeader
        subject={sectionSubject(
          '/learn/read',
          'Read',
          { label: source.title, href: `/learn/read/${source.id}` },
          { label: section.title, href: `/learn/read/${source.id}/${n}` },
        )}
        title={section.title}
        description={`${source.title} · ${n} of ${total} · ${section.minutes} min`}
      />

      <section aria-label="Context" className="space-y-1">
        <h2 className="text-small font-medium text-ink-muted">Context</h2>
        <p className="text-ui text-ink [overflow-wrap:anywhere]">{section.context}</p>
      </section>

      {section.figure && <ReaderFigure figure={section.figure} />}

      {section.text ? (
        <SectionText
          paragraphs={section.text}
          glosses={section.glosses}
          byline={[source.prepared?.author, source.prepared?.published].filter(Boolean).join(', ')}
        />
      ) : (
        <section aria-label="Summary" className="space-y-2">
          <p className="text-body text-ink [overflow-wrap:anywhere]">{section.summary}</p>
          <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
            {source.basis === 'memory'
              ? 'A summary Dash wrote from what it knows of the work, not checked against the text.'
              : 'A summary Dash wrote after reading the text.'}
            {section.pages ? ` In a printed copy this is ${section.pages}.` : ''}{' '}
            <Link href={`/learn/read/${source.id}`} className={linkVariants()}>
              Add your copy
            </Link>{' '}
            to read the text here.
          </p>
        </section>
      )}

      <Card padding="dense" className="space-y-1 bg-accent-tint">
        <h2 className="text-small font-medium text-accent">The one idea</h2>
        <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">{section.idea}</p>
      </Card>

      {section.questions.length > 0 && (
        <CardSection
          title="Something to think through"
          fold="learn.read.question"
          defaultOpen={false}
        >
          <div className="space-y-4">
            {section.questions.map((item) => (
              <div key={item.question} className="space-y-1">
                <p className="text-ui text-ink [overflow-wrap:anywhere]">{item.question}</p>
                <Disclosure title="One answer">
                  <p className="pb-2 text-ui text-ink [overflow-wrap:anywhere]">{item.answer}</p>
                </Disclosure>
              </div>
            ))}
          </div>
        </CardSection>
      )}

      <div className="flex flex-col gap-2">
        <Finish
          sourceId={source.id}
          n={n}
          label={next ? `Next: ${next.title} · ${next.minutes} min` : 'Finish'}
        />
        <Link href="/learn/read" className={buttonVariants({ variant: 'ghost' })}>
          Stop here
        </Link>
      </div>

      <CardSection title="Go deeper" fold="learn.read.deeper" defaultOpen={false}>
        <Deeper sourceId={source.id} n={n} />
      </CardSection>
    </PageColumn>
  );
}
