'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bookmark, BookmarkCheck, ChevronDown, ExternalLink, Play, ThumbsDown, Volume2, X } from 'lucide-react';
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
 * Below lg it covers the whole screen, shell included, with a close button
 * back to Learn now. From lg up it sits in the page pane.
 */

// -- The parts of the YouTube IFrame API this uses ---------------------------
type YTPlayer = {
  loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
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

  // A clip whose end the player stops short of still moves on.
  useEffect(() => {
    const timer = setInterval(() => {
      const { clip, shown, done } = live.current;
      if (!clip || !shown || done || !player.current) return;
      if (player.current.getPlayerState() !== STATE.PLAYING) return;
      if (reachedEnd(clip, player.current.getCurrentTime())) {
        live.current.done = true;
        player.current.pauseVideo();
        leave('ended');
      }
    }, 500);
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

  const unmute = useCallback(() => {
    player.current?.unMute();
    setCover(null);
  }, []);

  // ArrowDown or j for the next clip, space or k to pause.
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, togglePause]);

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

  return (
    <div
      className={cn(
        'fixed inset-0 z-overlay flex flex-col bg-black text-white',
        'lg:static lg:h-[calc(100dvh-10rem)] lg:min-h-[32rem] lg:overflow-hidden lg:rounded-card',
      )}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Top: the way out, on a phone where the shell is covered. */}
      <div className="flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 lg:hidden">
        <Link
          href="/learn/now"
          className="press flex size-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" strokeWidth={2} aria-hidden />
          <span className="sr-only">Close clips</span>
        </Link>
        <span className="text-ui font-semibold">Clips</span>
      </div>

      {/* The stage: the video letterboxed in whatever height is left. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative aspect-video max-h-full w-full">
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
              <p className="max-w-sm text-ui text-white/70">
                Dash cuts more from your videos a few times a day.{' '}
                <Link href="/learn/now" className="underline underline-offset-2 hover:text-white">
                  Go to Now
                </Link>
              </p>
            )}
          </div>
        )}
      </div>

      {/* What the clip says, where it is from, and what you can do with it. */}
      {current && (
        <div className="space-y-3 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:px-6 lg:pb-5">
          <div className="min-w-0">
            <p className="text-body font-semibold text-pretty">{current.caption}</p>
            <p className="mt-1 truncate text-small text-white/70">
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

/** A button on the black stage: no frame, a light wash, white ink. */
const stageButton =
  'press inline-flex h-(--control-h) items-center gap-1.5 rounded-control bg-white/10 px-3 text-ui font-medium text-white ' +
  'transition-colors duration-150 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 aria-pressed:bg-white/25';
