/**
 * The interaction a gallery surface declares, and the timeline the recorder
 * plays it on (docs/UI-QUALITY-SPEC.md, Part 8, "Judging craft").
 *
 * A still picture cannot show whether a press answers or a swipe follows the
 * finger, so `npm run record` plays each declared interaction on the real
 * component at 390 pixels and keeps a frame every 50ms for up to a second,
 * joined into one strip image a critic can read. Everything here is pure, so
 * the timing can be tested without a browser; scripts/record.ts drives it.
 *
 * A surface declares one on its gallery entry in app/preview/surfaces.tsx:
 *
 *   interaction: {
 *     kind: 'swipe',
 *     target: '[data-quick-swipe]',
 *     direction: 'left',
 *     shows: 'The card follows the finger left, then slides off as the next story comes in.',
 *   }
 *
 * A surface with no `interaction` is skipped.
 */

/** Gap between frames, in milliseconds. */
export const FRAME_MS = 50;

/** The longest a recording runs. */
export const MAX_RECORD_MS = 1000;

/** How long a press or a completion holds the pointer down before letting go. */
export const PRESS_HOLD_MS = 100;

/** How long a swipe's drag lasts, from finger down to letting go. */
export const DRAG_MS = 300;

/** When the input starts: one frame of the surface at rest comes first. */
export const INPUT_AT_MS = FRAME_MS;

type Common = {
  /** A CSS selector for the element the input lands on; the first match is used. */
  target: string;
  /**
   * What the strip should show when the interaction works, in one sentence.
   * It is printed on the strip and in its sidecar, so whoever reads the strip
   * knows what to look for.
   */
  shows: string;
  /** How long to record, up to MAX_RECORD_MS. */
  durationMs?: number;
};

export type Interaction =
  /** A tap on a control: pointer down, held briefly, released. */
  | (Common & { kind: 'press' })
  /** A tap that finishes something, such as ticking a todo. Played as a press. */
  | (Common & { kind: 'completion' })
  /**
   * A one-finger drag across the target. `share` is how far, as a part of the
   * target's width (0.6 when left out), which is past the one third Quick read
   * needs to count it.
   */
  | (Common & { kind: 'swipe'; direction: 'left' | 'right'; share?: number });

export type Box = { x: number; y: number; width: number; height: number };

export type InputEvent = {
  /** Milliseconds from the first frame. */
  at: number;
  /** Touch for a swipe, mouse for a press. */
  device: 'touch' | 'mouse';
  phase: 'down' | 'move' | 'up';
  x: number;
  y: number;
};

/** How long this interaction is recorded for. */
export function recordLength(interaction: Interaction): number {
  const asked = interaction.durationMs ?? MAX_RECORD_MS;
  return Math.max(FRAME_MS, Math.min(MAX_RECORD_MS, asked));
}

/** The times frames are taken at: 0, 50, 100 … up to the recording's length. */
export function frameTimes(lengthMs: number, frameMs = FRAME_MS): number[] {
  const times: number[] = [];
  for (let t = 0; t <= lengthMs; t += frameMs) times.push(t);
  return times;
}

/**
 * The input events, in order, for an interaction on a target at `box` (in
 * viewport pixels). `viewportHeight` keeps the point on screen when the
 * target is taller than the window.
 *
 * Every event lands on a frame time, so each frame shows the state straight
 * after the event at its time; the first frame is always the surface at rest.
 */
export function inputEvents(
  interaction: Interaction,
  box: Box,
  viewportHeight: number,
): InputEvent[] {
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, viewportHeight);
  const y = Math.round(top + (bottom - top) / 2);

  if (interaction.kind === 'press' || interaction.kind === 'completion') {
    const x = Math.round(box.x + box.width / 2);
    return [
      { at: INPUT_AT_MS, device: 'mouse', phase: 'down', x, y },
      { at: INPUT_AT_MS + PRESS_HOLD_MS, device: 'mouse', phase: 'up', x, y },
    ];
  }

  const share = interaction.share ?? 0.6;
  const sign = interaction.direction === 'left' ? -1 : 1;
  // Start near the edge the finger moves away from, so the whole drag stays
  // on the target.
  const startX = Math.round(
    interaction.direction === 'left' ? box.x + box.width * 0.85 : box.x + box.width * 0.15,
  );
  const distance = box.width * share;
  const moves = Math.round(DRAG_MS / FRAME_MS);
  const events: InputEvent[] = [{ at: INPUT_AT_MS, device: 'touch', phase: 'down', x: startX, y }];
  for (let step = 1; step <= moves; step += 1) {
    events.push({
      at: INPUT_AT_MS + step * FRAME_MS,
      device: 'touch',
      phase: 'move',
      x: Math.round(startX + sign * distance * (step / moves)),
      y,
    });
  }
  const last = events[events.length - 1]!;
  events.push({ at: last.at + FRAME_MS, device: 'touch', phase: 'up', x: last.x, y });
  return events;
}

/**
 * What the input is doing at a frame time, as printed under the frame:
 * "at rest" before anything, then "pressed", "dragging" or "let go".
 */
export function phaseAt(events: readonly InputEvent[], at: number): string {
  let last: InputEvent | null = null;
  for (const event of events) if (event.at <= at) last = event;
  if (!last) return 'at rest';
  if (last.phase === 'up') return 'let go';
  if (last.device === 'mouse') return 'pressed';
  return last.phase === 'down' ? 'finger down' : 'dragging';
}

/** Where the finger or pointer is at a frame time, or null once it has let go. */
export function pointerAt(
  events: readonly InputEvent[],
  at: number,
): { x: number; y: number } | null {
  let last: InputEvent | null = null;
  for (const event of events) if (event.at <= at) last = event;
  if (!last || last.phase === 'up') return null;
  return { x: last.x, y: last.y };
}

/** Columns in a strip: seven across keeps a second's 21 frames to three rows. */
export const STRIP_COLUMNS = 7;

/** How the frames sit in the strip: rows of STRIP_COLUMNS, read left to right. */
export function stripGrid(frames: number): { columns: number; rows: number } {
  const columns = Math.max(1, Math.min(STRIP_COLUMNS, frames));
  return { columns, rows: Math.max(1, Math.ceil(frames / columns)) };
}

/** The strip's file name, without extension, for a surface in a theme. */
export function stripName(surfaceId: string, themeSlug: string): string {
  return `${surfaceId}--phone-${themeSlug}`;
}

/** The id of the JSON block on the gallery index listing each declared interaction. */
export const INTERACTIONS_SCRIPT_ID = 'preview-interactions';

/**
 * Reads the declared interactions back off the gallery index's HTML, keyed by
 * surface id. An index with no block (no surface declares one) reads as none.
 */
export function readInteractions(html: string): Record<string, Interaction> {
  const match = html.match(
    new RegExp(`<script[^>]*id="${INTERACTIONS_SCRIPT_ID}"[^>]*>([\\s\\S]*?)</script>`),
  );
  if (!match) return {};
  return JSON.parse(match[1]!) as Record<string, Interaction>;
}

/**
 * The declared interactions as the index writes them: JSON safe to put inside
 * a script element, since `<` is escaped and cannot close it.
 */
export function writeInteractions(entries: Record<string, Interaction>): string {
  return JSON.stringify(entries).replace(/</g, '\\u003c');
}
