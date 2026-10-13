'use client';

/* ui-ok-file: undefined-colour -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-chip -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-icon-button -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-label -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-link -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: raw-checkbox -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: raw-kbd -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: pulsing-dot -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: dashed-without-width -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: heavy-stroke -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: fixed-radius -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-box -- this file reproduces the app's hand-written markup on purpose, to draw it beside the proposal. */
/* ui-ok-file: hand-rolled-fold -- as above. */
/* ui-ok-file: fixed-control-height -- as above: view-toggle's h-7 is the drift being shown. */

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, HelpCircle, ListChecks, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, buttonVariants } from '@/components/ui/button';
import { IconActionButton } from '@/components/ui/action-menu';
import { Segmented } from '@/components/ui/segmented';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { cardVariants, CardSection } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { GroupHeader } from '@/components/shell/group-header';
import { popoverSurface } from '@/components/ui/popover';
import { Specimen, Specimens } from './frame';

/**
 * What the app draws today, for /preview/overhaul.
 *
 * Shared components are the real ones, imported. Hand-written copies are
 * their className strings taken verbatim from the file and line named under
 * each drawing, so the drawing is what that page shows. Where a copy has
 * state (a pressed chip), both states are drawn.
 */

export function NowButtons() {
  return (
    <Specimens>
      <Specimen label="Button: primary, secondary, ghost, danger">
        <Button>Save</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="ghost">Skip</Button>
        <Button variant="danger">Delete</Button>
      </Specimen>
      <Specimen label="Text action, muted hover" source="app/jobs/(app)/roles/[id]/mail.tsx:265">
        <button type="button" className="text-small text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-50">
          Not a match
        </button>
      </Specimen>
      <Specimen label="Text action, accent hover" source="app/jobs/(app)/roles/[id]/prep-note.tsx:297">
        <button type="button" className="text-small text-ink-muted underline underline-offset-2 hover:text-accent">
          Regenerate
        </button>
      </Specimen>
      <Specimen label="Text action, underline only on hover" source="app/learn/flow/session.tsx:125">
        <button type="button" className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline">
          I don&rsquo;t know
        </button>
      </Specimen>
      <Specimen label="Small ghost button" source="app/shopping/settings/people-section.tsx:201">
        <button type="button" className="press rounded px-1 py-0.5 text-small text-ink-muted hover:text-ink">
          Keep
        </button>
      </Specimen>
      <Specimen label="Secondary with a pressed state added by hand" source="app/learn/r/[id]/read-now-button.tsx:45">
        <button type="button" className={cn(buttonVariants({ variant: 'secondary' }), 'border-accent bg-accent-tint text-accent')}>
          Reading now
        </button>
        <button type="button" className={buttonVariants({ variant: 'secondary' })}>
          Read now
        </button>
      </Specimen>
    </Specimens>
  );
}

export function NowIconButtons() {
  return (
    <Specimens>
      <Specimen label="IconActionButton, the shared one: size-8, rounded-lg, accent hover" source="components/ui/action-menu.tsx:97">
        <IconActionButton label="Edit">
          <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
        </IconActionButton>
        <IconActionButton label="More" active>
          <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
        </IconActionButton>
      </Specimen>
      <Specimen label="size-8, rounded-lg, sunken hover, 14px icon" source="app/jobs/(app)/roles/[id]/todos.tsx:164">
        <button type="button" aria-label="More" className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink">
          <MoreHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </Specimen>
      <Specimen label="size-8, close, stroke 2" source="components/shell/filter-sheet.tsx:73">
        <button type="button" aria-label="Close" className="press flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink">
          <X className="size-4" strokeWidth={2} aria-hidden />
        </button>
      </Specimen>
      <Specimen label="size-7, rounded-control, ghost ink" source="app/goals/goals-view.tsx:395">
        <button type="button" aria-label="Open" className="press -mr-1 flex size-7 shrink-0 items-center justify-center rounded-control text-ink-ghost transition-colors duration-quick hover:bg-sunken hover:text-ink-muted max-sm:size-11">
          <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </Specimen>
      <Specimen label="size-6, rounded, no hover ground" source="app/jobs/(app)/roles/[id]/interview-round.tsx:144">
        <button type="button" aria-label="Open" className="press flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-accent">
          <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </Specimen>
    </Specimens>
  );
}

