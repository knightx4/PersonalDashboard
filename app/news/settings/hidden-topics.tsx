'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { NewsTopic } from '@/lib/news/issues/topics';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { setTopicShown } from './actions';

/**
 * Every topic, each pressed while Quick read shows it (note ee75aef9). Press
 * one to hide it from Quick read's cards and chips, press it again to bring it
 * back. The newsletter list never hid them, so only Quick read changes.
 * Optimistic: the chip changes at once and a refused write puts it back with
 * a toast.
 */
export function TopicPicker({
  topics,
  hidden,
}: {
  topics: readonly NewsTopic[];
  hidden: readonly NewsTopic[];
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Topics shown in Quick read">
      {topics.map((topic) => (
        <TopicChip key={topic} topic={topic} shown={!hidden.includes(topic)} />
      ))}
    </div>
  );
}

function TopicChip({ topic, shown }: { topic: NewsTopic; shown: boolean }) {
  const { shown: on, run, failed } = useOptimisticWrite<boolean, boolean>({
    value: shown,
    apply: (_current, next) => next,
    write: (next) => setTopicShown(topic, next),
  });
  return (
    <Button
      type="button"
      variant={on ? 'secondary' : 'ghost'}
      size="sm"
      aria-pressed={on}
      title={on ? `Hide ${topic} from Quick read` : `Show ${topic} in Quick read`}
      onClick={() => run(!on)}
      className={cn(!on && 'line-through', failed && 'text-danger')}
    >
      {on && <Check className="size-3.5" strokeWidth={2} aria-hidden />}
      {topic}
    </Button>
  );
}
