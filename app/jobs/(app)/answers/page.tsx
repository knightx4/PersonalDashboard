import { MessageSquareText } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { AnswerBank } from './bank';

export const metadata = { title: 'Answers' };

const KINDS = [
  'motivation',
  'fit',
  'behavioral',
  'technical',
  'logistics',
  'demographic',
  'other',
] as const;

/**
 * The question bank.
 *
 * The reuse loop is the whole point: after twenty applications the common
 * questions are answered and the work per application drops to tailoring.
 * Generation is later work, but capture and manual answering are MVP precisely so
 * the bank has real content by the time generation exists.
 */
export default async function AnswersPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const kind = KINDS.find((k) => k === params.kind);

  const { data: questions } = await supabase
    .from('questions')
    .select(
      'id, text, kind, canonical_answer, canonical_answer_updated_at, times_seen, application_answers ( id, answer, status, application_id )',
    )
    .eq('user_id', user.id)
    .order('times_seen', { ascending: false });

  const rows = (questions ?? []) as unknown as Array<{
    id: string;
    text: string;
    kind: string;
    canonical_answer: string | null;
    canonical_answer_updated_at: string | null;
    times_seen: number;
    application_answers: Array<{
      id: string;
      answer: string | null;
      status: string;
      application_id: string;
    }>;
  }>;

  if (rows.length === 0) {
    return (
      <>
        <PageHeader
          title="Answers"
          description="Every question you have been asked, and your reusable answer to each."
        />
        <EmptyState
          icon={MessageSquareText}
          title="No questions captured yet"
          description="Use the bookmarklet on an application form, or paste the questions onto a role. Greenhouse postings bring their questions along automatically."
          action={{ label: 'Add a role', href: '/jobs/roles/new' }}
          secondaryAction={{ label: 'Get the bookmarklet', href: '/jobs/settings#bookmarklet' }}
        />
      </>
    );
  }

  const filtered = kind ? rows.filter((row) => row.kind === kind) : rows;
  const withCanonical = rows.filter((row) => row.canonical_answer).length;

  return (
    <>
      <PageHeader
        title="Answers"
        description={`${withCanonical} of ${rows.length} questions have a default answer. Each one you set makes the next application shorter.`}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <LeftRail>
          <RailGroup label="Kind">
            <RailItem label="All" href="/jobs/answers" active={!kind} count={rows.length} />
            {KINDS.filter((entry) => rows.some((row) => row.kind === entry)).map((entry) => (
              <RailItem
                key={entry}
                label={entry}
                href={`/jobs/answers?kind=${entry}`}
                active={kind === entry}
                count={rows.filter((row) => row.kind === entry).length}
              />
            ))}
          </RailGroup>
          <p className="px-1 text-small leading-relaxed text-ink-muted">
            Questions are deduped by fingerprint, so the same question asked in different words
            lands on one row.
          </p>
        </LeftRail>

        <div className="min-w-0 flex-1">
          <AnswerBank
            questions={filtered.map((row) => ({
              id: row.id,
              text: row.text,
              kind: row.kind,
              canonicalAnswer: row.canonical_answer,
              timesSeen: row.times_seen,
              usedIn: row.application_answers.length,
              approvedAnswer:
                row.application_answers.find((a) => a.status === 'approved')?.answer ?? null,
            }))}
          />
        </div>
      </div>
    </>
  );
}
