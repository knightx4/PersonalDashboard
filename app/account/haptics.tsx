'use client';

import { useEffect, useState } from 'react';
import { cardVariants } from '@/components/ui/card';
import { canBuzz, hapticsOn, setHapticsOn } from '@/components/motion/complete';

/**
 * The switch for the completion buzz (plan #1552).
 *
 * Per device, like the notifications switch above it: the choice lives in this
 * browser's storage, and whether a phone buzzes is a question about that
 * phone. Both are read after mounting, since the server cannot see either; the
 * switch waits disabled until then rather than showing a guess. A device that
 * cannot vibrate, which includes every iPhone, is told so instead of shown a
 * switch that would do nothing.
 *
 * The optional completion sound (plan #1553) belongs in this section too.
 */
export function FeelSection() {
  const [state, setState] = useState<'loading' | 'unsupported' | 'on' | 'off'>('loading');

  useEffect(() => {
    // Read once on mount: storage and the Vibration API exist only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(!canBuzz() ? 'unsupported' : hapticsOn() ? 'on' : 'off');
  }, []);

  function toggle(on: boolean) {
    setHapticsOn(on);
    setState(on ? 'on' : 'off');
  }

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Buzz</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        When you finish something, such as ticking off a todo or closing a goal, a phone that can
        vibrate gives one short buzz.
      </p>

      <div className="mt-4 border-y border-border">
        {state === 'unsupported' ? (
          <p className="row-pad text-small text-ink-muted">
            This device cannot vibrate for a web app, so finishing something here shows on screen
            only. iPhones are among these.
          </p>
        ) : (
          <label className="row-pad flex items-start gap-3">
            <input
              type="checkbox"
              role="switch"
              checked={state === 'on'}
              disabled={state === 'loading'}
              onChange={(event) => toggle(event.target.checked)}
              className="mt-1 size-4 accent-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-ui font-medium text-ink">
                Buzz when I finish something
              </span>
              <span className="block text-small leading-snug text-ink-muted">
                On this device only.
              </span>
            </span>
          </label>
        )}
      </div>
    </section>
  );
}
