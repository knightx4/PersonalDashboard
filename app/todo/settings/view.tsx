'use client';

import { useActionState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import type { SourceId } from '@/lib/todo/agenda/sources';
import { updateAgendaSettings, type AgendaSettingsState } from './actions';

export interface SourceOption {
  id: SourceId;
  label: string;
  description: string;
  /** False when the workspace it reads is switched off in Account. */
  available: boolean;
}

export function AgendaSettingsForm({
  sources,
  enabled,
  horizonDays,
}: {
  sources: SourceOption[];
  enabled: SourceId[];
  horizonDays: number;
}) {
  const [state, action] = useActionState<AgendaSettingsState, FormData>(
    updateAgendaSettings,
    {},
  );

  return (
    <form action={action} className="space-y-6">
      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Sources</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Things the other workspaces already know about, shown on your agenda. They are read
          where they live and never copied here — finishing one writes to the workspace that owns
          it.
        </p>

        {sources.length === 0 ? (
          <p className="mt-4 text-[13px] text-ink-faint">
            No sources yet. The agenda shows the tasks you typed.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {sources.map((source) => (
              <label
                key={source.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border border-border px-3 py-2.5',
                  !source.available && 'opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  name={`source:${source.id}`}
                  defaultChecked={enabled.includes(source.id)}
                  disabled={!source.available}
                  className="mt-1 size-4 accent-[var(--color-brand)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{source.label}</span>
                  <span className="block text-[12px] leading-snug text-ink-muted">
                    {source.available
                      ? source.description
                      : 'That workspace is switched off under Account.'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Horizon</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          How far ahead counts as &ldquo;this week&rdquo;. Anything further out waits under Later.
        </p>
        <div className="mt-3 flex items-end gap-2">
          <div>
            <Label htmlFor="horizonDays">Days</Label>
            <Input
              id="horizonDays"
              name="horizonDays"
              type="number"
              min={1}
              max={90}
              defaultValue={horizonDays}
              className="w-24"
            />
          </div>
        </div>
      </section>

      {state.error && <p className="text-[13px] text-status-rejected">{state.error}</p>}
      {state.message && <p className="text-[13px] text-status-offer">{state.message}</p>}

      <Button type="submit">Save</Button>
    </form>
  );
}
