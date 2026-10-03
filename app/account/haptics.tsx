'use client';

import { useEffect, useState } from 'react';
import { cardVariants } from '@/components/ui/card';
import {
  canBuzz,
  canClick,
  clickOn,
  hapticsOn,
  setClickOn,
  setHapticsOn,
} from '@/components/motion/complete';

/**
 * The switches for the completion moment: the buzz (plan #1552) and the click
 * (plan #1553).
 *
 * Per device, like the notifications switch above them: each choice lives in
 * this browser's storage, and whether a phone buzzes or makes a sound is a
 * question about that phone. Both are read after mounting, since the server
 * cannot see either; the switches wait disabled until then rather than
 * showing a guess. A device that cannot do one of them, such as an iPhone for
 * the buzz, is told so instead of shown a switch that would do nothing. The
 * buzz is on until switched off and the click is off until switched on;
 * switching the click on plays it once, so the person hears what they chose.
 */
type Switch = 'loading' | 'unsupported' | 'on' | 'off';

export function FeelSection() {
  const [buzz, setBuzz] = useState<Switch>('loading');
  const [click, setClick] = useState<Switch>('loading');

  useEffect(() => {
    // Read once on mount: storage and the device APIs exist only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBuzz(!canBuzz() ? 'unsupported' : hapticsOn() ? 'on' : 'off');
    setClick(!canClick() ? 'unsupported' : clickOn() ? 'on' : 'off');
  }, []);

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Buzz and click</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        When you finish something, such as ticking off a todo or closing a goal, a phone that can
        vibrate gives one short buzz. You can add a soft click as well.
      </p>

      <div className="mt-4 divide-y divide-border border-y border-border">
        {buzz === 'unsupported' ? (
          <p className="row-pad text-small text-ink-muted">
            This device cannot vibrate for a web app, so finishing something here shows on screen
            only. iPhones are among these.
          </p>
        ) : (
          <FeelSwitch
            label="Buzz when I finish something"
            state={buzz}
            onChange={(on) => {
              setHapticsOn(on);
              setBuzz(on ? 'on' : 'off');
            }}
          />
        )}
        {click === 'unsupported' ? (
          <p className="row-pad text-small text-ink-muted">
            This browser cannot play sound for a web app, so there is no click here.
          </p>
        ) : (
          <FeelSwitch
            label="Click when I finish something"
            state={click}
            onChange={(on) => {
              setClickOn(on);
              setClick(on ? 'on' : 'off');
            }}
          />
        )}
      </div>
    </section>
  );
}

function FeelSwitch({
  label,
  state,
  onChange,
}: {
  label: string;
  state: Switch;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="row-pad flex items-start gap-3">
      <input
        type="checkbox"
        role="switch"
        checked={state === 'on'}
        disabled={state === 'loading'}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 accent-accent"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-medium text-ink">{label}</span>
        <span className="block text-small leading-snug text-ink-muted">On this device only.</span>
      </span>
    </label>
  );
}
