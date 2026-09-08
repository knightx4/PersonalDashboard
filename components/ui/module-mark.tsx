import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK, moduleById, type MarkKey, type MarkShape, type ModuleId } from '@/lib/modules';

/**
 * One mark, any number of faces.
 *
 * Four nodes filling a square. Three of them never change and carry no
 * colour; the fourth -- top right -- is the module: a small picture of what it
 * is, in its own hue, and the only colour anywhere in the mark.
 *
 * That split is the point. The constant three say "this is the same app"
 * without needing to be looked at, and the key says which room you are in
 * without needing to be read. The version before this encoded the module in
 * *which* node was promoted, which was legible but ran out at four modules; a
 * picture plus a hue does not, and it is recognisable before anyone has
 * learned the colour.
 *
 * The tile is a fixed near-black rather than the module's colour. A coloured
 * tile with a coloured key is two things competing to be the signal, and the
 * gradient-filled rounded square it used to be is the most dated shape in
 * software.
 *
 * Geometry is in a 24 unit box so the same paths serve 20px and 44px.
 *
 * -- The 2026 redraw --
 * Everything below was tightened in one pass, because the marks had drifted
 * into the soft, generous, friendly geometry of a late-2010s app icon while
 * the rest of the interface went the other way. The change is not "sharper
 * corners" applied uniformly -- at sixteen pixels a sharpened blob is still a
 * blob. It is three specific things:
 *
 *   1. Radii came down from about a third of a shape to about a sixth. A
 *      corner that reads as *drawn* rather than as *softened* is most of the
 *      difference between a draughtsman's mark and a sticker.
 *   2. Every silhouette is now built from flats and 45 degree cuts. No pills,
 *      no arcs, and -- with the orb retired -- no circles anywhere in the set.
 *   3. Shapes that used to be told apart by their *detail* are now told apart
 *      by their *proportion*, because detail is the first thing sixteen pixels
 *      takes away and proportion is the last. The bag and the briefcase were
 *      the standing confusion and both were a 9.8-wide rounded rectangle with
 *      a bump on top; they are now a tall narrow one and a wide low one, which
 *      still reads when the bump has closed up.
 */

/**
 * The three that never move, and the corner the key sits in.
 *
 * Pushed out near the edges: the constellation is the mark, not a motif
 * floating in a tile, and the earlier version left so much padding that the
 * tile read as the logo and the squares as an afterthought.
 */
const CONSTANT_CELLS = [
  [7.1, 7.1],
  [7.1, 16.9],
  [16.9, 16.9],
] as const;
const KEY_CELL = [16.9, 7.1] as const;

const NODE = 8.2;
/**
 * A sixth of the node, not a third.
 *
 * The three constants are half the ink in the mark, so their corner is half
 * the mark's character. At 0.32 they were squircles and no amount of
 * sharpening in the key could outvote them; at 0.16 they read as squares that
 * were deliberately eased rather than as pebbles. Still eased, though -- a
 * true right angle at 44px turns the constellation into graph paper.
 */
const NODE_RADIUS = NODE * 0.16;

/**
 * Tile radius is a quarter of the tile, down from 0.29.
 *
 * Small enough to be a rounded square rather than a squircle, large enough
 * that it is plainly still a tile. Written per size rather than as a ratio
 * because Tailwind needs the literal.
 */
const SIZES = {
  sm: { box: 'size-6 rounded-[6px]', svg: 17 },
  md: { box: 'size-8 rounded-[8px]', svg: 22 },
  lg: { box: 'size-11 rounded-[11px]', svg: 30 },
} as const;

/** Near-black, fixed. The mark is an object; it does not follow the theme. */
const TILE = '#101216';

/**
 * The key, drawn about its own centre.
 *
 * Every one of these is a single filled silhouette. No strokes, no counters,
 * and no gap narrower than roughly a sixth of the shape -- at twenty-four
 * pixels the key is about five, and anything finer than that closes up into a
 * blob. It is also why the bag has two ears rather than a drawn handle: the
 * gap between them survives being small, a 1px arc does not.
 *
 * Each runs a little larger than a constant node and overruns its cell, so it
 * reads as the thing the other three are pointing at rather than as a fourth
 * one of them.
 *
 * Read them as a set, never one at a time. Two silhouettes chosen separately
 * end up confusable, and the pair that proves it is here: bag and briefcase.
 */
