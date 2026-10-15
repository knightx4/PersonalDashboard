import Link from '@/components/ui/link';
import { ArrowRight, Layers } from 'lucide-react';
import { ListPage, ListRow } from '@/components/patterns/list-detail';
import { PageColumn } from '@/components/shell/page-width';
import { CommentCount } from '@/components/dev/comment-count';
import { EmptyState } from '@/components/ui/empty-state';
import { whenDay } from '@/lib/core/when';
import type { TopicRow } from '@/lib/learn/levels/store';
import { TopicsHeader, type ComposeShown } from './draft-form';

/**
 * Learn's topics (docs/LEARN-LEVELS-SPEC.md; plan #2138.2): the map of what
 * you know, one row a topic, with the drafts waiting on you first.
 *
 * The list-and-detail pattern. The header's one action, New topic, opens a
 * box to name a goal, which drafts a topic and opens it; the rows follow,
 * then the count.
 * Pressing a row opens the topic, where a draft is read, reworded and
 * approved.
 *
 * The page and the gallery both draw this, so it takes the rows and reads
 * nothing itself.
 */
export function TopicsView({
  topics,
  move,
  comments,
  timezone,
  now,
  form,
}: {
  topics: readonly TopicRow[];
  /** Subjects still on the claims graph and answers the move left (plan #2138.4). */
  move?: MoveSummary | null;
  /** Comment counts by topic id; a topic with none is absent. */
  comments: ReadonlyMap<string, number>;
  timezone: string;
  now: number;
  /** For the gallery: the form mid-draft or with an error. */
  form?: ComposeShown;
}) {
  const header = <TopicsHeader shown={form} />;
  const moveLine = move ? <MoveLine move={move} /> : null;

  if (topics.length === 0) {
    return (
      <PageColumn>
        {header}
        <EmptyState
          icon={Layers}
          title="No topics yet"
          description={
            move && move.toMove > 0
              ? 'Your subjects are still on the claims graph. Move them and Dash places each idea on a topic and a level, or press New topic and name something you want to know.'
              : 'Press New topic and name something you want to know. Dash drafts its ten levels, from placing it to arguing its disputes, and nothing is asked about it until you have read them and approved it.'
          }
          action={move && move.toMove > 0 ? { label: 'Move your subjects', href: '/learn/topics/review' } : undefined}
        />
      </PageColumn>
    );
  }

  const drafts = topics.filter((t) => t.status === 'draft').length;
  const count = `${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}${
    drafts > 0 ? `, ${drafts} waiting for you to approve` : ''
  }`;

  return (
    <ListPage header={header} tools={moveLine} foot={count}>
      {topics.map((topic) => (
        <ListRow
          key={topic.id}
          href={`/learn/topics/${topic.id}`}
          title={topic.name}
          meta={rowMeta(topic)}
          end={
            <span className="inline-flex items-center gap-2">
              <CommentCount count={comments.get(topic.id) ?? 0} />
              {whenDay(topic.approvedAt ?? topic.createdAt, { timeZone: timezone, now })}
            </span>
          }
        />
      ))}
    </ListPage>
  );
}

/** One line after the name: whether it waits on you, and how deep it goes. */
function rowMeta(topic: TopicRow): string {
  const depth = topic.ceiling === 1 ? 'one level' : `levels 1 to ${topic.ceiling}`;
  return topic.status === 'draft' ? `Draft to approve · ${depth}` : `${depth} · ${topic.scope}`;
}

export type MoveSummary = { toMove: number; toAnswer: number };

/**
 * One line over the list while the move from the claims graph has anything
 * left: subjects still to move, or placements and edges to answer. Opens the
 * review page. Absent once both are zero.
 */
function MoveLine({ move }: { move: MoveSummary }) {
  if (move.toMove === 0 && move.toAnswer === 0) return null;
  const parts = [
    move.toMove > 0 ? `${move.toMove} to move` : null,
    move.toAnswer > 0 ? `${move.toAnswer} to answer` : null,
  ].filter(Boolean);
  return (
    <Link
      href="/learn/topics/review"
      className="press inline-flex min-h-11 items-center gap-1.5 text-ui text-ink-muted hover:text-ink"
    >
      <span>Claims graph: {parts.join(' · ')}</span>
      <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}
