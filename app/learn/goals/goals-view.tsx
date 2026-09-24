'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gauge, ListChecks, MapPin, Target } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ChipSelect, ComposeBody, ComposeTitle, InlineInput } from '@/components/ui/field';
import {
  AIM_ABOUT_MAX,
  AIM_DEPTHS,
  AIM_DEPTH_LABELS,
  AIM_NAME_MAX,
  LEVEL3_AIM_NAME,
  type Aim,
  type AimPlace,
} from '@/lib/learn/aims';
import {
  addGoal,
  addLevel3Goal,
  archiveGoal,
  editGoal,
  type GoalActionState,
} from './actions';

/**
 * The Goals page's list and its two ways to add one (plan #897).
 *
 * One surface of rows, each edited where it stands (law 12): the name and the
 * line are inline inputs saved on blur, the depth is a chip saved on change.
 * Adding one is a compose surface behind a trigger (law 14), and the Level 3
 * goal is a single press beside it until you have it.
 */

const initial: GoalActionState = {};

function DepthOptions() {
  return AIM_DEPTHS.map((depth) => (
    <option key={depth} value={depth}>
      {AIM_DEPTH_LABELS[depth].label}
    </option>
  ));
}

/** How often the page checks back while a goal is being placed. */
const PLACING_POLL_MS = 8000;

