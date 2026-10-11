/**
 * The type a merge row's theme name is set in, for the folded-in name and the
 * kept one alike (plan #1792). Sixteen pixels on a phone because the kept name
 * is an input and a smaller one makes iOS zoom on focus, so the other name
 * matches it rather than the two differing.
 */
// eslint-disable-next-line no-restricted-syntax -- text-base is the one deliberate off-scale size: 16px stops iOS zooming on focus.
export const MERGE_NAME = 'text-base font-medium text-ink sm:text-ui';