function KeyShape({ shape, fill }: { shape: MarkShape; fill: string }) {
  const [cx, cy] = KEY_CELL;

  switch (shape) {
    case 'dash':
      // The app itself: a dash, and the only key that is one element.
      //
      // It replaced an orb, which was a circle -- the one shape in the set
      // with no drawn corner at all, and the reason the home mark always read
      // as a different family from the six it sits with. A bar is the same
      // draughtsman's vocabulary as everything else here, and being the widest
      // and flattest thing in the mark it is also the first thing the eye
      // lands on, which is what it is for.
      //
      // 9.2 by 3.5, at 2.6:1. The full ten units the key envelope allows was
      // tried first and at sixteen pixels the dash ran straight into the
      // top-left node -- no black between them, and the two together read as
      // an L rather than as a square and a dash. Eight tenths of a unit back
      // buys one whole pixel of separation at the smallest size anyone sees
      // this at, and costs nothing anywhere else. Squarer than 2.6:1 and it
      // stops being punctuation and starts being a fourth node lying down.
      return <rect x={cx - 4.6} y={cy - 1.75} width={9.2} height={3.5} rx={0.35} fill={fill} />;

    case 'bag':
      // Tall and narrow, tapering to the base, with two square ears.
      //
      // The arch-with-a-hole this replaces admitted in its own comment that it
      // closed into a blob below 32px. Two ears with two and a half units of
      // black between them survive to about 20, and below that the *portrait*
      // proportion is what separates this from the briefcase -- which is the
      // point of making one of them tall and the other wide.
      //
      // The ears are stubs, not prongs. A first cut had them 1.6 wide and 3.2
      // tall and the mark read as a trident: two spikes are a weapon, two
      // stubs are where a handle was. Wider than they are tall, and the
      // reading changes completely.
      return (
        <g fill={fill}>
          <rect x={cx - 3.15} y={cy - 4.4} width={1.9} height={2.7} rx={0.3} />
          <rect x={cx + 1.25} y={cy - 4.4} width={1.9} height={2.7} rx={0.3} />
          <path
            d={`M${cx - 4.3} ${cy - 1.9}H${cx + 4.3}L${cx + 3.2} ${cy + 5}H${cx - 3.2}Z`}
          />
        </g>
      );

    case 'briefcase':
      // Wide and low, with one broad handle that merges into the body.
      //
      // Deliberately the opposite proportion to the bag: 10 wide by 8.6 tall
      // against the bag's 8.6 by 9.4. Where the bag has two narrow ears this
      // has one handle
      // nearly half the body wide, so even after every edge has closed up the
      // two silhouettes are a wide block with a wide bump and a tall block
      // with two thin ones.
      return (
        <g fill={fill}>
          <rect x={cx - 2.4} y={cy - 4.4} width={4.8} height={2.4} rx={0.35} />
          <rect x={cx - 5} y={cy - 2.6} width={10} height={6.8} rx={0.5} />
        </g>
      );

    case 'check':
      // A tick with both ends cut square to the arm, and a constant 2.1 unit
      // stroke. The old one narrowed at the joint and the short arm ended on a
      // vertical, which at 44px looked like a tick that had been squashed.
      return (
        <path
          fill={fill}
          d={`M${cx - 4.54} ${cy + 0.63}L${cx - 1.5} ${cy + 3.67}L${cx + 4.3} ${cy - 2.13}L${cx + 2.82} ${cy - 3.62}L${cx - 1.5} ${cy + 0.7}L${cx - 3.06} ${cy - 0.86}Z`}
        />
      );

    case 'page':
      // A sheet with the corner taken off at 45 degrees, no radius anywhere.
      //
      // The cut is 3.4 units on a 7.8 unit sheet -- a fold you can still see at
      // 20px, where the old 3.8-on-8 cut had already rounded itself away. It
      // is the only shape in the set with a diagonal edge and no other
      // feature, which is what keeps it clear of the bag beside it.
      return (
        <path
          fill={fill}
          d={`M${cx - 3.9} ${cy - 5}H${cx + 0.5}L${cx + 3.9} ${cy - 1.6}V${cy + 5}H${cx - 3.9}Z`}
        />
      );

    case 'stack':
      // Three bars, square-cut, wide gaps: a pile of things to get through.
      //
      // The rounded ends went because at 44px three pills read as a stack of
      // sausages, and because the bar is the one element the dash also uses --
      // they should be cut the same way. Thick enough that the two gaps
      // survive at 24px, which an outlined book would not, and unmistakable
      // against the page's single leaf.
      return (
        <g fill={fill}>
          <rect x={cx - 5} y={cy - 4.9} width={10} height={2.4} rx={0.3} />
          <rect x={cx - 5} y={cy - 1.2} width={10} height={2.4} rx={0.3} />
          <rect x={cx - 5} y={cy + 2.5} width={10} height={2.4} rx={0.3} />
        </g>
      );

    case 'bolt':
    default:
      // The workshop: a solid bolt, no notch narrow enough to close up. It
      // reads as "the thing that makes the rest of it work" rather than as a
      // place you keep something, which is what the others are.
      //
      // Steeper than it was. The old one leaned at nearly 45 degrees and at
      // small sizes read as an arrow; pulling the head and tail towards the
      // vertical makes it a bolt again, and gives the set its only shape with
      // reflex corners.
      return (
        <path
          fill={fill}
          d={`M${cx + 1.2} ${cy - 5}L${cx - 4.6} ${cy + 1.1}H${cx - 0.9}L${cx - 1.2} ${cy + 5}L${cx + 4.6} ${cy - 1.1}H${cx + 0.9}Z`}
        />
      );
  }
}

