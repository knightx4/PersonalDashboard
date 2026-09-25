'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { clockTime, embedUrl } from '@/lib/learn/youtube/format';

/**
 * A YouTube video played in the page, from `start` to `end` when a clip has
 * them.
 *
 * The no-cookie embed `embedUrl` builds, so nothing is set by YouTube until
 * the video is played. `deferred` shows a button in the player's place and
 * loads the iframe only when it is pressed. Learn now uses it because a deck
 * preloads the cards behind the one on screen, and an iframe each would load
 * a YouTube player for every card nobody watches.
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

  return (
    <div className={cn('aspect-video w-full overflow-hidden rounded-card bg-sunken', className)}>
      <iframe
        key={`${videoId}-${start ?? ''}-${end ?? ''}`}
        // Autoplay only after a press: the press is the request to play.
        src={deferred ? `${embedUrl(videoId, start, end)}&autoplay=1` : embedUrl(videoId, start, end)}
        title={title}
        className="size-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

/** `12:04–18:30` for a clip, `from 12:04` for an open end, nothing for the whole video. */
export function clipSpan(start: number | null, end: number | null): string | null {
  if (start !== null && end !== null && end > start) return `${clockTime(start)}–${clockTime(end)}`;
  if (start !== null && start > 0) return `from ${clockTime(start)}`;
  return null;
}
