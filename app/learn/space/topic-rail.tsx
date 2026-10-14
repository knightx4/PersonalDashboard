'use client';

import { Card } from '@/components/ui/card';
import { MAX_TOPIC_NAMES, topicPriority, type TopicFrame, type TopicOnMap } from '@/lib/learn/map/topics';
import { countText } from '@/lib/learn/map/view';
import { TopicSwatch } from './swatch';

/**
 * The rail's card for Wikipedia's topics on Idea Space (plan #2016.5): the
 * Level 3 topics your ideas and evidence reach, strongest first, seven at
 * most, as the map names them. The rest are counted, not listed, so no
 * screen names more than about seven topics at one level; the map is where
 * they are found, by zooming in.
 */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${countText(n)} ${n === 1 ? one : many}`;
}

function stateText(topic: TopicOnMap): string {
  const state = topic.state === 'lit' ? `${Math.round(topic.strength * 100)}% known` : 'Unlocked, not known yet';
  return topic.childCount > 0 ? `${state} · ${plural(topic.childCount, 'topic')} inside` : state;
}

export function TopicRail({ frame }: { frame: TopicFrame | null }) {
  if (!frame) return null;
  const touched = frame.topics
    .filter((topic) => topic.level === 3 && topic.touched)
    .sort((a, b) => topicPriority(b) - topicPriority(a) || a.title.localeCompare(b.title));
  const shown = touched.slice(0, MAX_TOPIC_NAMES);
  const rest = touched.length - shown.length;
  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">
        Topics you have reached
        <span className="tabular ml-2 font-normal text-ink-muted">{touched.length}</span>
      </h2>
      {shown.length === 0 ? (
        <p className="mt-1 text-ui text-ink-muted">
          Nothing you have written touches a topic yet. Topics unlock as your notes, courses, work and ideas reach
          them.
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border">
            {shown.map((topic) => (
              <li key={topic.id} className="flex items-start gap-2 py-2">
                <TopicSwatch kind={topic.state === 'lit' ? 'lit' : 'unlocked'} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui text-ink">{topic.title}</span>
                  <span className="block text-small text-ink-muted">{stateText(topic)}</span>
                </span>
                <span className="tabular shrink-0 text-small text-ink-muted">{plural(topic.ideaCount, 'idea')}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && (
            <p className="mt-1 text-small text-ink-muted">
              {plural(rest, 'more is', 'more are')} on the map. Zoom in to find them.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
