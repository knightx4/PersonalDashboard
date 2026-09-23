/**
 * How each rule on /dev/ui gets checked, which decides what an audit of it
 * costs.
 *
 *   gate   -- a pattern in the code proves it. scripts/check-ui.ts, lint or the
 *             contrast check holds it on every push, and no review reads it.
 *   read   -- one read of a module's files settles it, with no build and no
 *             screenshot. A review takes a module and checks every `read` rule
 *             in the same pass, so the files are read once rather than once
 *             per rule.
 *   look   -- only the picture settles it: crowding at 390px, a theme where
 *             something disappears, whether a page reads as the right kind of
 *             page. The expensive pass, kept to the rules that need it.
 *   summary -- restates rules held elsewhere (the checklist, the nevers, the
 *             voice examples), so it is never audited on its own.
 *
 * Keyed by the export name in content.ts, and by law number for laws.ts.
 * tests/ui-audit.test.ts fails when a list is added to content.ts without a tag here,
 * so a new rule cannot arrive unclassified.
 */
export type Check = 'gate' | 'read' | 'look' | 'summary';

export const LAW_CHECK: Readonly<Record<number, Check>> = {
  1: 'read', // an empty section is not rendered
  2: 'read', // a failed source says so in place
  3: 'read', // no 0/0, no 0%, no 00:00
  4: 'look', // the gate holds the tokens; whether a colour's meaning is true is a picture
  5: 'read', // view state in the URL
  6: 'read', // GET forms, server components fetch
  7: 'look', // personality in the chrome
  8: 'read', // reasoning in comments
  9: 'look', // room the content needs
  10: 'read', // folds are <details> and carry a count
  11: 'look', // the gate holds hand-rolled boxes; nested frames need the picture
  12: 'read', // one value edited in place
  13: 'look', // the gate holds card-per-row; whether a list reads as a list is a picture
  14: 'read', // the gate holds open composers; editors drawn around values need a read
  15: 'read', // a heading explained underneath itself
};

export const LIST_CHECK: Readonly<Record<string, Check>> = {
  A11Y: 'read',
  ALIVE: 'look',
  BANNER_TONES: 'read',
  BULK: 'read',
  CHECKLIST: 'summary',
  CROSS_WORKSPACE: 'read',
  DATA_DISPLAY: 'look',
  DATA_RULES: 'read',
  FILTER_RULES: 'read',
  FINDING: 'read',
  FIRST_RUN: 'look',
  ICON_RULES: 'read',
  KEYBOARD: 'read',
  LADDER: 'read',
  LATENCY: 'read',
  LOOPS: 'look',
  LOOPS_RULES: 'look',
  NEVER: 'summary',
  NOTIFICATION_RULES: 'read',
  PAGE_WIDTHS: 'read',
  PLACES: 'look',
  PROGRESS: 'read',
  ROW_RULES: 'read',
  SAVE_MODEL: 'read',
  SEARCH: 'read',
  SHAPES: 'look',
  SHELL_RULES: 'look',
  STATES: 'read',
  TABLE_RULES: 'read',
  THEME_RULES: 'look',
  TOUCH: 'look',
  UNDO: 'read',
  VOICE: 'read',
  VOICE_DO: 'summary',
  VOICE_DONT: 'summary',
  WAYFINDING: 'read',
};

/**
 * The rules a machine holds, and where. A `read` or `look` pass skips these:
 * the gate has already counted them, and a finding that repeats a gate count
 * is noise on /dev/ui/review.
 */
export const HELD_BY_GATE: readonly { rule: string; heldBy: string }[] = [
  { rule: 'Every colour is a token; no raw hex or palette colour', heldBy: 'check:ui raw-hex, lint' },
  { rule: 'Every size is a named step', heldBy: 'check:ui off-scale-text, lint' },
  { rule: 'Control heights follow the density dial', heldBy: 'check:ui fixed-control-height' },
  { rule: 'Money goes through lib/money.ts', heldBy: 'lint' },
  { rule: 'Contrast in every theme', heldBy: 'check:contrast' },
  { rule: 'Containers are Card, Group or CardSection', heldBy: 'check:ui hand-rolled-box' },
  { rule: 'A row is not a card', heldBy: 'check:ui card-per-row' },
  { rule: 'A state is a shape, not a tint alone', heldBy: 'check:ui stage-tint-without-glyph' },
  { rule: 'No compose box open on arrival', heldBy: 'check:ui composer-always-open' },
  { rule: 'Every write has a latency tier', heldBy: 'check:ui action-without-tier' },
  { rule: 'Never window.confirm or window.alert', heldBy: 'check:ui window-dialog' },
  { rule: 'Row actions visible on touch, revealed on hover', heldBy: 'check:ui hover-only-action' },
  { rule: 'Lucide at 1.75', heldBy: 'check:ui icon-stroke' },
  { rule: 'Visible focus', heldBy: 'check:ui focus-removed' },
  { rule: 'Skeletons, never spinners', heldBy: 'check:ui spinner' },
  { rule: 'No resting shadow on a card', heldBy: 'check:ui resting-shadow' },
  { rule: 'No two-hue gradient but the home mark', heldBy: 'check:ui two-hue-gradient' },
  { rule: '16px inputs', heldBy: 'check:ui small-input' },
  { rule: 'No "successfully", exclamation marks, Submit/OK or emoji', heldBy: 'check:ui product-copy' },
  { rule: 'No streaks', heldBy: 'check:ui streak' },
  { rule: 'Every route has a loading file', heldBy: 'check:ui route-without-loading' },
  { rule: 'Every route has an error file', heldBy: 'check:ui route-without-error' },
];
