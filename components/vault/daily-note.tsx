'use client';

import { useActionState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { openDailyNote, type DailyNoteState } from '@/app/vault/actions';

/**
 * Today, in the vault page's header (note a268529a): opens the note named
 * for today's date, writing it first when there is none yet.
 */
export function DailyNoteButton() {
  const [state, action, pending] = useActionState<DailyNoteState, FormData>(() => openDailyNote(), {
    error: null,
  });

  return (
    <form action={action} className="flex items-center gap-2">
      <FieldError>{state.error}</FieldError>
      <Button type="submit" variant="secondary" size="sm" pending={pending}>
        <CalendarDays strokeWidth={1.75} aria-hidden />
        Today
      </Button>
    </form>
  );
}
