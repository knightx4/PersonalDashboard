'use client';

import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startEssay } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" pending={pending}>
      <Plus className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Starting…' : 'New essay'}
    </Button>
  );
}

/** Starts an empty essay and opens it in the editor (plan #1865). */
export function NewEssayButton() {
  return (
    <form action={startEssay}>
      <Submit />
    </form>
  );
}
