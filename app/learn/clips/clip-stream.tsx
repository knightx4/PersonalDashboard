'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bookmark, BookmarkCheck, ChevronDown, ExternalLink, Play, RotateCcw, ThumbsDown, Volume2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { clockTime, thumbnailUrl, watchAt } from '@/lib/learn/youtube/format';
import {
  appendClips,
  AUTOPLAY_GRACE_MS,
  isSwipeUp,
  leaveWrite,
  reachedEnd,
  shouldRefill,
  watchedSeconds,
  type Leave,
  type PlayerClip,
} from '@/lib/learn/clips/stream';
import {
  clipFinishedAction,
  clipNotInterestedAction,
  clipSavedAction,
  clipShownAction,
  clipSkippedAction,
  loadMoreClipsAction,
} from './actions';

/**
 * The clip stream (plan #1400): one YouTube player, one clip at a time.
 *
 * One player for the whole visit, created on the no-cookie host, and each
 * clip loaded into it with loadVideoById and its own start and end. Keeping
 * the one player is what gives a phone its best chance of playing the next
 * clip with sound after the first tap: a new iframe would be a new page as far
 * as the browser's autoplay rule is concerned.
 *
 * Whether that holds on a real phone is the open question on feature #1395.
 * So the page watches for it: a clip loaded after the first that has not
 * started playing within AUTOPLAY_GRACE_MS gets a tap-to-play cover, and one
 * that plays muted gets a tap-for-sound button. If a tap on the cover still
 * does not start it, the cover steps aside so the tap lands on YouTube's own
 * play button inside the frame.
 *
 * It is a card in Videos' Clips section (plan #1488) at every width, with
 * the shell and its top bar still showing (note 2f0f3ace). Only the frame the
 * video plays in is black. A time bar under it says how far into the clip
 * the player is and how long the clip runs (note 5868fbef). It can be
 * dragged to any point in the clip, and a button beside it goes back ten
 * seconds; the left and right arrow keys move five. Seeking stays inside the
 * clip's own start and end.
 */

