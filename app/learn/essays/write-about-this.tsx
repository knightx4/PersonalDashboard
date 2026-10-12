'use client';

import { useFormStatus } from 'react-dom';
import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PinKind } from '@/lib/learn/essays/model';
import { startEssayFrom } from './actions';

function Submit({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" pending={pending} aria-label={`Write an essay about ${title}`}>
      <PenLine className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Starting…' : 'Write about this'}
    </Button>
  );
}

/**
 * "Write about this" (plan #1867; spec, "Starting an essay"): a new essay
 * with this pinned to its brief, opened on an interview that names it.
 */
export function WriteAboutThis({
  kind,
  refId,
  title,
  className,
}: {
  kind: PinKind;
  refId: string;
  title: string;
  className?: string;
}) {
  return (
    <form action={startEssayFrom} className={className}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="ref" value={refId} />
      <input type="hidden" name="title" value={title} />
      <Submit title={title} />
    </form>
  );
}
