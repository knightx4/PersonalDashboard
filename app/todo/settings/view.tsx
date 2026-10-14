'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useSettingSave } from '@/components/patterns/settings-fields';
import { Checkbox, InlineInput } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-heading';
import type { ModuleId } from '@/lib/modules';
import type { SourceId } from '@/lib/todo/agenda/sources';
import { saveAgendaHorizon, saveAgendaSources } from './actions';

export interface SourceOption {
  id: SourceId;
  label: string;
  description: string;
  /** False when the workspace it reads is switched off in Account. */
  available: boolean;
}

/** One workspace's sources, so the list reads as "what Job search contributes". */
export interface SourceGroup {
  moduleId: ModuleId;
  moduleLabel: string;
  sources: SourceOption[];
}

/**
 * The agenda's sources, grouped by the workspace they read. There is no
 * Save: a ticked box saves when it is ticked (plan #1777), sending the whole
 * current choice so two quick presses cannot undo each other, and a refused
 * save puts the box back with a toast.
 */
export function AgendaSources({ groups, enabled }: { groups: SourceGroup[]; enabled: SourceId[] }) {
  const [on, setOn] = useState<SourceId[]>(enabled);
  const { run } = useSettingSave(saveAgendaSources);

  function toggle(id: SourceId, checked: boolean) {
    const previous = on;
    const next = checked ? [...on, id] : on.filter((s) => s !== id);
    setOn(next);
    run(next, () => setOn(previous));
  }

  if (groups.length === 0) {
    return <EmptyState size="inline" title="No sources yet. The agenda shows the tasks you typed." />;
  }
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.moduleId}>
          <SectionLabel as="h3" className="mb-2">
            {group.moduleLabel}
          </SectionLabel>
          {/* Divides rather than one box per source: the card around them has
              already drawn that edge once, and drawing it again per row turns
              a list of sources into a wall of rectangles. Law 11. */}
          <div className="divide-y divide-border border-y border-border">
            {group.sources.map((source) => (
              <label
                key={source.id}
                className={cn('row-pad flex items-start gap-3', !source.available && 'opacity-60')}
              >
                <Checkbox
                  checked={on.includes(source.id)}
                  onChange={(event) => toggle(source.id, event.target.checked)}
                  disabled={!source.available}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui font-medium text-ink">{source.label}</span>
                  <span className="block text-small leading-snug text-ink-muted">
                    {source.available
                      ? source.description
                      : `${group.moduleLabel} is switched off under Account.`}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * How far "this week" looks. The setting is the sentence: pressing the
 * number turns it into a box and leaving the box saves it.
 */
export function AgendaHorizon({ horizonDays }: { horizonDays: number }) {
  const [days, setDays] = useState(String(horizonDays));
  const saved = useRef(String(horizonDays));
  const [editing, setEditing] = useState(false);
  const { run } = useSettingSave(saveAgendaHorizon);

  function leave() {
    setEditing(false);
    const next = days.trim();
    if (next === saved.current) return;
    const previous = saved.current;
    saved.current = next;
    run(next, () => {
      saved.current = previous;
      setDays(previous);
    });
  }

  return (
    <div>
      <p className="text-ui text-ink">
        Covers{' '}
        {editing ? (
          <InlineInput
            autoFocus
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            onBlur={leave}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            aria-label="Days this week covers"
            className="inline-block w-9 px-0 text-center"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`${days} days. Change how many days this week covers`}
            className="press rounded-control underline decoration-ink-ghost decoration-dotted hover:bg-sunken"
          >
            {days}
          </button>
        )}{' '}
        days
      </p>
      <p className="mt-2 text-small text-ink-muted">
        Your timezone decides what counts as today, in every workspace.{' '}
        <Link href="/account" className={linkVariants()}>
          Account settings
        </Link>
      </p>
    </div>
  );
}
