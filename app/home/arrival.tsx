'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/components/ui/motion';
import { Sigil } from '@/components/ui/sigil';
import {
  ARRIVE_LAST_STEP,
  HOME_ARRIVED_COOKIE,
  HOME_SIGIL_COOKIE,
  seenCookie,
} from '@/lib/home/first-visit';

/**
 * The days this tab has already played each moment on. The cookie stops a
 * fresh load replaying it; this stops a back button replaying it, since the
 * page it restores still says "first visit" from when it was rendered.
 */
const played: Record<string, string | undefined> = {};

/**
 * Writes today into the cookie once the page is up, so the next visit today
 * arrives at rest. The gallery's demo passes `remember` false, so playing it
 * does not change what Home does.
 */
function useSeenToday(name: string, day: string, remember: boolean) {
  useEffect(() => {
    if (!remember) return;
    played[name] = day;
    try {
      document.cookie = seenCookie(name, day);
    } catch {
      // A browser refusing cookies plays the moment on every visit, which is
      // the lesser failure.
    }
  }, [name, day, remember]);
}

/**
 * Home arriving in order on the first visit of the day (plan #1558): the
 * greeting, the date, the brief and then the rest of the column each rise
 * in a quick beat after the one before. The parts carry `data-arrive` with
 * their place in the sequence as `--arrive`; `home-arrive` in app/globals.css
 * plays them. The server decides from the cookie, so the class is in the
 * first byte of HTML and nothing is drawn at rest before it starts. Later
 * visits that day render without the class, and under reduced motion the
 * stylesheet stops it, so everything is there at once.
 */
export function HomeArrival({
  arrive,
  day,
  className,
  remember = true,
  children,
}: {
  /** The server read no visit today from the cookie. */
  arrive: boolean;
  /** Today, in the account's timezone. */
  day: string;
  className?: string;
  /** Record the visit, so later ones today arrive at rest. Off in the gallery. */
  remember?: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const [playing, setPlaying] = useState(() => arrive && played[HOME_ARRIVED_COOKIE] !== day);
  useSeenToday(HOME_ARRIVED_COOKIE, day, remember);

  return (
    <div
      className={cn(playing && !reduceMotion && 'home-arrive', className)}
      // The last step landing ends it. An event rather than a timer, so a
      // recording slowed to a quarter speed still sees the whole of it.
      onAnimationEnd={(event) => {
        if (event.animationName !== 'home-arrive') return;
        const target = event.target as HTMLElement;
        if (target.dataset.arrive === String(ARRIVE_LAST_STEP)) setPlaying(false);
      }}
    >
      {children}
    </div>
  );
}

/**
 * The day's sigil beside the date once everything due today is done (plan
 * #1558). The same mark the agenda draws when the day closes, from the same
 * seed. The first time Home shows it on a day it draws in; after that it is
 * simply there.
 */
export function DaySigil({
  seed,
  draw,
  day,
  remember = true,
}: {
  seed: string;
  /** The server read no sigil shown today from the cookie. */
  draw: boolean;
  day: string;
  /** Record that it was shown, so it is at rest for the rest of the day. Off in the gallery. */
  remember?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [drawing, setDrawing] = useState(() => draw && played[HOME_SIGIL_COOKIE] !== day);
  useSeenToday(HOME_SIGIL_COOKIE, day, remember);

  return (
    <span
      className={cn('flex shrink-0 items-center', drawing && !reduceMotion && 'sigil-draw-in')}
      title="Everything due today is done"
      onAnimationEnd={(event) => {
        if (event.animationName !== 'sigil-cell') return;
        const cells = event.currentTarget.querySelectorAll('[data-sigil-cell]');
        if (event.target === cells[cells.length - 1]) setDrawing(false);
      }}
    >
      <Sigil seed={seed} size={36} className="text-accent" />
      <span className="sr-only">Everything due today is done.</span>
    </span>
  );
}
