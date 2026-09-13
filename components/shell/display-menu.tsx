'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import type { DisplayChoice, DisplayToggle, ListDisplayMenu } from '@/lib/list-display';

/**
 * The Display button and its panel: how a list is sorted, how it is grouped,
 * and which properties it is still drawing.
 *
 * One control for every long list, because four lists were about to grow four
 * of them. Inventory has two chip selects above its rows and nothing else has
 * any; the rail below them stays what it is, which is what narrows the list.
 * This is what arranges the rows that are already there -- the split #329
 * settled.
 *
 * Every choice is an `<a href>` built by `listDisplayMenu`, not a form post and
 * not a click handler, so middle-click opens the arrangement in a tab, the
 * back button undoes it, and the URL is the whole of the state. The panel
 * stays open after a choice: turning three properties off is one visit, and
 * the rows behind it are re-rendered by the navigation either way.
 *
 * Opening it needs JavaScript, which the choices themselves do not. That is
 * the same trade the filter rail's phone sheet makes, and the reason is the
 * keyboard half: `usePopover` is what returns focus to the button on Escape,
 * and `<details>` would hand back an open panel with focus left behind it.
 */
export function DisplayMenu({
  menu,
  label = 'Display',
  align = 'end',
  className,
}: {
  menu: ListDisplayMenu;
  /** The button's word. Overridable for a page where "Display" means something else. */
  label?: string;
  /**
   * Which edge of the button the panel hangs from. `end` is right, which is
   * where the button sits at the end of a toolbar; a button at the left of one
   * passes `start` so the panel does not reach back past the page's gutter.
   */
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'gap-1.5')}
      >
        <SlidersHorizontal className="size-3.5" strokeWidth={2} aria-hidden />
        {label}
        {/* A property turned off leaves nothing behind on the rows to say so,
          * so the count is on the button rather than only inside the panel. */}
        {menu.hiddenCount > 0 && (
          <span className="text-ink-muted">{menu.hiddenCount} hidden</span>
        )}
      </button>

      {open && (
        <Popover
          ref={panelRef}
          id={panelId}
          anchor={align === 'end' ? 'trigger-below-end' : 'trigger-below'}
          padding="panel"
          tabIndex={-1}
          aria-label="Display options"
          className="w-64 space-y-4"
        >
          {/* Empty on a list whose order is not the reader's to set -- a
            * search ranked by relevance, say. An empty heading would offer a
            * choice that is not there. */}
          {menu.sorts.length > 0 && (
            <Section title="Sort">
              {menu.sorts.map((sort) => (
                <ChoiceRow key={sort.id} choice={sort} />
              ))}
            </Section>
          )}

          {menu.groups.length > 0 && (
            <Section title="Group">
              {menu.groups.map((group) => (
                <ChoiceRow key={group.id} choice={group} />
              ))}
            </Section>
          )}

          {menu.properties.length > 0 && (
            <Section title="Properties">
              {menu.properties.map((property) => (
                <PropertyRow key={property.id} property={property} />
              ))}
            </Section>
          )}
        </Popover>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="px-2 pb-1 text-micro font-semibold uppercase tracking-wider text-ink-muted"
      >
        {title}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

const ROW = 'press flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-ui';

/**
 * One sort or grouping. The chosen one carries `aria-current` and a tick as
 * well as the tint, because a tint is not a fact anybody can hear and is not
 * one everybody can see either.
 */
function ChoiceRow({ choice }: { choice: DisplayChoice }) {
  return (
    <Link
      href={choice.href}
      aria-current={choice.chosen ? 'true' : undefined}
      className={cn(
        ROW,
        choice.chosen ? 'bg-accent-tint text-accent' : 'text-ink hover:bg-sunken',
      )}
    >
      <span className="truncate">{choice.label}</span>
      {choice.chosen && <Check className="size-4 shrink-0" strokeWidth={2} aria-hidden />}
    </Link>
  );
}

/**
 * One property switch. Its state is the word beside it rather than a colour,
 * so the link reads as "Inbox address, Hidden" to a screen reader and follows
 * the same link-per-choice rule as the rest of the panel.
 */
function PropertyRow({ property }: { property: DisplayToggle }) {
  return (
    <Link href={property.href} className={cn(ROW, 'text-ink hover:bg-sunken')}>
      <span className={cn('truncate', property.hidden && 'text-ink-muted')}>{property.label}</span>
      <span
        className={cn(
          'shrink-0 text-small',
          property.hidden ? 'text-ink-ghost' : 'text-ink-muted',
        )}
      >
        {property.hidden ? 'Hidden' : 'Shown'}
      </span>
    </Link>
  );
}
