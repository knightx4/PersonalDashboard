import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { subjectBarPercent } from '@/lib/learn/graph/session';
import { ProbeView } from './probe-view';

export const dynamic = 'force-dynamic';

/**
 * Finding out what you actually know about one subject.
 *
 * The bar starts where the rows left it, so a session picked up next week
 * carries on rather than starting again -- nothing about a session lives
 * anywhere but in the probes table.
 *
 * `?concept=` names what the first question is about, which is how the row on
 * /learn/next opens a session. It is not checked here: an id from another
 * subject is refused by the action, with a message, rather than turning into a
 * page that quietly probes something else.
 */
export default async function ProbePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ concept?: string }>;
}) {
  const { id } = await params;
  const { concept: namedConceptId } = await searchParams;

  const supabase = await createLearnClient();
  const subject = await loadSubject(supabase, id);
  if (!subject) notFound();

  const graph = await loadGraph(supabase, id);
  const percent = await subjectBarPercent(
    supabase,
    graph.concepts.map((concept) => concept.id),
  );

  return (
    <ProbeView
      subject={subject}
      ideas={graph.concepts.length}
      percent={percent}
      namedConcept={
        namedConceptId
          ? {
              id: namedConceptId,
              name: graph.concepts.find((concept) => concept.id === namedConceptId)?.name ?? null,
            }
          : null
      }
    />
  );
}
