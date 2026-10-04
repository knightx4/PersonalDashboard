import { MessageSquareText } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { AnswerBank } from './bank';

/** The kinds a question is filed under, in the order the rail lists them. */
export const KINDS = [
  'motivation',
  'fit',
  'behavioral',
  'technical',
  'logistics',
  'demographic',
  'other',
] as const;

export type AnswerKind = (typeof KINDS)[number];

/** One captured question, with how it has been answered so far. */
export type AnswerRow = {
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
};

/**
 * The question bank as it draws, from the questions its page read (plan
 * #1601), filtered to `kind` when one is picked. The gallery draws it from
 * fixtures.
 */
export function AnswersView({ rows, kind }: { rows: AnswerRow[]; kind: AnswerKind | undefined }) {
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