export function GoalsView({
  aims,
  places,
}: {
  aims: Aim[];
  /** Where each goal sits in the area grid, by id (#898). */
  places: Record<string, AimPlace>;
}) {
  const router = useRouter();
  const hasLevel3 = aims.some((aim) => aim.listSource === 'level3');
  const placing = Object.values(places).some((place) => place.kind === 'pending');

  // Placement runs after the save's response, so check back until it lands.
  // The server stops calling a goal pending two minutes after its save.
  useEffect(() => {
    if (!placing) return;
    const timer = setInterval(() => router.refresh(), PLACING_POLL_MS);
    return () => clearInterval(timer);
  }, [placing, router]);

  return (
    <div className="space-y-4">
      {aims.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Name something broad, such as city design or startup finance, and say how well you want to know it."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {aims.map((aim) => (
              <GoalRow key={aim.id} aim={aim} place={places[aim.id]} />
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <GoalComposer />
        {!hasLevel3 && <Level3Offer />}
      </div>
    </div>
  );
}

/** One goal, edited in place. Each control is its own form, so one save is one field. */
function GoalRow({ aim, place }: { aim: Aim; place: AimPlace | undefined }) {
  const [editState, edit, editing] = useActionState(editGoal, initial);
  const [archiveState, archive, archiving] = useActionState(archiveGoal, initial);
  const error = editState.error ?? archiveState.error;

  /** Save on blur when the words changed. A name cleared to nothing is put back. */
  function commitOnBlur(
    before: string,
    { required = false }: { required?: boolean } = {},
  ) {
    return (event: React.FocusEvent<HTMLInputElement>) => {
      const value = event.target.value.trim();
      if (required && value === '') {
        event.target.value = before;
        return;
      }
      if (value !== before) event.target.form?.requestSubmit();
    };
  }

  function revertOnEscape(before: string) {
    return (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.currentTarget.value = before;
        event.currentTarget.blur();
      }
    };
  }

  return (
    <li className="row-pad flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-60">
        <form action={edit}>
          <input type="hidden" name="id" value={aim.id} />
          <InlineInput
            name="name"
            required
            maxLength={AIM_NAME_MAX}
            defaultValue={aim.name}
            key={`name-${aim.name}`}
            aria-label={`Rename ${aim.name}`}
            disabled={editing}
            onBlur={commitOnBlur(aim.name, { required: true })}
            onKeyDown={revertOnEscape(aim.name)}
            className="w-full font-medium"
          />
        </form>
        <form action={edit}>
          <input type="hidden" name="id" value={aim.id} />
          <InlineInput
            name="about"
            maxLength={AIM_ABOUT_MAX}
            defaultValue={aim.about ?? ''}
            key={`about-${aim.about ?? ''}`}
            placeholder="Add a line on what you mean"
            aria-label={`What you mean by ${aim.name}`}
            disabled={editing}
            onBlur={commitOnBlur(aim.about ?? '')}
            onKeyDown={revertOnEscape(aim.about ?? '')}
            className="w-full text-ui text-ink-muted"
          />
        </form>
        {/* Where a goal says what it covers. The Level 3 goal's claimed and
            tested counts go here (#906). */}
        {aim.listSource === 'level3' && (
          <p className="px-1.5 text-small text-ink-muted">
            Every article on Wikipedia&rsquo;s Level 3 vital list.
          </p>
        )}
        {place && <PlaceLine place={place} />}
        {error && <p className="px-1.5 text-small text-danger">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <form action={edit}>
          <input type="hidden" name="id" value={aim.id} />
          <ChipSelect
            name="depth"
            defaultValue={aim.depth}
            key={`depth-${aim.depth}`}
            aria-label={`How well you want to know ${aim.name}`}
            title={AIM_DEPTH_LABELS[aim.depth].means}
            icon={<Gauge className="size-3.5" strokeWidth={1.75} />}
            disabled={editing}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <DepthOptions />
          </ChipSelect>
        </form>
        <form action={archive}>
          <input type="hidden" name="id" value={aim.id} />
          <Button type="submit" variant="ghost" size="sm" disabled={archiving}>
            {archiving ? 'Archiving…' : 'Archive'}
          </Button>
        </form>
      </div>
    </li>
  );
}

/** The field or domain an open goal was placed in, so a wrong one can be seen. */
function PlaceLine({ place }: { place: AimPlace }) {
  let text: string;
  switch (place.kind) {
    case 'list':
      return null;
    case 'field':
      text = `In ${place.name}`;
      break;
    case 'domain':
      text = `Across ${place.name}`;
      break;
    case 'spans':
      text = 'Spans several domains, so it sits in no one field';
      break;
    case 'pending':
      text = 'Finding its field…';
      break;
    case 'unplaced':
      text = 'Not in a field yet. Saving a goal, or rewording this one, tries again.';
      break;
  }
  return (
    <p className="flex items-center gap-1 px-1.5 text-small text-ink-muted">
      <MapPin className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {text}
    </p>
  );
}

/** A new goal: a name, an optional line, and a depth chip. */
function GoalComposer() {
  const [open, setOpen] = useState(false);
  const [depth, setDepth] = useState<string>('familiar');
  // Close once a save lands, so the new goal is read in the list above.
  const [state, add, adding] = useActionState(
    async (prev: GoalActionState, form: FormData) => {
      const next = await addGoal(prev, form);
      if (next.done) {
        setOpen(false);
        setDepth('familiar');
      }
      return next;
    },
    initial,
  );

  if (!open) return <AddTrigger label="New goal" onClick={() => setOpen(true)} />;

  const means = AIM_DEPTH_LABELS[depth as keyof typeof AIM_DEPTH_LABELS]?.means;

  return (
    <Card className="w-full">
      <form
        action={add}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <div className="space-y-3 px-3 py-3">
          <ComposeTitle
            name="name"
            required
            autoFocus
            maxLength={AIM_NAME_MAX}
            placeholder="What you want to learn, such as city design and urbanism"
            aria-label="Goal name"
          />
          <ComposeBody
            name="about"
            rows={1}
            maxLength={AIM_ABOUT_MAX}
            placeholder="What you mean by it (optional)"
            aria-label="What you mean by it"
          />
          <div className="flex flex-wrap items-center gap-2">
            <ChipSelect
              name="depth"
              value={depth}
              onChange={(event) => setDepth(event.target.value)}
              aria-label="How well you want to know it"
              icon={<Gauge className="size-3.5" strokeWidth={1.75} />}
            >
              <DepthOptions />
            </ChipSelect>
            {means && <span className="text-small text-ink-muted">Know it {means}.</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          {state.error && <span className="text-small text-danger">{state.error}</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={adding}>
              {adding ? 'Adding…' : 'Add goal'}
            </Button>
            <PaidHint
              action="app/learn/goals/actions.ts#addGoal"
              what="Cost of placing the goal"
              align="end"
            />
          </span>
        </div>
      </form>
    </Card>
  );
}

/** The ready-made goal, one press to add. Gone once you have it. */
function Level3Offer() {
  const [state, add, adding] = useActionState(addLevel3Goal, initial);

  return (
    <form action={add} className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="ghost" size="sm" disabled={adding}>
        <ListChecks className="size-3.5" strokeWidth={1.75} aria-hidden />
        {adding ? 'Adding…' : `Add “${LEVEL3_AIM_NAME}”`}
      </Button>
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </form>
  );
}
