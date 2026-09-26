'use client';

import { useFormStatus } from 'react-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The toggle's button, which says so while the mark is being saved. */
export function WatchedButton({ watched }: { watched: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={watched ? 'secondary' : 'ghost'}
      aria-pressed={watched}
      pending={pending}
      title={watched ? 'Take the Watched mark off' : undefined}
    >
      {watched && !pending && <Check className="size-3.5" strokeWidth={2} aria-hidden />}
      {pending ? 'Saving…' : watched ? 'Watched' : 'Mark watched'}
    </Button>
  );
}
