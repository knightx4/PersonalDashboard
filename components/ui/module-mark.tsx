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
 * A workspace mark: the module's glyph in white on a gradient of its own hue.
 *
 * The gradient runs rich to deep within one hue -- never across two, which is
 * what made the original marks look cheap and made three of the four
 * indistinguishable. Running it darker rather than lighter means the white
 * glyph clears contrast at every point along it, and the inner highlight along
 * the top edge is what stops the whole thing reading as a flat sticker.
 *
 * Fixed hexes rather than theme tokens: a mark is an object, and an app icon
 * does not invert when the OS goes dark.
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
  const [from, to] = entry.mark;

  return (
    <span
      className={cn('relative flex shrink-0 items-center justify-center', sizing.box, className)}
      style={{
        backgroundImage: `linear-gradient(145deg, ${from} 0%, ${to} 100%)`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.22), 0 1px 2px rgb(0 0 0 / 0.18)`,
      }}
      aria-hidden
    >
      <Glyph className={cn('text-white', sizing.glyph)} strokeWidth={2} />
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
