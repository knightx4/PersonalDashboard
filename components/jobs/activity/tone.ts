import type { ActivityTone } from '@/lib/jobs/activity/load';

/**
 * The tone, as a tinted chip.
 *
 * These are the pipeline's own status colours rather than new ones: a
 * rejection is the same red here as it is on the board, and every pair is
 * already checked by scripts/check-contrast.ts in all four themes. The chip
 * carries a word, never a colour alone -- the colour is what makes the one
 * line you were looking for findable, not what tells you which line it is.
 *
 * ui-ok-file: stage-tint-without-glyph -- a tone on a line of history, not a
 * status chip. The four here say what happened to a role, not which stage it
 * is in, and each one is read off the word in the chip rather than the ground
 * behind it. The glyph belongs on the badge, which is what says the stage.
 */
export const TONE_CHIP: Record<ActivityTone, string> = {
  bad: 'bg-status-rejected-tint text-status-rejected',
  good: 'bg-status-offer-tint text-status-offer',
  info: 'bg-status-submitted-tint text-status-submitted',
  muted: 'bg-status-lead-tint text-status-lead',
};
