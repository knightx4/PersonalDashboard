import { ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from '@/components/ui/link';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { HOLD_FORWARD } from '@/components/learn/cell-answer-view';
import { cn } from '@/lib/cn';
import type { PlacedTopic } from '@/lib/learn/levels/placement';

/**
 * The end of a placement before a subject's first lesson (plan #2292.2): the
 * topics you answered on and the level each now stands at, the pieces you
 * already hold everything of, which are shown short and asked a level higher
 * rather than skipped (plan #2292.5), and the lesson the subject starts on.
 * The deck's last item, as a run's end is.
 */

export type PlacementLesson = { title: string; href: string };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The sentence at the top of the end. */
export function placementHeadline(topics: number, held: number): string {
  if (topics === 0) return 'No questions answered, so every lesson is shown in full.';
  const shown = `You answered on ${plural(topics, 'topic', 'topics')}`;
  return held === 0
    ? `${shown}. Nothing is held yet, so every lesson is shown in full.`
    : `${shown}. You already hold ${plural(held, 'piece', 'pieces')}, so ${held === 1 ? 'it is' : 'they are'} shown short and asked a level higher.`;
}

function levelLine(level: number): string {
  return level === 0 ? 'Starting from level 1' : `Holds level ${level}`;
}

export function PlacementEndView({
  topics,
  held,
  lesson,
  subjectHref,
}: {
  topics: PlacedTopic[];
  /** Titles of the pieces this placement found held, in teaching order. */
  held: string[];
  /** The first piece not passed; null when every laid-out piece is passed or none is laid out yet. */
  lesson: PlacementLesson | null;
  /** The subject's page, where the forward action goes when there is no lesson to open. */
  subjectHref: string;
}) {
  return (
    <div data-deck-item className={cn('pb-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:pb-0', HOLD_FORWARD)}>
      <Card padding="standard">
        <p className="text-small text-ink-muted">End of the placement</p>
        <p className="mt-1 text-body font-semibold text-ink">{placementHeadline(topics.length, held.length)}</p>
      </Card>
      {(topics.length > 0 || held.length > 0 || lesson) && (
        <Card padding="none" className="mt-3 overflow-hidden">
          <ul className="divide-y divide-border">
            {topics.length > 0 && (
              <li className="px-4 py-3">
                <p className="text-ui font-medium text-ink">Where you start</p>
                <ul className="mt-2 space-y-1.5">
                  {topics.map((t) => (
                    <li
                      key={t.topicId}
                      className="flex flex-col gap-0.5 text-ui sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                    >
                      <span className="min-w-0 text-ink">{t.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-small text-ink-muted">
                        <StatusGlyph glyph={t.level > 0 ? 'full' : 'empty'} size={12} className="text-ink" />
                        {levelLine(t.level)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            )}
            {held.length > 0 && (
              <li className="px-4 py-3">
                <p className="text-ui font-medium text-ink">
                  Shown short and asked harder{' '}
                  <span className="font-normal text-ink-muted">· {held.length}</span>
                </p>
                <ul className="mt-2 space-y-1">
                  {held.map((title) => (
                    <li key={title} className="text-ui text-ink">
                      {title}
                    </li>
                  ))}
                </ul>
              </li>
            )}
            {lesson && (
              <li className="px-4 py-3">
                <p className="text-ui font-medium text-ink">The lessons start with</p>
                <p className="mt-1 text-ui text-ink">{lesson.title}</p>
              </li>
            )}
          </ul>
        </Card>
      )}
      <div className="flex-1" aria-hidden />
      <Card
        padding="none"
        className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link mt-3 flex items-center justify-end gap-2 px-3 py-2 lg:static"
      >
        <Link href={lesson?.href ?? subjectHref} className={buttonVariants({ size: 'lg' })}>
          {lesson ? 'Start the lesson' : 'Open the subject'}
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </Link>
      </Card>
    </div>
  );
}
