'use client';

import { type Ref, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import { clockTime, embedUrl, playerTime, sectionProgress } from '@/lib/learn/youtube/format';

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

function subscribeNever() {
  return () => {};
}

/**
 * A YouTube video played in the page, from `start` to `end` when a clip has
 * them.
 *
 * The no-cookie embed `embedUrl` builds, so nothing is set by YouTube until
 * the video is played. `deferred` shows a button in the player's place and
 * loads the iframe only when it is pressed, for a page that would otherwise
 * load a player for every clip on it.
 *
 * A clip with both ends shows them under the player, with a bar for how far
 * through that section it is (note 6c13bd61), so you can tell when it is done.
 * The time is read from the messages the embed posts once told it is being
 * listened to, which needs the page's origin in the embed's address, so that
 * player is drawn only once the page is running in the browser.
 */
export function ClipPlayer({
  videoId,
  title,
  start = null,
  end = null,
  deferred = false,
  className,
}: {
  videoId: string;
  title: string;
  start?: number | null;
  end?: number | null;
  deferred?: boolean;
  className?: string;
}) {
  const [playing, setPlaying] = useState(!deferred);
  const span = clipSpan(start, end);

  if (!playing) {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
        <Button type="button" variant="secondary" size="sm" onClick={() => setPlaying(true)}>
          <Play className="size-3.5" strokeWidth={2} aria-hidden />
          {span ? `Watch ${span}` : 'Watch'}
        </Button>
        <span className="min-w-0 text-small break-words text-ink-muted">{title}</span>
      </div>
    );
  }

  const src = (origin: string | null) => {
    let url = embedUrl(videoId, start, end);
    if (origin) url += `&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
    // Autoplay only after a press: the press is the request to play.
    return deferred ? `${url}&autoplay=1` : url;
  };

  if (start === null || end === null || !sectionProgress(start, end, 0)) {
    return (
      <div className={cn('aspect-video w-full overflow-hidden rounded-card bg-sunken', className)}>
        <Embed key={`${videoId}-${start ?? ''}-${end ?? ''}`} src={src(null)} title={title} />
      </div>
    );
  }
  return (
    <SectionPlayer
      src={src}
      title={title}
      start={start}
      end={end}
      key={`${videoId}-${start}-${end}`}
      className={className}
    />
  );
}

/** A clip with both ends: the player, then where the section starts and ends and how far through it you are. */
function SectionPlayer({
  src,
  title,
  start,
  end,
  className,
}: {
  src: (origin: string | null) => string;
  title: string;
  start: number;
  end: number;
  className?: string;
}) {
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => null,
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const [time, setTime] = useState(start);
  const progress = sectionProgress(start, end, time)!;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== EMBED_ORIGIN || event.source !== frame.current?.contentWindow) return;
      const at = playerTime(event.data);
      if (at !== null) setTime(at);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const listen = () => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
      EMBED_ORIGIN,
    );
  };

  const left = clockTime(progress.length - progress.watched);
  return (
    <div className={className}>
      <div className="aspect-video w-full overflow-hidden rounded-card bg-sunken">
        {origin && <Embed ref={frame} src={src(origin)} title={title} onLoad={listen} />}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-small tabular-nums text-ink-muted">
        <span>{clockTime(start)}</span>
        <Meter
          value={progress.watched}
          max={progress.length}
          label={`${clockTime(progress.watched)} of ${clockTime(progress.length)} of this section watched`}
          fill={progress.done ? 'bg-positive' : 'bg-accent'}
          track="sunken"
          moves
          className="min-w-0 flex-1"
        />
        <span>{clockTime(end)}</span>
        <span className={cn('shrink-0', progress.done && 'font-medium text-ink')}>
          {progress.done ? 'Done' : `${left} left`}
        </span>
      </div>
    </div>
  );
}

function Embed({
  ref,
  src,
  title,
  onLoad,
}: {
  ref?: Ref<HTMLIFrameElement>;
  src: string;
  title: string;
  onLoad?: () => void;
}) {
  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      className="size-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={onLoad}
    />
  );
}

/** `12:04–18:30` for a clip, `from 12:04` for an open end, nothing for the whole video. */
export function clipSpan(start: number | null, end: number | null): string | null {
  if (start !== null && end !== null && end > start) return `${clockTime(start)}–${clockTime(end)}`;
  if (start !== null && start > 0) return `from ${clockTime(start)}`;
  return null;
}
