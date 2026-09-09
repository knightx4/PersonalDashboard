'use client';

import { useActionState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { Field, FieldError, Input } from '@/components/ui/field';
import type { ModuleId } from '@/lib/modules';
import type { SourceId } from '@/lib/todo/agenda/sources';
import { updateAgendaSettings, type AgendaSettingsState } from './actions';

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

export function AgendaSettingsForm({
  groups,
  enabled,
  horizonDays,
}: {
  groups: SourceGroup[];
  enabled: SourceId[];
  horizonDays: number;
}) {
  const [state, action] = useActionState<AgendaSettingsState, FormData>(
    updateAgendaSettings,
    {},
  );

  return (
    <form action={action} className="space-y-6">
      <CardSection
        title="Sources"
        padding="standard"
        hint="Things the other workspaces already know about, shown on your agenda. They are read where they live and never copied here — finishing one writes to the workspace that owns it."
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
                        name={`source:${source.id}`}
                        defaultChecked={enabled.includes(source.id)}
                        disabled={!source.available}
                        className="mt-1 size-4 accent-accent"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-ui font-medium text-ink">
                          {source.label}
                        </span>
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

      <CardSection
        title="Horizon"
        padding="standard"
        hint="How far ahead counts as “this week”. Anything further out waits under Later."
      >
        <Field id="horizonDays" label="Days" className="mt-1">
          <Input
            id="horizonDays"
            name="horizonDays"
            type="number"
            min={1}
            max={90}
            defaultValue={horizonDays}
            className="w-24"
          />
        </Field>
      </CardSection>

      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}

      <Button type="submit">Save</Button>
    </form>
  );
}
