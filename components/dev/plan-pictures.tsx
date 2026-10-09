import type { PlanPicture } from '@/lib/plan/pictures';

/**
 * The drawings on an opened plan row (migration 0189): the options a
 * proposal or a decision shows before anything is built, each under its
 * caption. A drawing can move, since an SVG carries its own animation, and
 * each links to itself at full size.
 */
export function PlanPictures({ pictures }: { pictures: readonly PlanPicture[] }) {
  if (pictures.length === 0) return null;
  return (
    <section aria-label="Pictures" className="grid gap-4 sm:grid-cols-2">
      {pictures.map((picture) => (
        <figure key={picture.id} className="min-w-0 space-y-1.5">
          <figcaption className="text-small text-ink">{picture.caption}</figcaption>
          <a href={picture.src} target="_blank" rel="noreferrer" className="press block rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element -- an SVG from our own route, loaded as an image so nothing in it runs */}
            <img
              src={picture.src}
              alt={picture.caption}
              loading="lazy"
              className="w-full rounded-md bg-sunken"
            />
          </a>
        </figure>
      ))}
    </section>
  );
}
