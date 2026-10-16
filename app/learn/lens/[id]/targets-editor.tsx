'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { ladderLevel } from '@/lib/learn/levels/ladder';
import type { LensTopicView } from '@/lib/learn/levels/lenses';
import { saveLensTargets, type TargetsState } from './actions';

/**
 * The target editor on a lens (plan #2138.7): one level picker a topic, from
 * 1 to the topic's ceiling, opened by Edit targets. A topic is one row: its
 * name and where you are on the left, the picker on the right, each choice
 * naming the level's band. Save and Cancel sit beside the heading, so they
 * are in reach without scrolling past every topic. Saving goes back to the
 * lens with the bars redrawn; Cancel goes back without saving.
 */

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" pending={pending}>
      {pending ? 'Saving…' : 'Save targets'}
    </Button>
  );
}

export function TargetsEditor({ lensId, topics }: { lensId: string; topics: readonly LensTopicView[] }) {
  const [state, save] = useActionState<TargetsState, FormData>(saveLensTargets, {});

  return (
    <form action={save} aria-labelledby="targets-heading">
      <input type="hidden" name="lensId" value={lensId} />
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 id="targets-heading" className="text-ui font-semibold text-ink">
          Targets
        </h2>
        <div className="flex items-center gap-1">
          <Link href={`/learn/lens/${lensId}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
          <SaveButton />
        </div>
      </div>
      {state.error && (
        <p role="alert" className="mb-2 px-1 text-small text-danger">
          {state.error}
        </p>
      )}
      <Card padding="none">
        <ul className="divide-y divide-border">
          {topics.map((topic) => {
            const fieldId = `target-${topic.topicId}`;
            return (
              <li key={topic.topicId} className="card-pad-x row-pad flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={fieldId} className="block text-ui text-ink">
                    {topic.name}
                  </label>
                  <p className="text-small text-ink-muted">
                    {topic.approved ? (topic.level === 0 ? 'Not placed yet' : `At level ${topic.level}`) : 'Draft to approve'}
                  </p>
                </div>
                <Select
                  id={fieldId}
                  name={`target:${topic.topicId}`}
                  defaultValue={String(topic.target)}
                  className="min-h-11 w-auto shrink-0"
                >
                  {Array.from({ length: topic.ceiling }, (_, i) => i + 1).map((level) => (
                    <option key={level} value={level}>
                      Level {level} · {ladderLevel(level).band}
                    </option>
                  ))}
                </Select>
              </li>
            );
          })}
        </ul>
      </Card>
    </form>
  );
}
