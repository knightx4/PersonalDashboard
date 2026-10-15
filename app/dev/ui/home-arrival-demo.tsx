'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { DaySigil } from '@/app/home/arrival';
import { HomeFold } from '@/app/home/home-fold';
import {
  BriefLine,
  HomeColumns,
  HomeHeader,
  InboxLine,
  TodayList,
  type TodayDue,
} from '@/app/home/home-view';
import type { ModuleId } from '@/lib/modules';

const DUE: TodayDue[] = [
  { key: 'a', overdue: false, title: 'Return the kettle', href: '/todo' },
  { key: 'b', overdue: true, title: 'Book the dentist', href: '/todo' },
];

const BRIEFS: [ModuleId, string][] = [
  ['todo', 'Two tasks are open, and booking the dentist is overdue.'],
  ['jobs', 'The Northgate interview is on Tuesday at 10:30, and the take-home is due Monday.'],
  ['shopping', 'Nothing is running low.'],
];

/**
 * Home's two moments (HomeArrival and DaySigil in app/home/arrival.tsx), on
 * demand: "Open Home" plays the first visit of the day, with the greeting,
 * the date, the panel holding the brief, then its rows and the Inbox count
 * with the rail rising one after another, and "Finish the
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
      <HomeColumns
        key={visit}
        arrive={visit > 0}
        day={`demo-${visit}`}
        remember={false}
        header={
          <HomeHeader
            greeting="Good morning, Sam"
            date="Saturday 3 October"
            sigil={
              finished ? (
                <DaySigil
                  key={drawn}
                  seed="dev-ui:home-day"
                  draw={drawn > 0}
                  day={`demo-${drawn}`}
                  remember={false}
                />
              ) : null
            }
          />
        }
        brief={
          <p className="text-body text-ink">
            {finished
              ? 'Everything due today is done.'
              : 'Two things are due today, and the dentist closes at five.'}
          </p>
        }
        main={
          <>
            <ul className="divide-y divide-border">
              {BRIEFS.map(([module, text]) => (
                <BriefLine
                  key={module}
                  module={module}
                  brief={{ text: module === 'todo' && finished ? 'Both tasks are done.' : text }}
                />
              ))}
            </ul>
            <div className="mt-2">
              <InboxLine count={3} />
            </div>
          </>
        }
        rail={
          <>
            {/* Today folds away as the day closes, so Watching slides up
                rather than jumping. On the page itself the fold is simply left
                out of a day with nothing due. */}
            <div
              aria-hidden={finished}
              inert={finished}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-move ease-out-soft motion-reduce:transition-none',
                finished ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <HomeFold id="today" title="Today" count={DUE.length}>
                  <TodayList happening={[]} due={DUE} more={0} timezone="Europe/London" />
                </HomeFold>
              </div>
            </div>
            <HomeFold id="watching" title="Watching" count={1}>
              <p className="text-ui text-ink-muted">The boiler quote, due Friday</p>
            </HomeFold>
          </>
        }
      />
    </div>
  );
}
