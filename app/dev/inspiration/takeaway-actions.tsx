'use client';

import { Sparkles } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import {
  craftTakeaway,
  dismissTakeaway,
  restoreTakeaway,
  type InspirationActionState,
} from './actions';

/**
 * The buttons under a takeaway (plan #1413). An open one can be crafted into
 * a plan or dismissed; a dismissed one can be brought back. A crafted or
 * covered one has nothing to press, since its row already says where it went.
 *
 * A crafted row still draws this, with no buttons, so what the press said
 * survives the refresh that turns the row crafted: the row stays in the same
 * place in the tree and keeps its state. That is how "Filed as an idea, but
 * not sent" stays on screen when the routine would not start.
 *
 * Crafting a takeaway shown under two videos is one press for both: the row
 * is the same, so once it is crafted the button is gone under each.
 */
export function TakeawayActions({ id, status }: { id: string; status: 'open' | 'crafted' | 'dismissed' }) {
  const dismissed = status === 'dismissed';
  const [crafted, craft, crafting] = useActionState(craftTakeaway, {} as InspirationActionState);
  const [aside, setAside, setting] = useActionState(
    dismissed ? restoreTakeaway : dismissTakeaway,
    {} as InspirationActionState,
  );
  const error = crafted.error ?? aside.error;
  if (status === 'crafted' && !crafted.message && !crafted.error) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {status === 'open' && (
        <form action={craft}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="secondary" pending={crafting} disabled={setting}>
            <Sparkles className="size-3.5" aria-hidden />
            {crafting ? 'Sending…' : 'Craft into a plan'}
          </Button>
        </form>
      )}
      {status !== 'crafted' && (
        <form action={setAside}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="ghost" pending={setting} disabled={crafting}>
            {dismissed ? 'Bring back' : 'Dismiss'}
          </Button>
        </form>
      )}
      {crafted.message && <span className="text-small text-ink-muted">{crafted.message}</span>}
      <FieldError>{error}</FieldError>
    </div>
  );
}
