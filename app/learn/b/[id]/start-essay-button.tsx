'use client';

import { useState, useTransition } from 'react';
import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startEssayOnBrief } from './actions';

/**
 * Start an essay, on a brief's page (plan #2023.5): opens an essay on the
 * brief's question with the brief pinned beside the draft. Pressing it again
 * opens the same essay. It records no spend, so it carries no cost hint.
 */
export function StartEssayButton({ briefId }: { briefId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="md"
        pending={pending}
        className="gap-1.5"
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await startEssayOnBrief(briefId);
            if (result?.error) setError(result.error);
          })
        }
      >
        <PenLine className="size-4" strokeWidth={1.75} aria-hidden />
        Start an essay
      </Button>
      {error && (
        <p role="alert" className="basis-full text-small text-danger">
          {error}
        </p>
      )}
    </>
  );
}
