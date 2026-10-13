/**
 * When a tooltip is showing, apart from the React that draws it.
 *
 * Hovering with a mouse or tabbing onto the child asks to show; the tooltip
 * appears once `delay` ms have passed with nothing taking the ask back, so a
 * pointer crossing a row of icons shows none of them. Leaving, blurring and
 * Escape hide at once and cancel an ask still waiting.
 *
 * It takes its timers as arguments so a test can drive it without a DOM or a
 * clock. `components/ui/tooltip.tsx` is the only caller in the app.
 */
export const TOOLTIP_DELAY_MS = 400;

export type TooltipTimers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export function createTooltipController({
  delay = TOOLTIP_DELAY_MS,
  onChange,
  initiallyOpen = false,
  timers = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
}: {
  delay?: number;
  onChange: (open: boolean) => void;
  /** Already showing, so the first hide has something to hide. */
  initiallyOpen?: boolean;
  timers?: TooltipTimers;
}) {
  let open = initiallyOpen;
  let waiting: unknown = null;

  function set(next: boolean) {
    if (open === next) return;
    open = next;
    onChange(next);
  }
  function cancel() {
    if (waiting === null) return;
    timers.clear(waiting);
    waiting = null;
  }

  return {
    /** Pointer entered or focus arrived: show after the delay. */
    ask() {
      if (open || waiting !== null) return;
      waiting = timers.set(() => {
        waiting = null;
        set(true);
      }, delay);
    },
    /** Pointer left, focus left or Escape: hide now. */
    hide() {
      cancel();
      set(false);
    },
    isOpen: () => open,
  };
}