export function NowChips() {
  return (
    <Specimens>
      <Specimen label="rounded-full on canvas, small" source="app/jobs/(app)/material/bank.tsx:128">
        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-small text-ink-muted">Behavioural</span>
      </Specimen>
      <Specimen label="rounded-full on canvas, micro" source="app/jobs/(app)/review/list.tsx:345">
        <span className="rounded-full bg-canvas px-2 py-0.5 text-micro font-medium text-ink-muted">Applied</span>
      </Specimen>
      <Specimen label="rounded-pill, which no token defines, so it draws square" source="app/learn/c/[id]/branch-from-claim.tsx:67">
        <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">New</span>
        <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-small text-accent">What you selected</span>
      </Specimen>
      <Specimen label="rounded-md, uppercase" source="components/orders/order-row.tsx:82">
        <span className="shrink-0 rounded-md bg-positive-tint px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-positive">
          Delivered
        </span>
      </Specimen>
      <Specimen label="rounded-full, uppercase, accent" source="app/dev/raised/raised-view.tsx:265">
        <span className="rounded-full bg-accent-tint px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-accent">
          Raised
        </span>
      </Specimen>
      <Specimen label="rounded (4px), sunken, micro" source="components/inventory/inventory-row.tsx:164">
        <span className="rounded bg-sunken px-1.5 py-0.5 text-micro font-semibold text-ink-muted">×3</span>
      </Specimen>
      <Specimen label="Caution, no vertical padding" source="components/plan-tree/tree-row.tsx:544">
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-caution-tint px-1.5 text-small font-semibold text-caution">
          <HelpCircle className="size-3" strokeWidth={2} aria-hidden />2
        </span>
      </Specimen>
      <Specimen label="Caution with padding" source="app/vault/settings/settings-view.tsx:78">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-caution-tint px-2 py-0.5 text-small font-medium text-caution">
          <AlertTriangle className="size-3" strokeWidth={2} aria-hidden />
          Not synced
        </span>
      </Specimen>
    </Specimens>
  );
}

const DAYS = ['Today', 'Tomorrow', 'Friday'] as const;

