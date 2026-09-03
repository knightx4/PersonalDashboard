import { Briefcase, LayoutGrid, ListChecks, NotebookText, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { HOME_MARK, moduleById, type ModuleIconName, type ModuleId } from '@/lib/modules';

/**
 * One glyph per module, in one place.
 *
 * There used to be three lists of these -- the switcher drew gradients, the
 * home page drew Lucide icons, and Account drew them again -- which is two
 * lists too many and exactly the drift lib/modules.ts exists to prevent. The
 * name lives on the module; the component lives here.
 */
const GLYPHS: Record<ModuleIconName, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  shopping: ShoppingBag,
  jobs: Briefcase,
  todo: ListChecks,
  vault: NotebookText,
  home: LayoutGrid,
};

const SIZES = {
  sm: { box: 'size-6 rounded-md', glyph: 'size-3.5' },
  md: { box: 'size-8 rounded-lg', glyph: 'size-4' },
  lg: { box: 'size-11 rounded-xl', glyph: 'size-5' },
} as const;

/**
 * A workspace mark: a flat tint of the module's own hue with its glyph
 * stroked in that hue.
 *
 * Not a gradient. A two-hue diagonal ramp is decoration pretending to be
 * identity -- three of the four old marks started on the same blue, so the
 * hue could not tell you which workspace you were in, and the ramps were the
 * first thing that looked wrong when the theme changed. The glyph is the
 * mnemonic and the hue confirms it, which is also why colour is never the
 * only signal here.
 *
 * `color-mix` rather than a pre-mixed token: the tint has to be the module's
 * hue over whatever surface the current theme uses, and there are five of
 * those.
 */
export function ModuleMark({
  module,
  size = 'md',
  className,
}: {
  /** null means the app itself -- the home mark. */
  module: ModuleId | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const entry = moduleById(module) ?? HOME_MARK;
  const Glyph = GLYPHS[entry.icon];
  const sizing = SIZES[size];

  return (
    <span
      className={cn('flex shrink-0 items-center justify-center border', sizing.box, className)}
      style={{
        background: `color-mix(in srgb, var(${entry.accent}) 13%, var(--c-surface))`,
        borderColor: `color-mix(in srgb, var(${entry.accent}) 30%, transparent)`,
        color: `var(${entry.accent})`,
      }}
      aria-hidden
    >
      <Glyph className={sizing.glyph} strokeWidth={1.75} />
    </span>
  );
}

/** The glyph alone, for a list row or a settings toggle. */
export function ModuleGlyph({
  module,
  className,
}: {
  module: ModuleId | null;
  className?: string;
}) {
  const entry = moduleById(module) ?? HOME_MARK;
  const Glyph = GLYPHS[entry.icon];
  return <Glyph className={cn('size-4', className)} strokeWidth={1.75} aria-hidden />;
}
