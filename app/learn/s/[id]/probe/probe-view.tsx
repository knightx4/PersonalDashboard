import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { Subject } from '@/lib/learn/graph/load';
import { ProbeSession } from './session';

export type ProbeViewProps = {
  subject: Pick<Subject, 'id' | 'name'>;
  /** How many ideas the subject holds; none means nothing to ask about. */
  ideas: number;
  /** Where the bar starts, from the answers already given. */
  percent: number;
  /** The idea `?concept=` named, when it is in this subject. */
  namedConcept: { id: string; name: string | null } | null;
};

/** Questions on one subject, from what its page read (plan #1602). */
export function ProbeView({ subject, ideas, percent, namedConcept }: ProbeViewProps) {
  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/s/${subject.id}`}
          className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {subject.name}
        </Link>
      </p>

      <PageHeader
        title={`Questions on ${subject.name}`}
        description="One question at a time, each written against one idea."
      />

      {ideas === 0 ? (
        <p
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-6 text-center text-body text-ink-muted',
          )}
        >
          Nothing in this subject to ask about yet. Name a goal first, and the chain leading to it is
          what gets asked about.
        </p>
      ) : (
        <ProbeSession
          subjectId={subject.id}
          startingPercent={percent}
          startConceptId={namedConcept?.id ?? null}
          startConceptName={namedConcept?.name ?? null}
        />
      )}
    </>
  );
}
