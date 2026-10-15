import { Layers } from 'lucide-react';
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
  comments,
  timezone,
  now,
  form,
}: {
  topics: readonly TopicRow[];
  /** Comment counts by topic id; a topic with none is absent. */
  comments: ReadonlyMap<string, number>;
  timezone: string;
  now: number;
  /** For the gallery: the form mid-draft or with an error. */
  form?: ComposeShown;
}) {
  const header = <TopicsHeader shown={form} />;

  if (topics.length === 0) {
    return (
      <PageColumn>
        {header}
        <EmptyState
          icon={Layers}
          title="No topics yet"
          description="Press New topic and name something you want to know. Dash drafts its ten levels, from placing it to arguing its disputes, and nothing is asked about it until you have read them and approved it."
        />
      </PageColumn>
    );
  }

  const drafts = topics.filter((t) => t.status === 'draft').length;
  const count = `${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}${
    drafts > 0 ? `, ${drafts} waiting for you to approve` : ''
  }`;

  return (
    <ListPage header={header} foot={count}>
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
