'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { finishSection, goDeeper } from '../../actions';

/** Mark this section read and go on. */
export function Finish({ sourceId, n, label }: { sourceId: string; n: number; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="lg"
      pending={pending}
      className="h-auto py-3 whitespace-normal"
      onClick={() => start(() => finishSection(sourceId, n))}
    >
      {label}
    </Button>
  );
}

const ASKS = [
  'This argument again, slower, with another example',
  'The strongest case against it',
  'The background I would need to follow it',
  'A video on this',
];

/**
 * More on this section. A press on one of the four, or a line in the person's
 * own words, queues one run for that request alone; it arrives as a source of
 * its own.
 */
export function Deeper({ sourceId, n }: { sourceId: string; n: number }) {
  const [pending, start] = useTransition();
  const ask = (formData: FormData) => start(() => goDeeper(sourceId, n, formData));
  return (
    <form action={ask} className="flex flex-col gap-2">
      <div className="flex flex-col items-start gap-2">
        {ASKS.map((label) => (
          <Button
            key={label}
            type="submit"
            name="ask"
            value={label}
            variant="secondary"
            disabled={pending}
            className="h-auto min-h-11 py-2 text-left whitespace-normal"
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="read-deeper"
          name="own"
          aria-label="What you want more of"
          placeholder="Or say what you want more of"
          className="min-h-11 min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" pending={pending} className="shrink-0">
          Ask for it
        </Button>
      </div>
      <p className="text-small text-ink-muted">
        This starts one run for this request. It arrives under You asked for in a few minutes.
      </p>
    </form>
  );
}
