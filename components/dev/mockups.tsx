'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { scrim } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { loadQuestionMockups } from '@/app/dev/plan/mockup-actions';
import { picturesFor, type MockupPicture } from '@/lib/plan/mockups';

/**
 * The pictures kept with a question (plan #2810.2).
 *
 * A question about a screen is easier to answer with the screen in front of
 * you, so each option shows its mockup under it, a phone shot and a laptop
 * shot small enough to sit in the list. Pressing one opens both side by side,
 * large, with the button that opens the interactive page. A question with no
 * pictures draws nothing here, so the plain ones look as they always did.
 */

/** Shorter than the signed links last, so a kept answer is never one that has expired. */
const KEPT_MS = 50 * 60 * 1000;

const kept = new Map<string, { at: number; pictures: MockupPicture[] }>();
const wanted = new Set<string>();
const waiting = new Map<string, Array<(pictures: MockupPicture[]) => void>>();
let flushing = false;

/**
 * One call for every question that asks in the same moment. A page of thirty
 * questions mounts thirty option lists at once, and server actions run one
 * after another, so asking for each would be thirty round trips.
 */
function fetchMockups(id: string): Promise<MockupPicture[]> {
  const hit = kept.get(id);
  if (hit && Date.now() - hit.at < KEPT_MS) return Promise.resolve(hit.pictures);

  return new Promise((resolve) => {
    wanted.add(id);
    waiting.set(id, [...(waiting.get(id) ?? []), resolve]);
    if (flushing) return;
    flushing = true;
    setTimeout(async () => {
      const ids = [...wanted];
      wanted.clear();
      flushing = false;
      let found: Record<string, MockupPicture[]> = {};
      try {
        found = await loadQuestionMockups(ids);
      } catch {
        found = {};
      }
      for (const one of ids) {
        const pictures = found[one] ?? [];
        kept.set(one, { at: Date.now(), pictures });
        for (const done of waiting.get(one) ?? []) done(pictures);
        waiting.delete(one);
      }
    }, 0);
  });
}

/**
 * The pictures of one question, none until they arrive. `preset` is for the
 * gallery and the tests, which draw fixtures and ask nobody.
 */
export function useQuestionMockups(
  itemId: string | undefined,
  preset?: readonly MockupPicture[],
): readonly MockupPicture[] {
  const [loaded, setLoaded] = useState<readonly MockupPicture[]>([]);

  useEffect(() => {
    if (!itemId || preset) return;
    let live = true;
    void fetchMockups(itemId).then((pictures) => {
      if (live) setLoaded(pictures);
    });
    return () => {
      live = false;
    };
  }, [itemId, preset]);

  return preset ?? loaded;
}

/**
 * One picture in the list. It shimmers until the file has come, and when it
 * will not come says so in words, so the option beside it is still the thing
 * you read. `hold` keeps the shimmer up, for the gallery's loading drawing.
 */
function Thumb({ picture, label, hold }: { picture: MockupPicture; label: string; hold?: boolean }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  const phone = picture.width === 390;
  const box = phone ? 'h-36 w-20' : 'h-24 w-40';

  if (state === 'failed') {
    return (
      <span
        className={cn(
          'flex items-center justify-center rounded-control border border-border bg-sunken px-2 text-center text-micro text-ink-muted', // ui-ok: hand-rolled-box -- the edge of a picture, which is not a grouping
          box,
        )}
      >
        Picture would not load
      </span>
    );
  }

  return (
    <span /* ui-ok: hand-rolled-box -- the edge of a picture, which is not a grouping */ className={cn('relative block overflow-hidden rounded-control border border-border bg-sunken', box)}>
      {(state === 'loading' || hold) && <Skeleton className="absolute inset-0 rounded-none" />}
      {!hold && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private file; the optimiser cannot fetch it
        <img
          ref={(img) => {
            // The file can finish loading before React has attached onLoad, as
            // it does on a page rendered on the server, so ask the element.
            if (img?.complete) setState(img.naturalWidth > 0 ? 'shown' : 'failed');
          }}
          src={picture.url}
          alt={`${label}, ${phone ? 'phone' : 'laptop'}`}
          loading="lazy"
          onLoad={() => setState('shown')}
          onError={() => setState('failed')}
          className={cn('size-full object-cover object-top', state !== 'shown' && 'opacity-0')}
        />
      )}
    </span>
  );
}

