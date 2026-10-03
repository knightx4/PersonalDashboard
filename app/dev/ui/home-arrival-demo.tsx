'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DaySigil, HomeArrival } from '@/app/home/arrival';
import { ARRIVE_LAST_STEP, arriveAt } from '@/lib/home/first-visit';

const DUE = ['Return the kettle', 'Book the dentist'];

/**
 * Home's two moments (HomeArrival and DaySigil in app/home/arrival.tsx), on
 * demand: "Open Home" plays the first visit of the day, with the greeting,
 * the date, the brief and Today rising one after another, and "Finish the
 * day" draws the day's sigil in beside the date. Neither writes the cookie
 * Home reads, so playing them here changes nothing on Home. Under reduced
 * motion both are simply there.
 */
export function HomeArrivalDemo({ finished: startFinished = false }: { finished?: boolean }) {
  const [visit, setVisit] = useState(0);
  const [finished, setFinished] = useState(startFinished);
  const [drawn, setDrawn] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          data-motion-demo="home-arrival"
          onClick={() => setVisit((n) => n + 1)}
        >
          Open Home
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-motion-demo="home-finished"
          onClick={() => {
            if (!finished) setDrawn((n) => n + 1);
            setFinished(!finished);
          }}
        >
          {finished ? 'Reopen the day' : 'Finish the day'}
        </Button>
      </div>
      <HomeArrival key={visit} arrive={visit > 0} day={`demo-${visit}`} remember={false}>
        <p data-arrive="" style={arriveAt(0)} className="text-ui text-ink-muted">
          Good morning, Sam
        </p>
        <div
          data-arrive=""
          style={arriveAt(1)}
          className="mt-1 flex items-center justify-between gap-4"
        >
          <p className="font-display text-figure-lg font-semibold tracking-[-0.04em] text-ink">
            Saturday 3 October
          </p>
          {finished && (
            <DaySigil
              key={drawn}
              seed="dev-ui:home-day"
              draw={drawn > 0}
              day={`demo-${drawn}`}
              remember={false}
            />
          )}
        </div>
        <p data-arrive="" style={arriveAt(2)} className="mt-3 text-ui text-ink-muted">
          {finished
            ? 'Everything due today is done.'
            : 'Two things are due today, and the dentist closes at five.'}
        </p>
        <div data-arrive="" style={arriveAt(ARRIVE_LAST_STEP)}>
          {!finished && (
            <Card padding="standard" className="mt-4">
              <p className="text-ui font-semibold text-ink">Today</p>
              <ul className="mt-2 divide-y divide-border">
                {DUE.map((title) => (
                  <li key={title} className="row-pad text-ui text-ink">
                    {title}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </HomeArrival>
    </div>
  );
}
