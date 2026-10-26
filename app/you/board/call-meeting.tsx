'use client';

import { useState, useTransition } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError, FieldHint, Input, Label } from '@/components/ui/field';
import { DECISION_MAX, MEETING_RUNNING_MESSAGE } from '@/lib/you/board';

/**
 * Call a meeting about one decision (plan #2540.5): the header's one action
 * on the Board tab, and the line that opens under the header when it is
 * pressed. The press queues a called meeting and fires the board routine
 * (callBoardMeeting in ./actions); the list then shows it running and reads
 * the page again until its minutes arrive.
 *
 * While a meeting is open the press does not open the line; it says a meeting
 * is already running.
 */

export type CallActions = { call: (decision: string) => Promise<{ error: string | null }> };

/** How the press starts: closed, or already showing the line or the running notice (the gallery draws both). */
export type CallStart = 'closed' | 'form' | 'running';

export function useCallMeeting({
  running,
  actions,
  start = 'closed',
}: {
  running: boolean;
  actions: CallActions;
  start?: CallStart;
}) {
  const [open, setOpen] = useState(start === 'form');
  const [decision, setDecision] = useState(start === 'form' ? 'Should I take the three-month contract, or keep the search full time?' : '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(start === 'running' ? MEETING_RUNNING_MESSAGE : null);
  const [starting, startTransition] = useTransition();

  const press = () => {
    if (running) {
      setOpen(false);
      setNotice(MEETING_RUNNING_MESSAGE);
      return;
    }
    setNotice(null);
    setError(null);
    setOpen((current) => !current);
  };

  const submit = () =>
    startTransition(async () => {
      const result = await actions.call(decision);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDecision('');
      setError(null);
      setOpen(false);
    });

  const button = (
    <DashAction
      type="button"
      variant="secondary"
      onClick={press}
      routine="board"
      what="Cost of calling a meeting"
      align="end"
      aria-expanded={open}
      aria-controls="call-meeting"
    >
      Call a meeting
    </DashAction>
  );

  const form = open ? (
    <CallMeetingForm
      decision={decision}
      onDecision={(value) => {
        setDecision(value);
        setError(null);
      }}
      error={error}
      starting={starting}
      onSubmit={submit}
      onCancel={() => setOpen(false)}
    />
  ) : notice && running ? (
    <Banner tone="info">{notice}</Banner>
  ) : null;

  return { button, form };
}

export function CallMeetingForm({
  decision,
  onDecision,
  error,
  starting,
  onSubmit,
  onCancel,
}: {
  decision: string;
  onDecision: (value: string) => void;
  error: string | null;
  starting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const blank = decision.trim() === '';
  return (
    <Card id="call-meeting" padding="standard" className="space-y-3">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blank && !starting) onSubmit();
        }}
      >
        <div>
          <Label htmlFor="call-meeting-decision">The decision</Label>
          <Input
            id="call-meeting-decision"
            value={decision}
            maxLength={DECISION_MAX}
            placeholder="Take the Austin offer, or keep looking in Chicago?"
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'call-meeting-error' : 'call-meeting-hint'}
            onChange={(event) => onDecision(event.target.value)}
          />
          <FieldHint id="call-meeting-hint">
            Each seat votes on it and says what would change its mind. The minutes appear here in a few minutes.
          </FieldHint>
          <FieldError id="call-meeting-error">{error}</FieldError>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={blank || starting}>
            {starting ? 'Calling…' : 'Start the meeting'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={starting}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
