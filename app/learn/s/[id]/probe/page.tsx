import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { subjectBarPercent } from '@/lib/learn/graph/session';
import { ProbeSession } from './session';

export const dynamic = 'force-dynamic';

/**
 * Finding out what you actually know about one subject.
 *
 * The bar starts where the rows left it, so a session picked up next week
 * carries on rather than starting again -- nothing about a session lives
 * anywhere but in the probes table.
 */
export default async function ProbePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const subject = await loadSubject(supabase, id);
  if (!subject) notFound();

  const graph = await loadGraph(supabase, id);
  const percent = await subjectBarPercent(
    supabase,
    graph.concepts.map((concept) => concept.id),
  );

  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/s/${id}`}
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {subject.name}
        </Link>
      </p>

      <PageHeader
        title={`Probing ${subject.name}`}
        description="One question at a time, each written against one claim."
      />

      {graph.concepts.length === 0 ? (
        <p
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-6 text-center text-body text-ink-muted',
          )}
        >
          Nothing in this subject to ask about yet. Name a goal first, and the chain leading to it
          is what gets probed.
        </p>
      ) : (
        <ProbeSession subjectId={id} startingPercent={percent} />
      )}
    </>
  );
}