export function NowToggleChips() {
  const [a, setA] = useState<string>('Today');
  const [b, setB] = useState<string>('Today');
  const [c, setC] = useState<string>('All');
  const [d, setD] = useState<string>('Week');
  return (
    <Specimens>
      <Specimen label="Filled accent with text-surface, where the token for text on accent is fill-ink" source="components/todo/task-form.tsx:303">
        {DAYS.map((day) => (
          <button
            key={day}
            type="button"
            aria-pressed={a === day}
            onClick={() => setA(day)}
            className={cn(
              'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-quick',
              a === day ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
            )}
          >
            {day}
          </button>
        ))}
      </Specimen>
      <Specimen label="The same chip with text-fill-ink" source="components/shell/capture.tsx:1089">
        {DAYS.map((day) => (
          <button
            key={day}
            type="button"
            aria-pressed={b === day}
            onClick={() => setB(day)}
            className={cn(
              'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-quick',
              b === day ? 'bg-accent text-fill-ink' : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
            )}
          >
            {day}
          </button>
        ))}
      </Specimen>
      <Specimen label="Filter row: rounded-lg, accent tint, ui size" source="app/todo/all/all-view.tsx:81">
        {['All', 'Open', 'Done'].map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setC(filter)}
            className={cn(
              'press-area rounded-lg px-3 py-1.5 text-ui font-medium transition-colors duration-quick',
              c === filter ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {filter}
          </button>
        ))}
      </Specimen>
      <Specimen label="Grouping row: pill, filled accent" source="app/dev/changelog/changelog-view.tsx:95">
        {['Day', 'Week', 'Feature'].map((group) => (
          <button
            key={group}
            type="button"
            onClick={() => setD(group)}
            className={cn(
              'press press-area rounded-full px-2.5 py-1 text-small font-medium transition-colors',
              d === group ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {group}
          </button>
        ))}
      </Specimen>
    </Specimens>
  );
}

export function NowSegmented() {
  const [value, setValue] = useState<'list' | 'board' | 'table'>('list');
  const [copy, setCopy] = useState('Focus');
  return (
    <Specimens>
      <Specimen label="Segmented, the shared one" source="components/ui/segmented.tsx">
        <Segmented
          label="View"
          value={value}
          onChange={setValue}
          options={[
            { value: 'list', label: 'List' },
            { value: 'board', label: 'Board' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </Specimen>
      <Specimen label="A copy for links, at h-7 instead of the density dial" source="components/jobs/pipeline/view-toggle.tsx:42">
        <span className="inline-flex overflow-hidden rounded-control border border-control">
          {['Focus', 'Board', 'Table'].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCopy(option)}
              className={cn(
                'press inline-flex h-7 items-center gap-1.5 px-2.5 text-ui font-medium',
                'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
                copy === option ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
              )}
            >
              {option}
            </button>
          ))}
        </span>
      </Specimen>
    </Specimens>
  );
}

export function NowLinks() {
  return (
    <Specimens>
      <Specimen label="text-accent hover:underline (29 places)">
        <p className="text-ui text-ink">
          Read the <a href="#links" className="text-accent hover:underline">posting</a> first.
        </p>
      </Specimen>
      <Specimen label="font-medium text-accent hover:underline (13)">
        <p className="text-ui text-ink">
          Read the <a href="#links" className="font-medium text-accent hover:underline">posting</a> first.
        </p>
      </Specimen>
      <Specimen label="text-accent underline underline-offset-2 (6)">
        <p className="text-ui text-ink">
          Read the <a href="#links" className="text-accent underline underline-offset-2">posting</a> first.
        </p>
      </Specimen>
      <Specimen label="underline, ink colour (11)">
        <p className="text-ui text-ink">
          Read the <a href="#links" className="underline">posting</a> first.
        </p>
      </Specimen>
      <Specimen label="underline-offset-2 hover:underline (10)">
        <p className="text-ui text-ink">
          Read the <a href="#links" className="underline-offset-2 hover:underline">posting</a> first.
        </p>
      </Specimen>
    </Specimens>
  );
}

export function NowCheckboxes() {
  return (
    <Specimens>
      <Specimen label="Written for a forms plugin that is not installed, so the classes do nothing" source="app/shopping/inventory/[id]/item-forms.tsx:145">
        <label className="flex items-center gap-2 text-ui text-ink">
          <input type="checkbox" defaultChecked className="size-4 rounded border-border text-accent focus:ring-accent/30" />
          Count toward the budget
        </label>
      </Specimen>
      <Specimen label="accent-accent" source="app/learn/t/[id]/plan-form.tsx:104">
        <label className="flex items-start gap-2 text-ui text-ink">
          <input type="checkbox" defaultChecked className="mt-1 size-4 shrink-0 accent-accent" />
          <span>
            Ready to build
            <span className="block text-small text-ink-muted">A session can pick it up.</span>
          </span>
        </label>
      </Specimen>
      <Specimen label="Bare" source="app/shopping/inventory/add/add-book-forms.tsx:394">
        <label className="flex items-start gap-2 text-ui text-ink">
          <input type="checkbox" className="mt-1" />
          Already read it
        </label>
      </Specimen>
    </Specimens>
  );
}

export function NowHeadings() {
  return (
    <Specimens>
      <Specimen label="Two cards on one page: a heading with no icon and its action on its own line, then one with an icon and the action inline" source="app/jobs/(app)/companies/[slug]/panels.tsx">
        <div className="w-full space-y-3">
          <CardSection title="Roles here, across cycles">
            <div className="flex justify-end">
              <Button variant="ghost" size="sm">Merge roles</Button>
            </div>
            <p className="text-ui text-ink">Senior Software Engineer, Research Platform</p>
          </CardSection>
          <div className={cn(cardVariants({ padding: 'dense' }))}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-ui font-semibold text-ink">
                <ListChecks className="size-4 text-ink-muted" strokeWidth={1.75} aria-hidden />
                Tasks
              </h2>
              <Button variant="ghost" size="sm">
                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
                Add
              </Button>
            </div>
            <p className="text-ui text-ink">Send Dana the follow-up</p>
          </div>
        </div>
      </Specimen>
      <Specimen label="GroupHeader, the shared one (needs a count)" source="components/shell/group-header.tsx">
        <GroupHeader label="This week" count={4} />
      </Specimen>
      <Specimen label="Micro, tracking-wider" source="app/jobs/(app)/roles/[id]/prep-note.tsx:51">
        <p className="text-micro font-semibold uppercase tracking-wider text-ink-muted">What they asked</p>
      </Specimen>
      <Specimen label="Micro, tracking-wide" source="app/dev/raised/raised-view.tsx:63">
        <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">What they asked</p>
      </Specimen>
      <Specimen label="Small, uppercase" source="components/patterns/tabbed-detail.tsx:141">
        <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">What they asked</p>
      </Specimen>
      <Specimen label="UI size, uppercase, medium" source="app/jobs/(onboarding)/onboarding/page.tsx:57">
        <p className="text-ui font-medium uppercase tracking-wider text-ink-muted">What they asked</p>
      </Specimen>
      <Specimen label="Body-size section heading" source="app/shopping/sell/sell-ui.tsx:515">
        <h3 className="text-body font-semibold text-ink">
          Listed <span className="font-normal text-ink-muted">(3)</span>
        </h3>
      </Specimen>
    </Specimens>
  );
}

export function NowCallouts() {
  return (
    <Specimens>
      <Specimen label="Banner, the shared one: page-sized" source="components/ui/banner.tsx">
        <Banner tone="warn" className="w-full">The vault has not synced since Tuesday.</Banner>
      </Specimen>
      <Specimen label="Small caution box, rounded (4px)" source="app/jobs/(app)/roles/[id]/application.tsx:280">
        <div className="w-full rounded bg-caution-tint px-2 py-1.5">
          <p className="text-small font-medium text-ink">The deadline passed two days ago.</p>
        </div>
      </Specimen>
      <Specimen label="Caution box, rounded-lg, ui size" source="app/vault/settings/settings-view.tsx:120">
        <p className="w-full rounded-lg bg-caution-tint px-3 py-2 text-ui text-ink">The vault has not synced since Tuesday.</p>
      </Specimen>
      <Specimen label="Caution at 40%" source="app/dev/plan/plan-row.tsx:163">
        <div className="w-full rounded-lg bg-caution-tint/40 px-3 py-2.5 text-ui text-ink">Waiting on your answer.</div>
      </Specimen>
      <Specimen label="Inset on canvas, rounded-card" source="app/jobs/(app)/companies/[slug]/panels.tsx:461">
        <div className="w-full rounded-card bg-canvas p-3">
          <p className="text-ui font-medium text-ink">Merge these two roles</p>
        </div>
      </Specimen>
      <Specimen label="Inset on sunken, rounded-control" source="app/goals/[goalId]/information-step.tsx:639">
        <div className="w-full rounded-control bg-sunken p-3 text-ui text-ink">Rent is due on the first.</div>
      </Specimen>
      <Specimen label="Inset on sunken, rounded-md" source="app/learn/know/personality-section.tsx:192">
        <div className="w-full rounded-md bg-sunken p-3 text-ui text-ink">Rent is due on the first.</div>
      </Specimen>
      <Specimen label="Accent with a left rule" source="app/learn/now/feed.tsx:719">
        <section className="w-full rounded-control border-l-2 border-accent bg-accent-tint px-3 py-2.5">
          <h3 className="text-small font-semibold text-accent">The takeaway</h3>
          <p className="text-ui text-ink">Spaced repetition beats rereading.</p>
        </section>
      </Specimen>
    </Specimens>
  );
}

export function NowEmpty() {
  return (
    <Specimens>
      <Specimen label="EmptyState, the shared one" source="components/ui/empty-state.tsx">
        <EmptyState className="w-full" title="No roles yet" description="Roles you save from a posting land here." />
      </Specimen>
      <Specimen label="Dashed card at py-10" source="app/jobs/(app)/roles/[id]/mail.tsx:30">
        <p className={cn(cardVariants(), 'w-full border-dashed px-4 py-10 text-center text-ui text-ink-muted')}>
          No mail has been linked to this pursuit yet.
        </p>
      </Specimen>
      <Specimen label="Dashed card at py-6, body size" source="app/dev/usage/usage-view.tsx:66">
        <p className={cn(cardVariants(), 'w-full border-dashed px-4 py-6 text-center text-body text-ink-muted')}>
          No runs in this window.
        </p>
      </Specimen>
      <Specimen label="A bare line with no way forward" source="app/dev/plan/feature-page.tsx:656">
        <p className="text-ui text-ink-muted">No steps under this feature yet.</p>
      </Specimen>
    </Specimens>
  );
}

export function NowValues() {
  return (
    <Specimens>
      <Specimen label="ValueList, the shared one" source="components/ui/value-row.tsx">
        <ValueList className="w-full">
          <ValueRow label="Ordered" value="12 Sep 2026" />
          <ValueRow label="Return by" value="12 Oct 2026" />
          <ValueRow label="Tracking" value="" />
        </ValueList>
      </Specimen>
      <Specimen label="A dl written by hand, with its own total row" source="app/shopping/orders/[id]/order-detail-view.tsx:395">
        <dl className="w-full space-y-1 text-ui">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd className="tabular text-ink">$84.00</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-muted">Shipping</dt>
            <dd className="tabular text-ink">$6.50</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
            <dt className="font-medium text-ink">Total</dt>
            <dd className="tabular font-semibold text-ink">$90.50</dd>
          </div>
        </dl>
      </Specimen>
    </Specimens>
  );
}

export function NowKbd() {
  return (
    <Specimens>
      <Specimen label="Kbd, the shared one" source="components/shell/key-hints.tsx:63">
        <Kbd always>j</Kbd>
        <Kbd always>k</Kbd>
        <Kbd always>⌘K</Kbd>
      </Specimen>
      <Specimen label="Raw kbd on surface" source="app/jobs/(app)/review/list.tsx:159">
        <span className="text-small text-ink-muted">
          <kbd className="rounded border border-border bg-surface px-1">j</kbd>/
          <kbd className="rounded border border-border bg-surface px-1">k</kbd> to move
        </span>
      </Specimen>
      <Specimen label="Raw kbd on canvas, small" source="app/shopping/review/attach-email.tsx:74">
        <kbd className="rounded border border-border bg-canvas px-1.5 text-small text-ink-muted">1</kbd>
      </Specimen>
    </Specimens>
  );
}

export function NowStats() {
  return (
    <Specimens>
      <Specimen label="Title size, no tracking" source="components/inbox/overview.tsx:29">
        <span className="flex flex-col gap-0.5">
          <span className="tabular text-title font-semibold text-ink">14</span>
          <span className="text-small text-ink-muted">To read</span>
        </span>
      </Specimen>
      <Specimen label="Body size, tight tracking, label first" source="app/jobs/(app)/_home/live-section.tsx:70">
        <dl className="flex gap-6">
          <div>
            <dt className="text-small text-ink-muted">Applied</dt>
            <dd className="tabular text-body font-semibold tracking-tight text-ink">23</dd>
          </div>
          <div>
            <dt className="text-small text-ink-muted">Interviews</dt>
            <dd className="tabular text-body font-semibold tracking-tight text-ink">4</dd>
          </div>
        </dl>
      </Specimen>
    </Specimens>
  );
}

export function NowLiveDot() {
  return (
    <Specimens>
      <Specimen label="Pulsing the dot itself, 6px" source="app/goals/area-planner.tsx:48">
        <p className="flex items-center gap-1.5 text-small text-accent">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
          Dash is planning this area
        </p>
      </Specimen>
      <Specimen label="Silent run" source="app/dev/plan/plan-run-status.tsx:278">
        <p className="flex items-center gap-1.5 text-small text-ink-muted">
          <span className="size-1.5 rounded-full bg-caution" aria-hidden />
          No word for 20 minutes
        </p>
      </Specimen>
    </Specimens>
  );
}

export function NowMenus() {
  return (
    <Specimens>
      <Specimen label="ActionMenu's panel: rounded-lg, items flush to the edge" source="components/ui/action-menu.tsx:255">
        <div className="popover-panel w-52 overflow-hidden rounded-lg border border-border bg-raised py-1 shadow-lg">
          {['Open', 'Rename', 'Move to…'].map((item) => (
            <button key={item} type="button" className="flex w-full items-center px-3 py-2 text-left text-ui text-ink transition-colors hover:bg-canvas">
              {item}
            </button>
          ))}
          <button type="button" className="flex w-full items-center px-3 py-2 text-left text-ui text-danger transition-colors hover:bg-danger-tint">
            Delete
          </button>
        </div>
      </Specimen>
      <Specimen label="Popover's surface: rounded-card" source="components/ui/popover.tsx:44">
        <div className={cn(popoverSurface, 'w-52 p-1')}>
          {['Open', 'Rename', 'Move to…'].map((item) => (
            <button key={item} type="button" className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-ui text-ink hover:bg-canvas">
              {item}
            </button>
          ))}
        </div>
      </Specimen>
    </Specimens>
  );
}

const RADII_NOW = [
  ['rounded-full', 146],
  ['rounded-control', 128],
  ['rounded-lg', 88],
  ['rounded', 72],
  ['rounded-pill', 37],
  ['rounded-card', 34],
  ['rounded-md', 32],
  ['rounded-sm', 8],
  ['rounded-[6–9px]', 6],
  ['rounded-xl', 4],
  ['rounded-2xl', 1],
] as const;

const RADIUS_CLASS: Record<string, string> = {
  'rounded-full': 'rounded-full',
  'rounded-control': 'rounded-control',
  'rounded-lg': 'rounded-lg',
  rounded: 'rounded',
  'rounded-pill': 'rounded-pill',
  'rounded-card': 'rounded-card',
  'rounded-md': 'rounded-md',
  'rounded-sm': 'rounded-sm',
  'rounded-[6–9px]': 'rounded-[7px]',
  'rounded-xl': 'rounded-xl',
  'rounded-2xl': 'rounded-2xl',
};

export function NowShape() {
  return (
    <Specimens>
      <Specimen label="Eleven corner radii in use, with how many places use each. Only control, card and pane follow the theme.">
        <div className="grid w-full grid-cols-4 gap-3 sm:grid-cols-6">
          {RADII_NOW.map(([name, count]) => (
            <div key={name} className="space-y-1">
              <div className={cn('h-10 w-full border border-border-strong bg-surface', RADIUS_CLASS[name])} />
              <p className="break-all font-mono text-micro text-ink-muted">{name}</p>
              <p className="tabular text-micro text-ink-ghost">{count}</p>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen label="Icons: 14px outnumbers 16px, and stroke 2 is used 235 times against the 1.75 the standard sets">
        {[
          ['size-3', 2],
          ['size-3.5', 1.75],
          ['size-3.5', 2],
          ['size-4', 1.75],
          ['size-4', 2],
          ['size-5', 1.5],
        ].map(([size, stroke], index) => (
          <span key={index} className="flex flex-col items-center gap-1 rounded-control bg-sunken px-2 py-1.5">
            <Pencil className={cn(size as string, 'text-ink')} strokeWidth={stroke as number} aria-hidden />
            <span className="font-mono text-micro text-ink-ghost">
              {(size as string).replace('size-', '')}/{stroke}
            </span>
          </span>
        ))}
      </Specimen>
    </Specimens>
  );
}
