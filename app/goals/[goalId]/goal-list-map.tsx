'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { MapPin } from '@/lib/goals/list-views';

/**
 * A list's rows on OpenStreetMap tiles through Leaflet (plan #2330.4), one
 * numbered pin per row with a point, fitted to show them all. The tiles need
 * no key; the attribution OpenStreetMap asks for sits in the corner.
 *
 * Pins closer than a pin's width are set side by side, so two shops on one
 * street both show. A pressed pin stays at full strength, the others fade,
 * and its card hangs beside it.
 *
 * When the tiles will not load (offline, or the tile server refusing), it
 * says so through `onFailed` and the list draws its table instead.
 */

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Tiles that fail before any loads, after which the map gives up. */
const FAILED_AFTER = 4;

const PIN = 28;
const CARD = 256;

/** Each pin's sideways shift in pixels, so pins that would sit on each other sit side by side. */
function spreadOf(map: L.Map, pins: MapPin[]): Map<number, number> {
  const shifts = new Map<number, number>();
  const placed: { x: number; y: number }[] = [];
  for (const pin of pins) {
    const at = map.latLngToContainerPoint([pin.lat, pin.lng]);
    const near = placed.filter((p) => Math.abs(p.x - at.x) < PIN && Math.abs(p.y - at.y) < PIN).length;
    shifts.set(pin.n, near * (PIN + 2));
    placed.push({ x: at.x, y: at.y });
  }
  return shifts;
}

function pinIcon(n: number, state: 'rest' | 'picked' | 'faded', shift: number): L.DivIcon {
  return L.divIcon({
    className: 'list-map-pin',
    html: `<span data-state="${state}">${n}</span>`,
    iconSize: [PIN, PIN],
    iconAnchor: [PIN / 2 - shift, PIN / 2],
  });
}

export function ListMap({
  pins,
  selected,
  onSelect,
  onFailed,
  card,
}: {
  pins: MapPin[];
  selected: number | null;
  onSelect: (n: number | null) => void;
  onFailed: () => void;
  /** The pressed pin's card, hung beside it. */
  card?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const handlers = useRef({ onSelect, onFailed });
  const selectedRef = useRef(selected);
  // Where the pressed pin sits in the map, for its card; redrawn as the map moves.
  const [point, setPoint] = useState<{ x: number; y: number; width: number } | null>(null);
  useEffect(() => {
    handlers.current = { onSelect, onFailed };
  }, [onSelect, onFailed]);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { scrollWheelZoom: false, attributionControl: true, zoomControl: true });
    m.attributionControl.setPrefix(false);
    let loaded = 0;
    let failed = 0;
    const tiles = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION });
    tiles.on('tileload', () => {
      loaded++;
    });
    tiles.on('tileerror', () => {
      failed++;
      if (loaded === 0 && failed === FAILED_AFTER) handlers.current.onFailed();
    });
    tiles.addTo(m);
    const placed = new Map<number, L.Marker>();
    for (const pin of pins) {
      const marker = L.marker([pin.lat, pin.lng], {
        icon: pinIcon(pin.n, 'rest', 0),
        title: `${pin.n}. ${pin.row.title}`,
        alt: `${pin.n}. ${pin.row.title}`,
        keyboard: true,
      });
      marker.on('click', () => handlers.current.onSelect(pin.n));
      marker.addTo(m);
      placed.set(pin.n, marker);
    }
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    if (pins.length === 1) m.setView(bounds.getCenter(), 15);
    else m.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
    m.on('click', () => handlers.current.onSelect(null));
    map.current = m;
    const draw = () => {
      const shifts = spreadOf(m, pins);
      const picked = selectedRef.current;
      for (const pin of pins) {
        const state = picked === null ? 'rest' : pin.n === picked ? 'picked' : 'faded';
        const marker = placed.get(pin.n);
        marker?.setIcon(pinIcon(pin.n, state, shifts.get(pin.n) ?? 0));
        marker?.setZIndexOffset(pin.n === picked ? 1000 : 0);
      }
      const pin = pins.find((p) => p.n === picked);
      if (pin) {
        const at = m.latLngToContainerPoint([pin.lat, pin.lng]);
        setPoint({ x: at.x + (shifts.get(pin.n) ?? 0), y: at.y, width: m.getSize().x });
      } else {
        setPoint(null);
      }
    };
    m.on('zoomend moveend redraw-pins', draw);
    draw();
    return () => {
      m.remove();
      map.current = null;
    };
  }, [pins]);

  useEffect(() => {
    selectedRef.current = selected;
    map.current?.fire('redraw-pins');
  }, [selected]);

  // The card hangs above a pin in the lower part of the map, below one near its top.
  const below = point !== null && point.y < 150;
  const left = point ? Math.max(8, Math.min(point.x - CARD / 2, point.width - CARD - 8)) : 0;

  return (
    <div className="relative">
      <style>{PIN_CSS}</style>
      <div
        ref={box}
        role="region"
        aria-label="Map of the places"
        // ui-ok: hand-rolled-box -- a map's frame, not a grouping
        className="list-map relative isolate h-72 overflow-hidden rounded-card border border-border bg-sunken sm:h-80"
      />
      {card && point && (
        <div
          className="absolute z-over-link"
          style={
            below
              ? { left, top: point.y + PIN / 2 + 8 }
              : { left, top: point.y - PIN / 2 - 8, transform: 'translateY(-100%)' }
          }
        >
          {card}
        </div>
      )}
    </div>
  );
}

/**
 * The pins in the page's own colours, and the tiles dimmed in a dark theme
 * so the map does not glare out of the panel. Written here because Leaflet
 * draws the pins and its controls as its own elements, outside React's classes.
 */
const DARK = ['ink', 'dusk', 'darkroom', 'aurora', 'poster-dark']
  .map((t) => `[data-theme='${t}'] .list-map .leaflet-tile-pane`)
  .join(',');

const PIN_CSS = `
.list-map-pin { background: none; border: 0; }
.list-map-pin span {
  display: flex; align-items: center; justify-content: center;
  width: ${PIN}px; height: ${PIN}px; border-radius: 999px;
  background: var(--c-accent); color: var(--c-fill-ink);
  font: 600 12px/1 var(--font-sans, system-ui), sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 2px var(--c-surface), 0 2px 6px rgb(0 0 0 / 0.35);
  transition: opacity var(--motion-quick) var(--ease-out-soft), transform var(--motion-quick) var(--ease-out-soft);
}
.list-map-pin span[data-state='picked'] { transform: scale(1.15); box-shadow: 0 0 0 3px var(--c-surface), 0 2px 8px rgb(0 0 0 / 0.45); }
.list-map-pin span[data-state='faded'] { opacity: 0.35; }
.list-map .leaflet-bar a { background: var(--c-raised, var(--c-surface)); color: var(--c-ink); border-color: var(--c-border); }
.list-map .leaflet-bar a:hover { background: var(--c-sunken, var(--c-surface)); }
.list-map .leaflet-control-attribution { font-size: 10px; background: var(--c-surface); color: var(--c-ink-muted); }
.list-map .leaflet-control-attribution a { color: var(--c-accent); }
${DARK} { filter: brightness(0.75) contrast(1.1) saturate(0.7); }
`;
