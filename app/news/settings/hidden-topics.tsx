'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import type { NewsTopic } from '@/lib/news/issues/topics';
import { showHiddenTopic } from './actions';

/**
 * The topics hidden from Quick read with Fewer like this (plan #861), each
 * with the button that brings it back. The newsletter list never hid them, so
 * only Quick read changes when one comes back.
 */
export function HiddenTopicList({ topics }: { topics: readonly NewsTopic[] }) {
  return (
    <ul className="divide-y divide-border">
      {topics.map((topic) => (
        <li key={topic} className="flex items-center justify-between gap-3 py-2">
          <span className="text-body text-ink">{topic}</span>
          <form action={showHiddenTopic}>
            <input type="hidden" name="topic" value={topic} />
            <ShowButton topic={topic} />
          </form>
        </li>
      ))}
    </ul>
  );
}

function ShowButton({ topic }: { topic: NewsTopic }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="secondary"
      size="sm"
      pending={pending}
      aria-label={`Show ${topic} in Quick read again`}
    >
      {pending ? 'Bringing back…' : 'Show again'}
    </Button>
  );
}
