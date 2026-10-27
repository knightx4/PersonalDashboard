'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError, FieldHint } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { MEETING_RUNNING_MESSAGE } from '@/lib/you/board';
import { panelNames, type BoardPanel } from '@/lib/you/board-panels';
import { cn } from '@/lib/cn';

/**
 * Start a meeting (plan #2576.3): the Board tab header's second action, and the
 * short card that opens under it. The person picks No panel (the usual board)
 * or one of their panels, each shown with its topic and members, and presses
 * Start. startMeeting (./actions) queues a weekly-kind meeting with the panel
 * copied onto it and fires the board routine; the list then shows it running.
 * While a meeting is open the card says so and Start is off.
 */

export type StartActions = { start: (panelId: string | null) => Promise<{ error: string | null }> };

/** How the press starts: closed, with the card open, refused, or open while a meeting runs (the gallery draws each). */
export type StartStart = 'closed' | 'form' | 'error' | 'running';

export const SAMPLE_START_ERROR =
  'Dash could not start the meeting. The board routine did not answer. Try again in a minute.';

export function useStartMeeting({
  panels,
  roster,
  running,
  actions,
  start = 'closed',
}: {
  panels: readonly BoardPanel[];
  roster: readonly { key: string; name: string }[];
  /** A meeting is queued or running now. */
  running: boolean;
  actions: StartActions;
  start?: StartStart;
}) {
  const [open, setOpen] = useState(start !== 'closed');
  const [panelId, setPanelId] = useState<string | null>(start === 'closed' ? null : (panels[0]?.id ?? null));
  const [error, setError] = useState<string | null>(start === 'error' ? SAMPLE_START_ERROR : null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setError(null);
  };
  const submit = () => {
    setPending(true);
    setError(null);
    startTransition(async () => {
      const result = await actions.start(panelId);
      setPending(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      close();
    });
  };

  const button = (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        setError(null);
        setOpen((current) => !current);
      }}
      aria-expanded={open}
      aria-controls="start-meeting"
    >
      Start a meeting
    </Button>
  );

  const form = open ? (
    <StartMeetingForm
      panels={panels}
      roster={roster}
      panelId={panelId}
      onPick={setPanelId}
      running={running || start === 'running'}
      error={error}
      pending={pending}
      onSubmit={submit}
      onCancel={close}
    />
  ) : null;

  return { button, form };
}

export function StartMeetingForm({
  panels,
  roster,
  panelId,
  onPick,
  running,
  error,
  pending,
  onSubmit,
  onCancel,
}: {
  panels: readonly BoardPanel[];
  roster: readonly { key: string; name: string }[];
  panelId: string | null;
  onPick: (panelId: string | null) => void;
  running: boolean;
  error: string | null;
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <Card id="start-meeting" padding="standard">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!running && !pending) onSubmit();
        }}
      >
        <fieldset>
          <div className="flex items-center justify-between gap-2">
            <legend className="text-small font-medium text-ink-muted">Which panel is it for</legend>
            <Tooltip label="Close without starting" align="end">
              <IconButton label="Close without starting" onClick={onCancel} disabled={pending}>
                <X aria-hidden strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
          </div>
          <ul className="mt-1 divide-y divide-border">
            <PanelChoice
              checked={panelId === null}
              onPick={() => onPick(null)}
              title="No panel"
              detail="The usual board: the five seats, on whatever the chair takes up."
              disabled={pending}
            />
            {panels.map((panel) => (
              <PanelChoice
                key={panel.id}
                checked={panelId === panel.id}
                onPick={() => onPick(panel.id)}
                title={panel.name}
                detail={panel.topic ?? 'No topic yet, so the meeting takes the panel’s name as its topic.'}
                members={panelNames(panel, roster).join(', ') || 'No advisors yet'}
                disabled={pending || panel.advisors.length === 0}
              />
            ))}
          </ul>
        </fieldset>

        {running && (
          <p role="status" className="text-small text-ink-muted">
            {MEETING_RUNNING_MESSAGE}
          </p>
        )}
        <FieldError id="start-error">{error}</FieldError>

        <div className="flex flex-wrap items-center gap-2">
          <DashAction
            type="submit"
            pending={pending}
            disabled={running || pending}
            routine="board"
            what="Cost of a board meeting"
            align="start"
          >
            {pending ? 'Starting…' : 'Start'}
          </DashAction>
          {!running && <FieldHint>The minutes appear here when it ends.</FieldHint>}
        </div>
      </form>
    </Card>
  );
}

function PanelChoice({
  checked,
  onPick,
  title,
  detail,
  members,
  disabled,
}: {
  checked: boolean;
  onPick: () => void;
  title: string;
  detail: string;
  members?: string;
  disabled: boolean;
}) {
  return (
    <li>
      <label
        className={cn('flex min-h-11 items-start gap-3 py-2', disabled ? 'cursor-default opacity-60' : 'cursor-pointer')}
      >
        <input
          type="radio"
          name="start-panel"
          checked={checked}
          disabled={disabled}
          onChange={onPick}
          className="mt-1 size-4 shrink-0 accent-accent"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-ui text-ink">{title}</span>
          <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">{detail}</span>
          {members && <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">{members}</span>}
        </span>
      </label>
    </li>
  );
}