/**
 * Which way the two stops run.
 *
 * A diagonal on a shape three times wider than it is tall spends most of its
 * length in the middle mix and shows neither end, so the dash -- the one place
 * two genuinely different hues meet, and the only reason anyone would look for
 * a gradient at all -- runs along its length instead. Everything else keeps
 * the diagonal, where a single hue's rich-to-deep ramp reads as shading.
 */
function gradientVector(shape: MarkShape): { x2: string; y2: string } {
  return shape === 'dash' ? { x2: '1', y2: '0' } : { x2: '1', y2: '1' };
}

export function ModuleMark({
  module,
  size = 'md',
  className,
}: {
  /** null means the app itself. */
  module: ModuleId | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const entry = moduleById(module) ?? HOME_MARK;
  const key = entry.key as MarkKey;
  const sizing = SIZES[size];
  const gradientId = useId();
  const vector = gradientVector(key.shape);

  return (
    <span
      className={cn('relative flex shrink-0 items-center justify-center', sizing.box, className)}
      style={{
        background: TILE,
        // A near-black tile on a near-black surface needs an edge, or the mark
        // dissolves into the sidebar in three of the five themes.
        boxShadow:
          'inset 0 0 0 1px rgb(255 255 255 / 0.09), inset 0 1px 0 rgb(255 255 255 / 0.13)',
      }}
      aria-hidden
    >
      <svg width={sizing.svg} height={sizing.svg} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2={vector.x2} y2={vector.y2}>
            <stop offset="0%" stopColor={key.from} />
            <stop offset="100%" stopColor={key.to} />
          </linearGradient>
        </defs>

        {CONSTANT_CELLS.map(([cx, cy]) => (
          <rect
            key={`${cx}-${cy}`}
            x={cx - NODE / 2}
            y={cy - NODE / 2}
            width={NODE}
            height={NODE}
            rx={NODE_RADIUS}
            fill="#ffffff"
            // Dimmed, so the key leads. At full white the three constants
            // shout as loudly as the one thing that carries meaning.
            opacity={0.68}
          />
        ))}

        <KeyShape shape={key.shape} fill={`url(#${gradientId})`} />
      </svg>
    </span>
  );
}
