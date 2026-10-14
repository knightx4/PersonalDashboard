import { PageHeader } from '@/components/shell/page-header';
import type { Subject } from '@/lib/learn/graph/load';
import { ProbeSession } from './session';
import { EmptyState } from '@/components/ui/empty-state';
import { PageColumn } from '@/components/shell/page-width';
import type { Subject as PageSubject } from '@/components/shell/page-header';

export type ProbeViewProps = {
  subject: Pick<Subject, 'id' | 'name'>;
  /** How many ideas the subject holds; none means nothing to ask about. */
  ideas: number;
  /** Where the bar starts, from the answers already given. */
  percent: number;
  /** The idea `?concept=` named, when it is in this subject. */
  namedConcept: { id: string; name: string | null } | null;
  /** The path to this page, from the page (rowSubject); the gallery passes none. */
  path?: PageSubject;
};

/** Questions on one subject, from what its page read (plan #1602). */
export function ProbeView({ subject, ideas, percent, namedConcept, path }: ProbeViewProps) {
  return (
    <PageColumn>
      <PageHeader subject={path} title={`Questions on ${subject.name}`} />

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
    </PageColumn>
  );
}
