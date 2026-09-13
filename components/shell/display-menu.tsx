'use client';

import Link from 'next/link';
import { useActionState, useId, useRef, useState } from 'react';
import { Check, Pin, SlidersHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import { Input } from '@/components/ui/field';
import {
  defaultSavedView,
  deleteSavedView,
  renameSavedView,
  saveCurrentView,
  type ViewState,
} from '@/lib/saved-views/actions';
import type {
  DisplayChoice,
  DisplayToggle,
  DisplayView,
  ListDisplayMenu,
} from '@/lib/list-display';

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

          <Views menu={menu} />
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


/**
 * Arrangements saved under a name, and the line that saves this one.
 *
 * A view is already a URL; what it is not is findable again. The list it
 * belongs to is its pathname, so an orders view never turns up on the roles
 * table -- the parameters in it name sorts and columns that list does not
 * have.
 */
function Views({ menu }: { menu: ListDisplayMenu }) {
  const [state, save] = useActionState<ViewState, FormData>(saveCurrentView, {});

  return (
    <Section title="Views">
      {menu.views.map((view) => (
        <ViewRow key={view.id} view={view} list={menu.pathname} />
      ))}

      <form action={save} className="flex items-center gap-1.5 pt-1">
        <input type="hidden" name="list" value={menu.pathname} />
        <input type="hidden" name="query" value={menu.query} />
        <Input
          name="name"
          required
          maxLength={60}
          placeholder="Save this as…"
          aria-label="Name for this view"
          className="h-7 text-small"
        />
        <button
          type="submit"
          className="shrink-0 rounded px-1.5 py-1 text-small text-ink-muted hover:bg-sunken hover:text-ink"
        >
          Save
        </button>
      </form>
      {state.error && <p className="text-small text-danger">{state.error}</p>}
    </Section>
  );
}

function ViewRow({ view, list }: { view: DisplayView; list: string }) {
  const [renaming, setRenaming] = useState(false);
  const [renameState, rename] = useActionState<ViewState, FormData>(renameSavedView, {});
  const [, remove] = useActionState<ViewState, FormData>(deleteSavedView, {});
  const [, makeDefault] = useActionState<ViewState, FormData>(defaultSavedView, {});

  if (renaming) {
    return (
      <form
        action={rename}
        onSubmit={() => setRenaming(false)}
        className="flex items-center gap-1.5 py-0.5"
      >
        <input type="hidden" name="list" value={list} />
        <input type="hidden" name="id" value={view.id} />
        <Input
          name="name"
          defaultValue={view.name}
          required
          maxLength={60}
          aria-label={`Rename ${view.name}`}
          className="h-7 text-small"
          autoFocus
        />
        <button
          type="submit"
          className="shrink-0 rounded px-1.5 py-1 text-small text-ink-muted hover:bg-sunken hover:text-ink"
        >
          Rename
        </button>
        {renameState.error && <span className="text-small text-danger">{renameState.error}</span>}
      </form>
    );
  }

  return (
    <div className="group/view flex items-center gap-1">
      <Link
        href={view.href}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-ui hover:bg-sunken',
          view.inForce ? 'text-ink' : 'text-ink-muted',
        )}
        aria-current={view.inForce ? 'true' : undefined}
      >
        <Check
          className={cn('size-3.5 shrink-0', view.inForce ? 'text-accent' : 'opacity-0')}
          strokeWidth={2.5}
          aria-hidden
        />
        <span className="truncate">{view.name}</span>
        {view.isDefault && <span className="shrink-0 text-small text-ink-muted">opens here</span>}
      </Link>

      {/* The three things you can do to a saved view. Shown on hover and on
        * focus, never only on hover: keyboard users get to them by tabbing. */}
      <form action={makeDefault} className="shrink-0">
        <input type="hidden" name="list" value={list} />
        <input type="hidden" name="id" value={view.id} />
        {view.isDefault && <input type="hidden" name="clear" value="1" />}
        <button
          type="submit"
          aria-label={view.isDefault ? `Stop opening on ${view.name}` : `Open ${list} on ${view.name}`}
          className={cn(
            'rounded p-1 text-ink-muted opacity-0 hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover/view:opacity-100',
            view.isDefault && 'text-accent opacity-100',
          )}
        >
          <Pin className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </form>

      <form action={remove} className="shrink-0">
        <input type="hidden" name="list" value={list} />
        <input type="hidden" name="id" value={view.id} />
        <button
          type="submit"
          aria-label={`Delete ${view.name}`}
          className="rounded p-1 text-ink-muted opacity-0 hover:bg-sunken hover:text-danger focus-visible:opacity-100 group-hover/view:opacity-100"
        >
          <Trash2 className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </form>

      <button
        type="button"
        onClick={() => setRenaming(true)}
        className="shrink-0 rounded px-1.5 py-1 text-small text-ink-muted opacity-0 hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover/view:opacity-100"
      >
        Rename
      </button>
    </div>
  );
}
