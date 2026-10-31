import { PageColumn } from '@/components/shell/page-width';
import { requireUser } from '@/lib/auth/server';
import { LearnSession } from './session';
import type { SessionMode } from '@/lib/learn/next/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn' };

/**
 * Writing the next item (a lesson, a check, a practice task) is one model
 * call of up to a minute, and the page's actions inherit this ceiling.
 */
export const maxDuration = 300;

/**
 * A learning session (plan #2546.3): one lesson, check, practice task,
 * review or level question at a time, each the one the chooser picks
 * (lib/learn/next/choose.ts), and Next goes on to the next without leaving
 * the page. The session is the page's own state; nothing about it is stored
 * but what each item writes. A new visit is a new session, keyed on when it
 * began, so Start again begins one afresh. `?only=lessons` is Quick learn
 * on Now: lessons only, with no question, check or review between them.
 */
export default async function LearnGoPage({ searchParams }: { searchParams: Promise<{ only?: string | string[] }> }) {
  await requireUser();
  const { only } = await searchParams;
  const mode: SessionMode = only === 'lessons' ? 'lessons' : 'all';
  const startedAt = new Date().toISOString();
  return (
    <PageColumn>
      <h1 className="sr-only">Learn</h1>
      {/* One item read at a time: a reading measure, as Practice's question has on Now. */}
      <div className="mx-auto max-w-prose">
        <LearnSession key={startedAt} startedAt={startedAt} mode={mode} />
      </div>
    </PageColumn>
  );
}
