'use client';

import { useState, useTransition } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError, FieldHint, Label, Textarea } from '@/components/ui/field';
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
export type CallStart = 'closed' | 'form' | 'error' | 'running';

export function useCallMeeting({
  running,
  actions,
  start = 'closed',
}: {
  running: boolean;
  actions: CallActions;
  start?: CallStart;
}) {
  const [open, setOpen] = useState(start === 'form' || start === 'error');
  const [decision, setDecision] = useState(
    start === 'form' || start === 'error'
      ? 'Should I take the three-month contract at the analytics firm, or keep the search full time and wait for a finance role?'
      : '',
  );
  const [error, setError] = useState<string | null>(
    start === 'error' ? 'Dash could not start the meeting. The board routine answered 529, overloaded. Try again in a minute.' : null,
  );
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
    <Button
      type="button"
      variant="secondary"
      onClick={press}
      aria-expanded={open}
      aria-controls="call-meeting"
    >
      Call a meeting
    </Button>
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
          <Textarea
            id="call-meeting-decision"
            value={decision}
            maxLength={DECISION_MAX}
            placeholder="Take the Austin offer, or keep looking in Chicago?"
            rows={2}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!blank && !starting) onSubmit();
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'call-meeting-error' : 'call-meeting-hint'}
            onChange={(event) => onDecision(event.target.value)}
          />
          <FieldHint id="call-meeting-hint">
            Each seat votes on it and says what would change its mind. The minutes appear here shortly.
          </FieldHint>
          <FieldError id="call-meeting-error">{error}</FieldError>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashAction
            type="submit"
            pending={starting}
            disabled={blank || starting}
            routine="board"
            what="Cost of calling a meeting"
            align="start"
          >
            {starting ? 'Calling…' : 'Start the meeting'}
          </DashAction>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={starting}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
