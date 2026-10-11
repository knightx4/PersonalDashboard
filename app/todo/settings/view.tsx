'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Card, CardSection } from '@/components/ui/card';
import { FieldError, InlineInput } from '@/components/ui/field';
import type { ModuleId } from '@/lib/modules';
import type { SourceId } from '@/lib/todo/agenda/sources';
import { saveAgendaSettingsNow } from './actions';

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
 * Sources and the horizon. There is no Save: a ticked box saves when it is
 * ticked, and the horizon saves when you leave it (plan #1777).
 *
 * Each save sends the whole current choice, so two quick changes cannot undo
 * each other, and a failed save puts the page back to what is stored.
 */
export function AgendaSettingsForm({
  groups,
  enabled,
  horizonDays,
}: {
  groups: SourceGroup[];
  enabled: SourceId[];
  horizonDays: number;
}) {
  const [on, setOn] = useState<SourceId[]>(enabled);
  const [days, setDays] = useState(String(horizonDays));
  const saved = useRef({ on: enabled, days: horizonDays });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [, start] = useTransition();

  function save(nextOn: SourceId[], nextDays: string) {
    const parsed = Number(nextDays);
    start(async () => {
      const result = await saveAgendaSettingsNow({ enabledSources: nextOn, horizonDays: parsed });
      if (result.error) {
        setError(result.error);
        setOn(saved.current.on);
        setDays(String(saved.current.days));
        return;
      }
      setError(undefined);
      saved.current = { on: nextOn, days: parsed };
    });
  }

  function toggle(id: SourceId, checked: boolean) {
    const next = checked ? [...on, id] : on.filter((s) => s !== id);
    setOn(next);
    save(next, days);
  }

  function leaveHorizon() {
    if (Number(days) === saved.current.days) return;
    save(on, days);
  }

  return (
    <div className="space-y-6">
      <CardSection
        title="Sources"
        padding="standard"
        hint="Things the other workspaces already know about, shown on your agenda. They are read where they live and never copied here. Finishing one writes to the workspace that owns it."
      >
        {groups.length === 0 ? (
          <p className="mt-2 text-ui text-ink-muted">
            No sources yet. The agenda shows the tasks you typed.
          </p>
        ) : (
          <div className="mt-2 space-y-5">
            {groups.map((group) => (
              <div key={group.moduleId}>
                <h3 className="mb-2 text-micro font-semibold uppercase tracking-wider text-ink-muted">
                  {group.moduleLabel}
                </h3>
                {/* Divides rather than one box per source: the card around
                    them has already drawn that edge once, and drawing it again
                    per row turns a list of sources into a wall of rectangles.
                    Law 11. */}
                <div className="divide-y divide-border border-y border-border">
                  {group.sources.map((source) => (
                    <label
                      key={source.id}
                      className={cn(
                        'row-pad flex items-start gap-3',
                        !source.available && 'opacity-60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on.includes(source.id)}
                        onChange={(event) => toggle(source.id, event.target.checked)}
                        disabled={!source.available}
                        className="mt-1 size-4 accent-accent"
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
        )}
      </CardSection>

      {/* The setting is the sentence. Pressing the number turns it into a box
          and leaving the box saves it; anything further out waits under Later. */}
      <Card padding="standard">
        {/* eslint-disable-next-line no-restricted-syntax -- text-base matches the input's own 16px on a phone, which stops iOS zooming on focus, so the words and the number are one size. */}
        <p className="text-base text-ink sm:text-ui">
          This week covers{' '}
          {editing ? (
            <InlineInput
              autoFocus
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              onBlur={() => {
                setEditing(false);
                leaveHorizon();
              }}
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
              className="press rounded-control underline decoration-ink-ghost decoration-dotted underline-offset-4 hover:bg-sunken"
            >
              {days}
            </button>
          )}{' '}
          days
        </p>
        <p className="mt-2 text-small text-ink-muted">
          Your timezone decides what counts as today, in every workspace.{' '}
          <Link href="/account" className="press font-medium text-accent hover:underline">
            Account settings
          </Link>
        </p>
      </Card>

      <FieldError>{error}</FieldError>
    </div>
  );
}
