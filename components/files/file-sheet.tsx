import { cn } from '@/lib/cn';

const SHEET_RADIUS = 'calc(var(--radius-control) / 2)';

export type FileSheetTone = 'dash' | 'yours' | 'waiting' | 'pending';

/**
 * The small page before a file, as the approved goal mockup draws it
 * (docs/references/goal-dashboard): a sheet about 34 by 40 with tight
 * corners, its top-right corner folded, and its kind small at the foot (Note,
 * PDF, Img), tinted in the accent for Dash's, plain for yours, and dashed and
 * empty for a document still waiting. The label stays on the type scale's
 * smallest step, so the sheet is a little wider than the mockup's to keep it
 * clear of the sides (plan #2778.11). The goal's Work & files tab and its
 * Recent files card both draw it.
 */
export function FileSheet({ label, tone }: { label: string; tone: FileSheetTone }) {
  return (
    <span
      aria-hidden
      // Half a control's corner: tight, as the mockup's sheet is (4px at the
      // default radius), and still moving with a theme that squares or rounds
      // its corners.
      style={{ borderRadius: SHEET_RADIUS }}
      className={cn(
        'relative grid h-11 w-9 shrink-0 place-items-end justify-center border pb-1 text-micro leading-none font-medium uppercase', // ui-ok: hand-rolled-box hand-rolled-label -- a file's page-shaped mark from the approved mockup, not a grouping or a label over a field
        tone === 'dash' && 'border-accent/40 bg-accent-tint text-accent',
        tone === 'yours' && 'border-control bg-canvas text-ink-muted',
        tone === 'waiting' && 'border border-dashed border-control text-ink-muted',
        tone === 'pending' && 'border-control bg-sunken text-ink-muted',
      )}
    >
      {/* The folded corner: the card's colour cut across the sheet's border colour. */}
      {tone !== 'waiting' && (
        <span
          className="absolute -top-px -right-px size-2.5 bg-surface"
          style={{ borderTopRightRadius: SHEET_RADIUS }}
        >
          <span
            className={cn(
              'absolute inset-0 [clip-path:polygon(0_0,0_100%,100%_100%)]',
              tone === 'dash' ? 'bg-accent/40' : 'bg-control',
            )}
          />
        </span>
      )}
      {label}
    </span>
  );
}
