'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import NextLink from 'next/link';
import { LinkPending } from '@/components/ui/link-pending';
import { TONE_TEXT } from '@/components/dev/state-label';
import { DashMark } from '@/components/ui/dash-mark';
import { popoverSurface } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { moveLabel } from '@/lib/core/move';
import { previewRef } from '@/lib/core/ref-preview-actions';
import type { RefPreview } from '@/lib/core/ref-preview';

/**
 * A link to a row that shows what it is before it is followed (plan #1931.4;
 * docs/ONE-INTERFACE-SPEC.md, Part 2, "A preview").
 *
 * Hovering it from laptop width, or holding it on a phone, shows a panel
 * with the row's title line and whose move it is. The answer comes from one
 * server action and is kept per key for the page, so the second hover shows
 * at once. The read starts as the pointer arrives, before the panel's short
 * delay, so a first hover is answered in about the time the delay takes.
 *
 * A tap is still a tap: only a hold opens the panel on a phone, and the
 * press that follows a hold does not also follow the link. The panel holds
 * nothing to press, so it is a tooltip to assistive technology, described
 * by the link while it shows.
 */

/** How long a pointer rests on the link before the panel shows. */
export const PREVIEW_DELAY_MS = 150;
/** How long a finger holds the link before the panel shows. */
export const HOLD_MS = 450;

const WIDE_HOVER = '(hover: hover) and (min-width: 1024px)';

/**
 * The answers, per key, for the page they were asked on. A new page starts a
 * new cache, since a row's move may have changed by the time it is reached.
 */
let cachePage = '';
const cache = new Map<string, Promise<RefPreview | null>>();

function ask(key: string): Promise<RefPreview | null> {
  const page = typeof window === 'undefined' ? '' : window.location.pathname;
  if (page !== cachePage) {
    cache.clear();
    cachePage = page;
  }
  let answer = cache.get(key);
  if (!answer) {
    answer = previewRef(key).catch(() => null);
    cache.set(key, answer);
  }
  return answer;
}

export function RefLink({
  href,
  previewKey,
  children,
  className,
  title,
  defaultOpen = false,
  initial,
}: {
  href: string;
  /** What to preview: a ref, `schema.table:id`, or a step as `#1490.11`. */
  previewKey: string;
  children: ReactNode;
  className?: string;
  /** The native hover text, for where the panel cannot show. */
  title?: string;
  /**
   * Start showing, with `initial` as the answer and nothing asked of the
   * server; `initial` left out holds it loading. For the preview gallery.
   */
  defaultOpen?: boolean;
  initial?: RefPreview | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [preview, setPreview] = useState<RefPreview | null | undefined>(initial);
  const fixed = defaultOpen;
  const panelRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const tipId = useId();

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  const load = useCallback(() => {
    if (fixed) return;
    void ask(previewKey).then(setPreview);
  }, [fixed, previewKey]);

  const showAfter = (ms: number, onShow?: () => void) => {
    cancel();
    load();
    timer.current = setTimeout(() => {
      timer.current = null;
      onShow?.();
      setOpen(true);
    }, ms);
  };
  const hide = () => {
    cancel();
    setOpen(false);
  };

  // A panel opened by a hold closes on the next press anywhere else.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  // Kept inside the text the link sits in, and never nearer the screen's
  // edge than the 16px gutter: a panel that runs past the column its words
  // are set in looks dropped onto the page rather than hung from the link.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    panel.style.translate = '';
    const gutter = 16;
    const room = document.documentElement.clientWidth;
    const column = wrapRef.current?.parentElement?.closest('p, li, div')?.getBoundingClientRect();
    const right = Math.min(room - gutter, column ? column.right : room - gutter);
    const left = Math.max(gutter, column ? column.left : gutter);
    // Never wider than the column it has to fit in (max-w-72 otherwise).
    panel.style.maxWidth = `${Math.min(288, Math.max(160, right - left))}px`;
    const rect = panel.getBoundingClientRect();
    let shift = Math.min(0, right - rect.right);
    if (rect.left + shift < left) shift = left - rect.left;
    if (shift !== 0) panel.style.translate = `${shift}px 0`;
  }, [open, preview]);

  return (
    <span
      ref={wrapRef}
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && window.matchMedia(WIDE_HOVER).matches) {
          showAfter(PREVIEW_DELAY_MS);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') hide();
      }}
      onPointerDown={(event) => {
        held.current = false;
        if (event.pointerType === 'mouse') {
          hide();
          return;
        }
        showAfter(HOLD_MS, () => {
          held.current = true;
        });
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== 'mouse' && timer.current) cancel();
      }}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          hide();
        }
      }}
    >
      <NextLink
        href={href}
        className={cn('[-webkit-touch-callout:none]', className)}
        title={open ? undefined : title}
        aria-describedby={open ? tipId : undefined}
        onClick={(event) => {
          // The press that ends a hold opened the panel; it does not also
          // leave the page.
          if (held.current) {
            event.preventDefault();
            held.current = false;
          }
        }}
        onContextMenu={(event) => {
          if (held.current || timer.current) event.preventDefault();
        }}
      >
        {children}
        <LinkPending href={href} />
      </NextLink>
      {open && (
        // A span, not Popover's div: the link sits inside a paragraph, where
        // a div is not allowed. The same surface, hung the same way.
        <span
          ref={panelRef}
          id={tipId}
          role="tooltip"
          className={cn(
            popoverSurface,
            'absolute left-0 top-full z-overlay mt-1.5 block w-max min-w-48 max-w-72 px-3 py-2',
            'whitespace-normal text-left font-normal not-italic',
          )}
        >
          <PreviewBody preview={preview} name={typeof children === 'string' ? children : undefined} />
        </span>
      )}
    </span>
  );
}

/** The panel's contents: the title line, then the move, or a line while it loads. */
export function PreviewBody({
  preview,
  name,
}: {
  preview: RefPreview | null | undefined;
  /** What the link says, such as `#1204`, to name a row that has gone. */
  name?: string;
}) {
  if (preview === undefined) {
    return (
      <span className="block py-0.5" aria-label="Loading">
        <span className="block h-3 w-40 animate-pulse rounded-control bg-border" />
        <span className="mt-2 block h-3 w-16 animate-pulse rounded-control bg-border" />
      </span>
    );
  }
  if (preview === null || preview.missing) {
    return (
      <span className="block text-small text-ink-muted">
        {name ? `${name} is no longer there.` : 'No longer there.'}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1.5">
      <span className="line-clamp-2 text-ui text-ink">
        {preview.label && <span className="mr-1.5 text-ink-muted tabular-nums">{preview.label}</span>}
        {preview.title}
      </span>
      {preview.move && <MoveWord preview={preview} />}
    </span>
  );
}

/**
 * The move as a word in its tone, as MoveLabel draws it, without MoveLabel's
 * own tooltip: this already is one, and a tip inside a tip has nowhere to go.
 */
function MoveWord({ preview }: { preview: RefPreview }) {
  if (!preview.move) return null;
  const label = moveLabel(preview.move);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-small', TONE_TEXT[label.tone])}
      title={preview.moveTitle ?? label.title}
    >
      {label.state === 'dash_working' && <DashMark state="working" size="2xs" decorative />}
      <span>{label.word}</span>
    </span>
  );
}
