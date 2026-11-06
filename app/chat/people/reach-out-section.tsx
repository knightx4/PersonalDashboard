'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { DashMark } from '@/components/ui/dash-mark';
import { Textarea } from '@/components/ui/field';
import { SectionLabel } from '@/components/ui/section-heading';
import { NO_REACH_OUT, nextTextWhen, REACH_OUT_CAPS, type ReachOutView } from '@/lib/you/reach-out-card-model';
import { REACH_OUT_LIMITS } from '@/lib/you/reach-out-rule';

/**
 * Reaching out, on a person's form (plan #2931.3): what they should text you
 * about and how often, in your words. Set it up and Dash makes the rule
 * (lib/you/reach-out-make.ts); the Set up card then says it back, with what
 * Dash cannot watch, when the next text should come and the caps that can
 * hold one back. Change reopens the box with your words; Turn off drops the
 * rule and keeps them. A rule that could not be made keeps your words and
 * says what Dash could not read.
 */

export type ReachOutActions = {
  set: (advisorId: string, brief: string) => Promise<{ view: ReachOutView } | { error: string }>;
  turnOff: (advisorId: string) => Promise<{ view: ReachOutView } | { error: string }>;
};

export function ReachOutSection({
  advisorId,
  name,
  view: initial = NO_REACH_OUT,
  timezone,
  now,
  actions,
  setting: initialSetting = false,
}: {
  advisorId: string;
  name: string;
  view?: ReachOutView;
  timezone: string;
  now: number;
  actions: ReachOutActions;
  /** For the gallery: Dash making the rule. */
  setting?: boolean;
}) {
  const [view, setView] = useState(initial);
  const [words, setWords] = useState(initial.brief);
  const [changing, setChanging] = useState(false);
  const [setting, setSetting] = useState(initialSetting);
  const [failed, setFailed] = useState<string | null>(null);
  const [turningOff, startTurnOff] = useTransition();
  const set = view.summary !== null;
  const showCard = set && !changing && !setting;

  const setUp = async () => {
    setSetting(true);
    setFailed(null);
    const result = await actions.set(advisorId, words);
    setSetting(false);
    if ('error' in result) {
      setFailed(result.error);
      return;
    }
    setView(result.view);
    setWords(result.view.brief || words.trim());
    setChanging(false);
  };

  const turnOff = () =>
    startTurnOff(async () => {
      setFailed(null);
      const result = await actions.turnOff(advisorId);
      if ('error' in result) {
        setFailed(result.error);
        return;
      }
      setView(result.view);
      setWords(result.view.brief);
    });

  // Said under the box: what went wrong, or what happens with no rule.
  const error = failed ?? (!set && !setting ? view.error : null);
  const note = !set && !error && !setting ? (view.brief ? `Turned off. ${name} texts when the daily round picks them.` : `With nothing here, ${name} texts when the daily round picks them.`) : null;

  return (
    <section id="person-reach-out" className="flex scroll-mt-4 flex-col gap-3">
      <div>
        <SectionLabel as="h2">Reaching out</SectionLabel>
      </div>
      {showCard ? (
        <Card padding="standard" className="flex flex-col gap-3 bg-sunken">
          <p className="text-body text-ink">{view.summary}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
            {view.next && (
              <>
                <dt className="text-ink-muted">Next text</dt>
                <dd className="text-ink">{nextTextWhen(view.next, { timeZone: timezone, now })}</dd>
              </>
            )}
            {view.cannotWatch.length > 0 && (
              <>
                <dt className="text-ink-muted">Not watched</dt>
                <dd className="text-ink">{view.cannotWatch.join('; ')}</dd>
              </>
            )}
          </dl>
          <p className="text-small text-ink-muted">{REACH_OUT_CAPS}</p>
          {failed && (
            <p role="alert" className="text-small text-danger">
              {failed}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Button type="button" variant="link" disabled={turningOff} onClick={() => setChanging(true)}>
              Change
            </Button>
            <Button type="button" variant="link" pending={turningOff} disabled={turningOff} onClick={turnOff}>
              Turn off
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Textarea /* ui-ok: a field of the person's form, not a composer */
            id="person-reach-out-brief"
            aria-label={`What ${name} texts you about`}
            rows={3}
            value={words}
            maxLength={REACH_OUT_LIMITS.brief}
            placeholder="Tell me about good-fit jobs every Monday, and never the same one twice."
            // Read-only rather than disabled while Dash works, so your words keep their ink.
            readOnly={setting}
            aria-busy={setting}
            onChange={(e) => setWords(e.target.value)}
          />
          {setting && (
            <p role="status" className="flex items-center gap-1.5 text-ui text-ink">
              <DashMark size="icon" tone="brand" state="working" decorative />
              Dash is setting it up…
            </p>
          )}
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          {note && <p className="text-small text-ink-muted">{note}</p>}
          {!setting && (
            <div className="flex flex-wrap items-center gap-2">
              <DashAction
                type="button"
                variant="secondary"
                paid="app/chat/actions.ts#setReachOut"
                what="Cost of setting it up"
                disabled={!words.trim()}
                onClick={() => void setUp()}
              >
                {error ? 'Try again' : 'Set it up'}
              </DashAction>
              {set && changing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setChanging(false);
                    setWords(view.brief);
                    setFailed(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
