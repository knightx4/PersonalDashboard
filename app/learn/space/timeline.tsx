'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { countText } from '@/lib/learn/map/view';
import { DAY_MS, type DayCounts } from '@/lib/learn/map/timeline';
import { whenDate } from '@/lib/core/when';

/**
 * The timeline under Idea Space (plan #1997.8): from the day of your first
 * idea to today, one step a day. Dragging it, or pressing play, replays how
 * ideas appeared and lit up; the line above it gives the counts for the day
 * shown. It stops at today: there is no looking ahead.
 *
 * The day is held by the map section, which relights the sky from it.
 */

const UTC = { timeZone: 'UTC' } as const;

/** A whole replay takes about this long, a day at a time within the bounds below. */
const REPLAY_MS = 8000;
const STEP_MS_MIN = 90;
const STEP_MS_MAX = 600;

export function MapTimeline({
  start,
  days,
  day,
  counts,
  onDay,
  touring = false,
}: {
  /** The first day, as milliseconds at midnight UTC. */
  start: number;
  /** Steps after the first; the last is today. */
  days: number;
  day: number;
  counts: DayCounts;
  onDay: (day: number) => void;
  /** The scripted tour is stepping the day, so a replay of its own would run beside it. */
  touring?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  // A tour that starts ends a replay of the timeline's own.
  const [wasTouring, setWasTouring] = useState(touring);
  if (touring !== wasTouring) {
    setWasTouring(touring);
    if (touring) setPlaying(false);
  }
  const dayRef = useRef(day);
  useEffect(() => {
    dayRef.current = day;
  }, [day]);

  useEffect(() => {
    if (!playing) return;
    const step = Math.min(Math.max(REPLAY_MS / Math.max(days, 1), STEP_MS_MIN), STEP_MS_MAX);
    const timer = setInterval(() => {
      const next = dayRef.current + 1;
      onDay(Math.min(next, days));
      if (next >= days) setPlaying(false);
    }, step);
    return () => clearInterval(timer);
  }, [playing, days, onDay]);

  const isToday = day >= days;
  const shown = isToday ? null : new Date(start + day * DAY_MS);
  const when = shown ? whenDate(shown, UTC) : 'Today';
  const play = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // From today, a replay starts again at the first day.
    if (isToday) onDay(0);
    setPlaying(true);
  };

  return (
    <div className="mb-2">
      <p className="text-ui text-ink" aria-live={playing ? 'off' : 'polite'}>
        <span className="font-medium">{when}</span>
        <span className="tabular text-ink-muted">
          {': '}
          {countText(counts.ideas)} {counts.ideas === 1 ? 'topic' : 'topics'}, {countText(counts.lit)} lit, average
          strength {Math.round(counts.averageStrength * 100)}%
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Tooltip label={playing ? 'Pause' : 'Replay how the map grew'} className="-ml-1.5 shrink-0">
          <IconButton label={playing ? 'Pause the replay' : 'Replay how the map grew'} onClick={play}>
            {playing ? <Pause strokeWidth={1.75} aria-hidden /> : <Play strokeWidth={1.75} aria-hidden />}
          </IconButton>
        </Tooltip>
        <span className="tabular shrink-0 text-small text-ink-muted">{whenDate(start, { ...UTC, year: 'never' })}</span>
        <input
          type="range"
          min={0}
          max={days}
          step={1}
          value={day}
          aria-label="Day the map shows"
          aria-valuetext={when}
          onChange={(event) => {
            setPlaying(false);
            onDay(Number(event.target.value));
          }}
          // ui-ok: the hit area is the 44px touch minimum, not a control height
          className="h-11 min-w-0 flex-1 cursor-pointer accent-accent"
        />
        <span className="shrink-0 text-small text-ink-muted">Today</span>
      </div>
    </div>
  );
}