// -- The parts of the YouTube IFrame API this uses ---------------------------
type YTPlayer = {
  loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  isMuted(): boolean;
  unMute(): void;
  destroy(): void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      host?: string;
      videoId?: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** How far the back button goes, and how far an arrow key moves. */
const BACK_SECONDS = 10;
const ARROW_SECONDS = 5;

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let apiPromise: Promise<YTNamespace> | null = null;

/** Load YouTube's player script once per page. */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** Fire a write and let the clip play on; say so only if it failed. */
function quietly(write: Promise<unknown>, onFail: () => void) {
  write.catch((error: unknown) => {
    console.error('[clips]', error instanceof Error ? error.message : error);
    onFail();
  });
}

type Cover = 'start' | 'tap' | 'sound' | null;

export function ClipStream({
  initial,
  startedAt,
  fixed = false,
}: {
  initial: PlayerClip[];
  startedAt: string;
  /** The surface gallery's: play only the clips given and fetch no more, since it has no session. */
  fixed?: boolean;
}) {
  const toast = useToast();
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [cover, setCover] = useState<Cover>('start');
  const [letThrough, setLetThrough] = useState(false);
  const [paused, setPaused] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  /** Seconds into the clip the player holds, for the time bar. */
  const [elapsed, setElapsed] = useState(0);
  /** True while the time bar is held, so the player's clock does not pull it back under the finger. */
  const scrubbing = useRef(false);

  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  /** The clip the player holds, and whether it has started playing and finished. */
  const live = useRef<{ clip: PlayerClip | null; shown: boolean; done: boolean }>({ clip: null, shown: false, done: false });
  /** A fetch for more in flight. A ref, since only the fetch effect reads it. */
  const loading = useRef(false);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set by the first tap. A ref for the player's callbacks, state for what is drawn. */
  const started = useRef(false);
  const [begun, setBegun] = useState(false);

  const current: PlayerClip | undefined = queue[index];
  const upNext: PlayerClip | undefined = queue[index + 1];
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const markStarted = useCallback(() => {
    started.current = true;
    setBegun(true);
    setCover(null);
  }, []);

  const failed = useCallback((text: string) => toast({ text }), [toast]);

  // -- Leaving a clip --------------------------------------------------------
  const leave = useCallback(
    (how: Leave) => {
      const { clip, shown } = live.current;
      if (!clip) return;
      const time = player.current && ready.current ? player.current.getCurrentTime() : null;
      const write = leaveWrite(clip, how, { shown, currentTime: time });
      if (write?.kind === 'finished') quietly(clipFinishedAction(clip.id, write.watched), () => undefined);
      if (write?.kind === 'skipped') quietly(clipSkippedAction(clip.id, write.watched), () => undefined);
      live.current = { clip: null, shown: false, done: true };
      setElapsed(0);
      setIndex((i) => i + 1);
    },
    [],
  );

  // -- Playing a clip --------------------------------------------------------
  const armGrace = useCallback(() => {
    if (graceTimer.current) clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => {
      const state = player.current?.getPlayerState();
      if (state !== STATE.PLAYING && state !== STATE.BUFFERING) setCover('tap');
    }, AUTOPLAY_GRACE_MS);
  }, []);

  const play = useCallback(
    (clip: PlayerClip) => {
      if (!player.current || !ready.current) return;
      live.current = { clip, shown: false, done: false };
      setPaused(false);
      setElapsed(0);
      player.current.loadVideoById({ videoId: clip.videoId, startSeconds: clip.startSeconds, endSeconds: clip.endSeconds });
      armGrace();
    },
    [armGrace],
  );

  const onState = useCallback(
    (state: number) => {
      const { clip } = live.current;
      if (!clip) return;
      if (state === STATE.PLAYING) {
        if (graceTimer.current) clearTimeout(graceTimer.current);
        setPaused(false);
        setLetThrough(false);
        setCover(player.current?.isMuted() ? 'sound' : null);
        if (!live.current.shown) {
          live.current.shown = true;
          quietly(clipShownAction(clip.id), () => undefined);
        }
      } else if (state === STATE.PAUSED) {
        setPaused(true);
      } else if (state === STATE.ENDED && live.current.shown && !live.current.done) {
        live.current.done = true;
        leave('ended');
      }
    },
    [leave],
  );

  // Create the one player.
  useEffect(() => {
    let cancelled = false;
    const first = initial[0];
    if (!first || !mount.current) return;
    const target = document.createElement('div');
    mount.current.appendChild(target);
    loadApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(target, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, modestbranding: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => {
            ready.current = true;
            const now = currentRef.current;
            // Tapped before the player was ready: play what is in the slot.
            if (started.current && now) return play(now);
            // Cued rather than loaded: nothing plays until the first tap asks it to.
            player.current?.cueVideoById({ videoId: first.videoId, startSeconds: first.startSeconds, endSeconds: first.endSeconds });
          },
          onStateChange: (event) => onState(event.data),
          // A clip that cannot be embedded or was taken down: move on rather than sit on an error.
          onError: () => {
            if (live.current.clip) leave('next');
          },
        },
      });
    });
    return () => {
      cancelled = true;
      if (graceTimer.current) clearTimeout(graceTimer.current);
      player.current?.destroy();
      player.current = null;
      ready.current = false;
    };
    // The player is made once; later clips are loaded into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new clip in the slot: load it, once the first tap has been made.
  useEffect(() => {
    if (!begun || !current) return;
    if (live.current.clip?.id === current.id) return;
    play(current);
  }, [begun, current, play]);

  // Move the time bar on, and move on from a clip whose end the player stops short of.
  useEffect(() => {
    const timer = setInterval(() => {
      const { clip, shown, done } = live.current;
      if (!clip || !shown || done || !player.current) return;
      const time = player.current.getCurrentTime();
      if (!scrubbing.current) setElapsed(watchedSeconds(clip, time));
      if (player.current.getPlayerState() !== STATE.PLAYING) return;
      if (reachedEnd(clip, time)) {
        live.current.done = true;
        player.current.pauseVideo();
        leave('ended');
      }
    }, 250);
    return () => clearInterval(timer);
  }, [leave]);

  // Keep the queue topped up, and fetch the next clip's still so it shows at once.
  useEffect(() => {
    if (upNext) new Image().src = thumbnailUrl(upNext.videoId);
    if (fixed || !shouldRefill(queue.length, index, { loading: loading.current, exhausted })) return;
    loading.current = true;
    loadMoreClipsAction(
      startedAt,
      queue.map((clip) => clip.id),
    )
      .then((more) => {
        if (more.length === 0) setExhausted(true);
        setQueue((q) => appendClips(q, more));
      })
      .catch((error: unknown) => console.error('[clips] loading more', error instanceof Error ? error.message : error))
      .finally(() => {
        loading.current = false;
      });
  }, [queue, index, exhausted, startedAt, upNext, fixed]);

  // -- What the person does ---------------------------------------------------
  const begin = useCallback(() => {
    if (!current) return;
    if (!started.current) {
      markStarted();
      play(current);
      // Inside the tap, so it counts as the person asking.
      player.current?.playVideo();
      return;
    }
    if (cover === 'tap') {
      player.current?.playVideo();
      setCover(null);
      // Still nothing: let the next tap reach YouTube's own button.
      setTimeout(() => {
        const state = player.current?.getPlayerState();
        if (state !== STATE.PLAYING && state !== STATE.BUFFERING) setLetThrough(true);
      }, 1200);
    }
  }, [cover, current, markStarted, play]);

  const togglePause = useCallback(() => {
    if (!started.current || cover) return begin();
    if (!player.current) return;
    if (player.current.getPlayerState() === STATE.PLAYING) player.current.pauseVideo();
    else player.current.playVideo();
  }, [begin, cover]);

  const next = useCallback(() => {
    if (!current) return;
    if (!started.current) markStarted();
    if (live.current.clip) leave('next');
    else setIndex((i) => i + 1);
  }, [current, leave, markStarted]);

  const notInterested = useCallback(() => {
    if (!current) return;
    quietly(clipNotInterestedAction(current.id), () => failed('Could not mark that clip. It may come back.'));
    if (!started.current) markStarted();
    if (live.current.clip) leave('not-interested');
    else setIndex((i) => i + 1);
  }, [current, failed, leave, markStarted]);

  const toggleSave = useCallback(() => {
    if (!current) return;
    const saved = !current.saved;
    const id = current.id;
    setQueue((q) => q.map((clip) => (clip.id === id ? { ...clip, saved } : clip)));
    quietly(clipSavedAction(id, saved), () => {
      setQueue((q) => q.map((clip) => (clip.id === id ? { ...clip, saved: !saved } : clip)));
      failed(saved ? 'Could not save that clip.' : 'Could not unsave that clip.');
    });
  }, [current, failed]);

  /** Move to `seconds` into the clip, kept inside it. Only once the clip has started playing. */
  const seek = useCallback((seconds: number) => {
    const { clip, shown, done } = live.current;
    if (!clip || !shown || done || !player.current) return;
    const at = Math.min(clip.endSeconds - clip.startSeconds, Math.max(0, seconds));
    setElapsed(at);
    player.current.seekTo(clip.startSeconds + at, true);
  }, []);

  const nudge = useCallback(
    (by: number) => {
      const { clip } = live.current;
      if (!clip || !player.current) return;
      seek(watchedSeconds(clip, player.current.getCurrentTime()) + by);
    },
    [seek],
  );

  const unmute = useCallback(() => {
    player.current?.unMute();
    setCover(null);
  }, []);

  // ArrowDown or j for the next clip, space or k to pause, ArrowLeft and ArrowRight to move back and on.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault();
        next();
      } else if (event.key === ' ' || event.key === 'k') {
        event.preventDefault();
        togglePause();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        nudge(event.key === 'ArrowLeft' ? -ARROW_SECONDS : ARROW_SECONDS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, togglePause, nudge]);

  // Swipe up anywhere on the stage.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    if (point) touch.current = { x: point.clientX, y: point.clientY, t: Date.now() };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touch.current;
    const point = event.changedTouches[0];
    touch.current = null;
    if (!start || !point) return;
    if (isSwipeUp(point.clientX - start.x, point.clientY - start.y, Date.now() - start.t)) next();
  };

  const length = current ? Math.max(0, current.endSeconds - current.startSeconds) : 0;

  return (
    <div className={cn(cardVariants(), 'flex flex-col overflow-hidden text-ink')}>
      {/* The stage: the video in a black frame, a reading column wide from lg up. */}
      <div className="relative touch-none bg-black text-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="relative mx-auto aspect-video w-full lg:max-w-3xl">
          <div ref={mount} className="absolute inset-0 [&>iframe]:size-full" />
          {current && !letThrough && (
            // The layer that takes taps and swipes over the frame, which would
            // otherwise swallow them.
            <button
              type="button"
              onClick={cover === 'sound' ? unmute : togglePause}
              className="absolute inset-0 flex items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2"
              aria-label={!begun || cover === 'tap' ? 'Play' : paused ? 'Resume' : 'Pause'}
            >
              {(cover === 'start' || cover === 'tap') && (
                <>
                  {cover === 'start' && (
                    // The still under the first cover, until the frame has loaded behind it.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnailUrl(current.videoId)}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                      className="absolute inset-0 size-full object-cover opacity-60"
                    />
                  )}
                  <span className="relative flex size-16 items-center justify-center rounded-full bg-white/15">
                    <Play className="size-7 translate-x-0.5" strokeWidth={2} aria-hidden />
                  </span>
                </>
              )}
              {cover === 'sound' && (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-ui font-medium">
                  <Volume2 className="size-4" strokeWidth={2} aria-hidden />
                  Tap for sound
                </span>
              )}
              {paused && !cover && (
                <span className="flex size-16 items-center justify-center rounded-full bg-black/60">
                  <Play className="size-7 translate-x-0.5" strokeWidth={2} aria-hidden />
                </span>
              )}
            </button>
          )}
        </div>

        {!current && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-body font-semibold">{exhausted || fixed ? 'That is every clip for now' : 'Finding the next clip…'}</p>
            {(exhausted || fixed) && (
              <p className="max-w-sm text-ui text-white/80">
                Dash cuts more from your videos a few times a day.{' '}
                <Link href="/learn/now" className="underline underline-offset-2 hover:text-white">
                  Go to Now
                </Link>
              </p>
            )}
          </div>
        )}
      </div>

      {/* How far into the clip, how long it runs, what it says, where it is from, and what you can do with it. */}
      {current && (
        <div className="space-y-3 card-pad-x pt-3 pb-4 lg:pb-5">
          <div className="flex items-center gap-2 text-small tabular-nums text-ink-muted">
            <button
              type="button"
              onClick={() => nudge(-BACK_SECONDS)}
              disabled={!begun}
              aria-label={`Back ${BACK_SECONDS} seconds`}
              title={`Back ${BACK_SECONDS} seconds`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2.5 shrink-0 px-2')}
            >
              <RotateCcw className="size-4" strokeWidth={2} aria-hidden />
            </button>
            <span>{clockTime(elapsed)}</span>
            <input
              type="range"
              min={0}
              max={length}
              step={1}
              value={Math.round(elapsed)}
              disabled={!begun}
              aria-label="Time in clip"
              aria-valuetext={`${clockTime(elapsed)} of ${clockTime(length)}`}
              onPointerDown={() => {
                scrubbing.current = true;
              }}
              onChange={(event) => {
                const at = Number(event.target.value);
                // A drag shows where it is going and seeks when let go; a key or a tap seeks at once.
                if (scrubbing.current) setElapsed(at);
                else seek(at);
              }}
              onPointerUp={(event) => {
                scrubbing.current = false;
                seek(Number(event.currentTarget.value));
              }}
              onPointerCancel={() => {
                scrubbing.current = false;
              }}
              className="h-6 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default"
            />
            <span>{clockTime(length)}</span>
          </div>
          <div className="min-w-0">
            <p className="text-body font-semibold text-pretty">{current.caption}</p>
            <p className="mt-1 truncate text-small text-ink-muted">
              {[current.title, current.channel].filter(Boolean).join(' · ') || 'YouTube'}
              <span className="tabular-nums"> · {clockTime(current.startSeconds)}–{clockTime(current.endSeconds)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={watchAt(current.videoId, current.startSeconds)}
              target="_blank"
              rel="noreferrer"
              className={stageButton}
            >
              <ExternalLink className="size-4" strokeWidth={2} aria-hidden />
              Full video at {clockTime(current.startSeconds)}
            </a>
            <button type="button" onClick={toggleSave} aria-pressed={current.saved} className={stageButton}>
              {current.saved ? (
                <BookmarkCheck className="size-4" strokeWidth={2} aria-hidden />
              ) : (
                <Bookmark className="size-4" strokeWidth={2} aria-hidden />
              )}
              {current.saved ? 'Saved' : 'Save'}
            </button>
            <button type="button" onClick={notInterested} className={stageButton}>
              <ThumbsDown className="size-4" strokeWidth={2} aria-hidden />
              Not interested
            </button>
            <button type="button" onClick={next} className={cn(stageButton, 'ml-auto')}>
              Next
              <ChevronDown className="size-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A button under the stage: the ordinary secondary button, tinted while pressed. */
const stageButton = cn(
  buttonVariants({ variant: 'secondary' }),
  'aria-pressed:bg-accent-tint aria-pressed:text-accent',
);
