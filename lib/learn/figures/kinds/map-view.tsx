'use client';

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { GEOCODER } from '../places';
import { HEIGHT, TILE_HEIGHT, TILE_WIDTH, WIDTH, across, down, mapFrame } from './map-frame';

/** One place on the map, located by the geocoder. */
export type MapPlace = { name: string; note: string; year: number | null; lat: number; lon: number; url: string | null };

/** What the map kind's resolve hands its Render. */
export type MapData = { area: string; places: MapPlace[]; missing: string[] };

/**
 * The base map: OpenStreetMap's own tiles, whose tile policy allows light use
 * like one person's lessons with the attribution under the map. They are
 * drawn in grey, and inverted on a dark theme, so the base stays a light
 * ground under the markers rather than competing with them.
 */
const tileUrl = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE_FILTER = {
  light: 'grayscale(1) contrast(0.8) brightness(1.06)',
  dark: 'grayscale(1) invert(1) brightness(0.55) contrast(0.9)',
} as const;

/** Whether a colour, as getComputedStyle gives it, is a dark one. */
function isDark(colour: string): boolean {
  const [r, g, b] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  if (![r, g, b].every(Number.isFinite)) return false;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** Which place the gallery draws pressed, by the map's area. Nothing outside the gallery uses it. */
const Pressed = createContext<Record<string, number>>({});

export function MapPressed({ pressed, children }: { pressed: Record<string, number>; children: ReactNode }) {
  return <Pressed.Provider value={pressed}>{children}</Pressed.Provider>;
}

/** The years the places carry, oldest first, each once. */
export function placeYears(places: readonly MapPlace[]): number[] {
  return [...new Set(places.flatMap((place) => (place.year == null ? [] : [place.year])))].sort((a, b) => a - b);
}

/**
 * A map figure (plan #2321.6): the places as numbered markers over a light
 * base map, and under it the same places as a numbered list, readable with
 * no map at all. Pressing a marker shows its note under the map.
 *
 * Places are drawn in muted ink. Where they carry two or more years, a
 * slider steps through them: the map shows what existed by that year, the
 * year's own places in the accent, and the list dims what comes later. It
 * starts at the last year, with everything shown. A pressed place takes the
 * accent and the others fade. Markers that would overlap are pushed apart,
 * with a short line back to where the place is.
 *
 * The base tiles are drawn once the page's colour scheme can be read off
 * the map's own box, so a dark theme gets them inverted; until then, and
 * when the tiles cannot load, the markers sit on the sunken ground.
 */
export function MapView({ data }: { data: MapData }) {
  const galleryPressed = useContext(Pressed)[data.area];
  const [pressed, setPressed] = useState<number | null>(galleryPressed ?? null);
  const years = placeYears(data.places);
  const dated = years.length >= 2;
  const [step, setStep] = useState(years.length - 1);
  const shownYear = dated ? years[step] : null;
  const frame = useMemo(() => mapFrame(data.places), [data.places]);
  const box = useRef<HTMLDivElement>(null);
  const [scheme, setScheme] = useState<keyof typeof TILE_FILTER | null>(null);
  const id = useId();

  useEffect(() => {
    // Read off the map's own ground, so every theme, written or generated, is
    // right, and again whenever the theme changes on the page.
    const read = () => {
      if (box.current) setScheme(isDark(getComputedStyle(box.current).backgroundColor) ? 'dark' : 'light');
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, { attributes: true });
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    system.addEventListener('change', read);
    return () => {
      watch.disconnect();
      system.removeEventListener('change', read);
    };
  }, []);

  const later = (place: MapPlace) => shownYear != null && place.year != null && place.year > shownYear;
  const current = (place: MapPlace) => shownYear != null && place.year === shownYear;
  const open = pressed != null && data.places[pressed] && !later(data.places[pressed]) ? data.places[pressed] : null;

  const badge = (place: MapPlace, index: number) => (
    <span
      aria-hidden
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-small font-semibold ${
        later(place)
          ? 'border border-border-strong bg-surface text-ink-muted'
          : open
            ? open === place
              ? 'bg-accent text-fill-ink'
              : 'bg-ink-muted text-surface'
            : dated && current(place)
              ? 'bg-accent text-fill-ink'
            : 'bg-ink-muted text-surface'
      }`}
    >
      {index + 1}
    </span>
  );

  return (
    <div>
      <div
        ref={box}
        role="group"
        aria-label={`Map of ${data.area}, ${data.places.length === 1 ? 'one place' : `${data.places.length} places`}`}
        className="relative max-w-[40rem] overflow-hidden rounded-lg border border-border bg-sunken"
        style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
      >
        {scheme &&
          frame.tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element -- OpenStreetMap tiles, positioned by the frame
            <img
              key={`${tile.z}/${tile.x}/${tile.y}/${tile.left}`}
              src={tileUrl(tile.z, tile.x, tile.y)}
              alt=""
              aria-hidden
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{ left: across(tile.left), top: down(tile.top), width: TILE_WIDTH, height: TILE_HEIGHT, filter: TILE_FILTER[scheme] }}
            />
          ))}
        <svg aria-hidden viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="pointer-events-none absolute inset-0 h-full w-full">
          {data.places.map((place, index) => {
            const from = frame.true[index];
            const to = frame.at[index];
            if (later(place) || Math.hypot(to.x - from.x, to.y - from.y) < 1) return null;
            return (
              <g key={index} className={open && open !== place ? 'opacity-30' : undefined}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--c-ink-muted)" strokeWidth={1.5} />
                <circle cx={from.x} cy={from.y} r={3} fill="var(--c-ink-muted)" />
              </g>
            );
          })}
        </svg>
        {data.places.map((place, index) =>
          later(place) ? null : (
            <button
              key={index}
              type="button"
              aria-label={`${index + 1}. ${place.name}${place.year != null ? `, ${place.year}` : ''}`}
              aria-pressed={pressed === index}
              aria-controls={`${id}-note`}
              onClick={() => setPressed(pressed === index ? null : index)}
              className={`absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-accent ${
                current(place) || pressed === index ? 'z-over-link' : ''
              } ${open && open !== place ? 'opacity-30' : ''}`}
              style={{ left: across(frame.at[index].x), top: down(frame.at[index].y) }}
            >
              <span
                className={`rounded-full ring-2 ring-surface ${pressed === index ? 'scale-125' : ''} transition-transform motion-reduce:transition-none`}
              >
                {badge(place, index)}
              </span>
            </button>
          ),
        )}
      </div>
      <div id={`${id}-note`} aria-live="polite" className="max-w-[40rem]">
        {open && (
          <p className="mt-2 rounded-md bg-sunken px-3 py-2 text-small text-ink">
            <span className="font-semibold">
              {data.places.indexOf(open) + 1}. {open.name}
              {open.year != null && `, ${open.year}`}
            </span>
            <span className="text-ink-muted"> · {open.note}</span>
          </p>
        )}
      </div>

      {dated && (
        <div className="mt-3 max-w-[40rem]">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`${id}-year`} className="text-small font-medium text-ink">
              Year
            </label>
            <span className="text-small text-ink-muted">
              {step === years.length - 1 ? `${shownYear}, everything shown` : `What stood by ${shownYear}`}
            </span>
          </div>
          <input
            id={`${id}-year`}
            type="range"
            min={0}
            max={years.length - 1}
            step={1}
            value={step}
            aria-valuetext={String(shownYear)}
            onChange={(event) => setStep(Number(event.target.value))}
            // ui-ok: the hit area is the 44px touch minimum, not a control height
            className="h-11 w-full cursor-pointer accent-ink-muted"
          />
          <div aria-hidden className="flex justify-between text-small text-ink-muted">
            <span>{years[0]}</span>
            <span>{years[years.length - 1]}</span>
          </div>
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {data.places.map((place, index) => (
          <li key={index} className="flex items-start gap-2.5">
            {badge(place, index)}
            <p className={`text-small ${later(place) ? 'text-ink-muted' : 'text-ink'}`}>
              <span className="font-medium">{place.name}</span>
              {place.year != null && <span className="text-ink-muted">, {place.year}</span>}
              <span className="block text-ink-muted">{place.note}</span>
            </p>
          </li>
        ))}
      </ol>
      {data.missing.length > 0 && (
        <p className="mt-2 text-small text-ink-muted">Not found on the map: {data.missing.join(', ')}.</p>
      )}
      <p className="mt-2 text-small text-ink-muted">
        Map{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-2 hover:text-ink">
          © OpenStreetMap contributors
        </a>
        . Places located by{' '}
        <a href={GEOCODER.url} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-2 hover:text-ink">
          {GEOCODER.name}
        </a>
        .
      </p>
    </div>
  );
}
