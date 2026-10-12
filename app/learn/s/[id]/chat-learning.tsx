import Link from 'next/link';
import { cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import type { SubjectLearning } from '@/lib/learn/chat/subject-load';

/**
 * The readings related to a subject and the conversations logged about it
 * (plan #1814). Readings come from any list, through learn.reading_subjects;
 * a conversation is what a chat recorded with log_learning. Neither says what
 * the person knows, which is why this sits apart from the graph above it.
 */

const STATUS_LABEL = { queued: 'To read', reading: 'Reading', read: 'Read', abandoned: 'Set aside' } as const;

export function ChatLearningSection({ learning, timezone }: { learning: SubjectLearning; timezone: string }) {
  const { readings, sessions } = learning;
  if (readings.length === 0 && sessions.length === 0) return null;

  const open = readings.filter((row) => row.status === 'queued' || row.status === 'reading').length;
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: timezone });

  return (
    <>
      {readings.length > 0 && (
        <SectionFold
          title={`Reading · ${open} of ${readings.length} still to read`}
          defaultOpen={open > 0}
          className="mt-6"
        >
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {readings.map((row) => (
              <li key={row.id} className="card-pad">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Link href={`/learn/r/${row.id}`} className="text-body text-ink hover:text-accent">
                    {row.title}
                  </Link>
                  <span className="text-small text-ink-muted">
                    {row.pending ? 'Finding where to read it' : STATUS_LABEL[row.status]}
                  </span>
                </div>
                {row.why && <p className="mt-1 text-ui text-ink-muted">{row.why}</p>}
              </li>
            ))}
          </ul>
        </SectionFold>
      )}

      {sessions.length > 0 && (
        <SectionFold title={`Conversations · ${sessions.length}`} defaultOpen={false} className="mt-6">
          <p className="mb-2 text-ui text-ink-muted">
            What your chats covered. Their ideas are in the graph untested until you answer on them.
          </p>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {sessions.map((row) => (
              <li key={row.id} className="card-pad">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-body font-semibold text-ink">{row.topic}</h3>
                  <span className="text-small text-ink-muted">{day.format(new Date(row.createdAt))}</span>
                </div>
                <p className="mt-1 text-ui text-ink">{row.summary}</p>
                {row.ideas.length > 0 && <p className="mt-1 text-ui text-ink-muted">{row.ideas.join(' · ')}</p>}
              </li>
            ))}
          </ul>
        </SectionFold>
      )}
    </>
  );
}
