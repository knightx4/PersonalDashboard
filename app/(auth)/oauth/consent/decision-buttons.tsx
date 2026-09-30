'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/** Allow and Refuse, held while Supabase answers so neither is pressed twice. */
export function DecisionButtons() {
  const { pending } = useFormStatus();
  return (
    <>
      <Button type="submit" name="decision" value="allow" className="flex-1" disabled={pending}>
        {pending ? 'One moment…' : 'Allow'}
      </Button>
      <Button
        type="submit"
        name="decision"
        value="refuse"
        variant="secondary"
        className="flex-1"
        disabled={pending}
      >
        Refuse
      </Button>
    </>
  );
}
