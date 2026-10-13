import Link from '@/components/ui/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import type { Subject } from '@/lib/learn/graph/load';
import { ProbeSession } from './session';
import { EmptyState } from '@/components/ui/empty-state';

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
          <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
          {subject.name}
        </Link>
      </p>

      <PageHeader title={`Questions on ${subject.name}`} />

      {ideas === 0 ? (
        <EmptyState
          size="box"
          title="Nothing in this subject to ask about yet."
          description="Name a goal first, and the chain leading to it is what gets asked about."
        />
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