/** What is pictured: an option's pictures, or the whole question's (a null letter). */
export type PictureTarget = { letter: string | null; label: string };

/**
 * An option's pictures, small. One press opens both in the viewer. It sits
 * beside the option's own button rather than inside it, since a press on the
 * option answers it and a press on the picture only enlarges it.
 */
export function OptionPictures({
  pictures,
  target,
  onOpen,
  hold,
}: {
  pictures: readonly MockupPicture[];
  target: PictureTarget;
  onOpen: (target: PictureTarget) => void;
  hold?: boolean;
}) {
  const { phone, laptop } = picturesFor(pictures, target.letter);
  if (!phone && !laptop) return null;
  const name = target.letter ? `Option ${target.letter}: ${target.label}` : target.label;

  return (
    <button
      type="button"
      onClick={() => onOpen(target)}
      aria-label={`Enlarge the mockup for ${name}`}
      className="press flex max-w-full items-start gap-2 overflow-hidden rounded-control p-0.5 transition-colors duration-quick hover:bg-accent-tint"
    >
      {phone && <Thumb picture={phone} label={name} hold={hold} />}
      {laptop && <Thumb picture={laptop} label={name} hold={hold} />}
    </button>
  );
}

/**
 * Both pictures large, side by side, over the page. A sheet from the foot on a
 * phone and a dialog in the middle on a laptop. The phone shot and the laptop
 * shot are both drawn at half their width, so they keep their scale against
 * each other; on a narrow screen the row scrolls rather than shrinking the
 * laptop to nothing.
 */
export function MockupViewer({
  pictures,
  target,
  onClose,
}: {
  pictures: readonly MockupPicture[];
  target: PictureTarget;
  onClose: () => void;
}) {
  const { phone, laptop } = picturesFor(pictures, target.letter);
  const link = phone?.link ?? laptop?.link ?? null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const title = target.letter ? `Option ${target.letter}` : 'The mockup';

  return createPortal(
    <div className="fixed inset-0 z-overlay md:flex md:items-center md:justify-center">
      <button type="button" aria-label="Close the mockup" onClick={onClose} className={scrim} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title}, phone and laptop`}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-card border-t border-border bg-surface md:relative md:inset-auto md:max-h-[90dvh] md:w-[min(60rem,94vw)] md:rounded-card md:border"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-ui font-semibold text-ink">{title}</h2>
            {target.letter && (
              <p className="mt-0.5 line-clamp-2 break-words text-small text-ink-muted">{target.label}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Open the mockup
              </a>
            )}
            <IconButton label="Close the mockup" onClick={onClose}>
              <X strokeWidth={1.75} aria-hidden />
            </IconButton>
          </div>
        </div>
        <div className="flex items-start gap-4 overflow-auto p-4">
          {phone && (
            <figure className="w-[195px] shrink-0 space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to a private file */}
              <img /* ui-ok: hand-rolled-box -- the edge of a picture, which is not a grouping */ src={phone.url} alt={`${title}, phone`} className="w-full rounded-control border border-border" />
              <figcaption className="text-micro text-ink-muted">Phone</figcaption>
            </figure>
          )}
          {laptop && (
            <figure className="w-[640px] shrink-0 space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to a private file */}
              <img /* ui-ok: hand-rolled-box -- the edge of a picture, which is not a grouping */ src={laptop.url} alt={`${title}, laptop`} className="w-full rounded-control border border-border" />
              <figcaption className="text-micro text-ink-muted">Laptop</figcaption>
            </figure>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
