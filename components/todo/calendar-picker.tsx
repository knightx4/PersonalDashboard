'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { Check, CalendarRange } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import { toggleCalendar, type CalendarPickerState } from '@/app/todo/calendar/actions';

/** One subscription, as the panel needs it: never its address. */
export interface CalendarChoice {
  id: string;
  name: string;
  shown: boolean;
}

/**
 * The Calendars button: which of your subscriptions the page is drawing.
 *
 * A calendar you subscribe to had one switch before this -- added, or deleted
 * -- so quietening a work calendar for a fortnight meant throwing away the
 * address and pasting it back afterwards. Nobody does that, so the
 * appointments simply stayed.
 *
 * The choice is stored rather than carried in the URL, which is the one place
 * this page keeps state anywhere but the address bar. That is deliberate: a
 * calendar you switched off yesterday is still off today, and the alternative
 * -- every link on the page carrying the list of what is hidden -- forgets the
 * moment you arrive from anywhere else.
 *
 * Drawn only when there is a subscription to draw: a menu of nothing is a
 * control that teaches you not to open it. The events you typed are not in
 * here either, because they are not a calendar you can switch off -- they are
 * this one.
 *
 * Opening it needs JavaScript; the writes inside are server actions, and the
 * rows are ordinary submit buttons. The same trade the Display menu makes, and
 * for the same reason: `usePopover` is what returns focus to the button on
 * Escape.
 */
export function CalendarPicker({ calendars }: { calendars: CalendarChoice[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  if (calendars.length === 0) return null;

  const hidden = calendars.filter((calendar) => !calendar.shown).length;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'gap-1.5')}
      >
        <CalendarRange className="size-3.5" strokeWidth={2} aria-hidden />
        Calendars
        {/* A calendar switched off leaves nothing behind on the grid to say
            so -- an emptier month looks exactly like a quieter one. */}
        {hidden > 0 && <span className="text-ink-muted">{hidden} hidden</span>}
      </button>

      {open && (
        <Popover
          ref={panelRef}
          id={panelId}
          anchor="trigger-below"
          padding="panel"
          tabIndex={-1}
          aria-label="Calendars"
          className="w-64 space-y-1"
        >
          <h2 className="px-2 pb-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Subscribed
          </h2>

          <div className="space-y-0.5">
            {calendars.map((calendar) => (
              <CalendarRow key={calendar.id} calendar={calendar} />
            ))}
          </div>

          <p className="border-t border-border px-2 pt-2 text-small text-ink-muted">
            Your own events and tasks always show.{' '}
            <Link href="/todo/settings" className="font-medium text-accent hover:underline">
              Subscriptions
            </Link>
          </p>
        </Popover>
      )}
    </div>
  );
}

/**
 * One calendar, and the switch that draws it.
 *
 * Its state is the word beside it as well as the tick, the way the Display
 * menu writes the same thing: a tint is not a fact anybody can hear, and not
 * one everybody can see either.
 */
function CalendarRow({ calendar }: { calendar: CalendarChoice }) {
  const [state, action, pending] = useActionState<CalendarPickerState, FormData>(
    toggleCalendar,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="id" value={calendar.id} />
      <input type="hidden" name="shown" value={calendar.shown ? '' : 'on'} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={calendar.shown}
        className={cn(
          'press flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-ui',
          calendar.shown ? 'text-ink' : 'text-ink-muted',
          'hover:bg-sunken disabled:opacity-60',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Check
            className={cn('size-4 shrink-0', calendar.shown ? 'text-accent' : 'opacity-0')}
            strokeWidth={2.5}
            aria-hidden
          />
          <span className="truncate">{calendar.name}</span>
        </span>
        <span className="shrink-0 text-small text-ink-ghost">
          {calendar.shown ? 'Shown' : 'Hidden'}
        </span>
      </button>
      {state.error && <p className="px-2 text-small text-danger">{state.error}</p>}
    </form>
  );
}
