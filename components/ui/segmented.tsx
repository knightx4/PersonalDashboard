import { cn } from '@/lib/cn';

/**
 * The frame's classes without the segments, for a set whose segments are links
 * rather than buttons. Same idea as `cardVariants`: one spelling of the box,
 * wherever the thing inside it has to be something else.
 */
export const segmentedFrame = 'inline-flex overflow-hidden rounded-control border border-control';

/**
 * One of a few mutually exclusive modes, as a joined control.
 *
 * This exists because the app had two spellings of the same idea and neither
 * of them was a control: the pipeline's board/list switch was a hand-rolled
 * `inline-flex overflow-hidden rounded-lg border` with its own `h-8` — a box
 * off the density dial, and a border law 11 has nothing good to say about
 * because it is drawn by hand — and the add flow's shelf/cover switch is two
 * `Button`s flipping between `primary` and `secondary`, which paints the
 * *selected* mode in the colour the page's actual primary action wears. A
 * filled accent button that does not submit anything is a lie about which
 * button matters.
 *
 * So: one frame around the set, the segments inside it, and the choice marked
 * with the accent tint rather than the accent fill. Height comes from the dial
 * so it lines up with the buttons and selects it sits beside.
 *
 * `aria-pressed` per segment rather than a radio group, because that is what
 * these are: buttons that stay down. The `<span role="group">` and its label
 * are what tell a screen reader the set is one question.
 *
 * Deliberately not a `<select>`. A chip select is the right shape for a
 * property with several values; this is for two or three, where the whole
 * choice fits on screen and seeing the alternative is most of the point.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (value: T) => void;
  /** Names the question the segments answer, for the accessibility tree. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span
      role="group"
      aria-label={label}
      className={cn(segmentedFrame, className)}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'press inline-flex h-(--control-h) items-center gap-1.5 px-2.5 text-ui font-medium',
              'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
              'focus-visible:outline-2 focus-visible:-outline-offset-2',
              on
                ? 'bg-accent-tint text-accent'
                : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </span>
  );
}
