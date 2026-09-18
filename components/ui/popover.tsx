import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * A surface that floats over the page.
 *
 * Law 11 says a border is the last resort for grouping, and for a floating
 * panel it is exactly that: space cannot separate a menu from a page it is
 * covering, and alignment cannot either, because the thing underneath is
 * arbitrary and unknown. So this is the one shape in the app that is allowed
 * a full frame and a shadow at rest, and `Card` says as much in its own first
 * paragraph -- "shadow belongs only to things genuinely floating -- menus and
 * popovers". This is the component that sentence was waiting for.
 *
 * It exists because the behaviour half was extracted and the surface half was
 * not. `lib/use-popover.ts` already owns escape, outside-click, focus and the
 * return of focus for every panel in the shell; the panel *itself* was still
 * being hand-drawn in six files, and after six copies they had drifted --
 * three grounds where there is one right answer (`bg-raised`: the token that
 * exists for things above the page, and in Lightbox the only one that is a
 * lit sheet), two paddings for the same list-of-rows, and one of the two
 * radii. None of that is a decision anybody made; it is what happens when a
 * shape has no name.
 *
 * -- Why the ground is `bg-raised` and the edge is a plain hairline --
 *
 * `sheet`, the utility every Card carries, is deliberately *not* here, and
 * that is not an oversight. It sets `box-shadow` -- the lit paper's edge in
 * Lightbox, and `none` in the other four themes -- so it and a Tailwind
 * `shadow-*` are two rules for one property, and which of them wins is a
 * question about utility ordering rather than about design. A popover needs
 * its lift in all five themes, so the shadow wins outright and the edge is
 * the ordinary hairline. `bg-raised` still carries the sheet's inks and
 * borders through the scope in globals.css, so a panel over the Lightbox
 * bench is still a lit sheet; it just gets its depth from the drop rather
 * than from the inset highlight.
 *
 * The shape is exported on its own as well as wrapped in a component --
 * `cardVariants`' opposite number, and for the same reason. The command
 * palette is centred inside its own overlay and is a modal dialog rather than
 * a panel hanging off a trigger, so it takes the shape and keeps its own
 * mechanics.
 */
export const popoverSurface =
  'popover-panel rise-in rounded-card border border-border bg-raised shadow-lg';

/**
 * The scrim: the ground an overlay is read against, and the button that
 * closes it. Six overlays drew their own and three spellings had appeared --
 * bg-black/40 with a 1px blur, bg-black/40 with none, and bg-ink/25 -- so
 * which drawer dimmed the page more was an accident of who wrote it.
 *
 * The blur is a pixel, and it is what separates a dim from a scrim: text
 * behind it stops being readable, so the eye stops trying. It costs a
 * backdrop-filter over the whole viewport, which is real work on a phone; the
 * layer is only mounted while the overlay is open, and one pixel is the least
 * that does the job.
 *
 * It carries its own positioning because all six use it the same way: a
 * full-bleed child of the overlay's fixed root.
 */
export const scrim = 'absolute inset-0 bg-black/40 backdrop-blur-[1px]';

const popover = cva(`${popoverSurface} z-overlay`, {
  variants: {
    /**
     * Where it hangs.
     *
     * `trigger-right` is the recipe the three top-bar panels were each
     * carrying their own copy of the reasoning for: a button that far along
     * the header has almost no room to its right, so a panel anchored to it
     * hangs off the left edge of a phone, where nothing can scroll it back
     * and Safari answers a field focused out there by zooming the whole page
     * out to reach it. Below `sm` it is therefore pinned to the viewport
     * under the header instead, and only becomes an anchored popover once
     * there is width to anchor it in.
     *
     * `trigger-below` is for a trigger with room beneath and to the right of
     * it -- the workspace switcher at the top of the sidebar column -- where
     * none of that applies and the panel can simply drop.
     */
    anchor: {
      'trigger-right':
        'fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-10',
      'trigger-below': 'absolute left-0 top-full mt-1.5',
      /**
       * The same drop, hung from the trigger's right edge instead of its
       * left. A panel wider than its button runs off the right of a phone
       * when the button is at the end of a toolbar -- which is where a
       * control that arranges the list below it belongs -- and nothing
       * scrolls it back.
       */
      'trigger-below-end': 'absolute right-0 top-full mt-1.5',
      /**
       * The same, upwards: hung from the trigger's right edge and standing on
       * top of it. For a trigger in the bottom bar, where there is no room
       * below by definition -- the bar is the bottom of the window.
       */
      'trigger-above-end': 'absolute bottom-full right-0 mb-1.5',
    },
    /**
     * `menu` is a list of rows that carry their own padding, so the panel
     * only owes them a hairline of inset; `panel` is content that does not,
     * and is set at the card's own rhythm. Two values rather than a free
     * class, because the two menus in the shell had picked p-1 and p-2 for
     * the identical job.
     */
    padding: { menu: 'p-1', panel: 'p-4', none: '' },
  },
  defaultVariants: { anchor: 'trigger-right', padding: 'none' },
});

export type PopoverProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof popover> & { ref?: React.Ref<HTMLDivElement> };

/**
 * The width is the caller's, because it is the only part that is genuinely
 * about the contents -- and for `trigger-right` it belongs on the `sm:` step,
 * since below that the panel is pinned to the viewport and has no width of
 * its own to set.
 */
export function Popover({ className, anchor, padding, ref, ...props }: PopoverProps) {
  return <div ref={ref} className={cn(popover({ anchor, padding }), className)} {...props} />;
}
