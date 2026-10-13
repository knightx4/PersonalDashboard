'use client';

import { useFormStatus } from 'react-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

/** The toggle's button, which says so while the mark is being saved. */
export function WatchedButton({ watched }: { watched: boolean }) {
  const { pending } = useFormStatus();
  const button = (
    <Button
      type="submit"
      size="sm"
      variant={watched ? 'secondary' : 'ghost'}
      aria-pressed={watched}
      pending={pending}
    >
      {watched && !pending && <Check className="size-3.5" strokeWidth={1.75} aria-hidden />}
      {pending ? 'Saving…' : watched ? 'Watched' : 'Mark watched'}
    </Button>
  );
  // "Watched" reads as a state; the tip says pressing it takes the mark off.
  return watched ? <Tooltip label="Take the Watched mark off">{button}</Tooltip> : button;
}
