/**
 * The box a page is drawn in: its maximum width and its gutter.
 *
 * The shell's `<main>` takes it, and so does an anatomy surface on /dev/ui.
 * One copy because the anatomies are checked against real pages -- a drawing
 * made in a 900px column when the app gives a page 1400 is a drawing of
 * something that does not ship.
 *
 * `w-full` because a flex item's width comes from its content rather than
 * from the line box: without it a narrow page would shrink-wrap instead of
 * filling up to the max-width.
 */
export const MAIN_BOX = 'mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6';
