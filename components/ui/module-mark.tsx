import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK, moduleById, type MarkKey, type MarkShape, type ModuleId } from '@/lib/modules';

/**
 * One mark, any number of faces.
 *
 * Three values and never more: a ground tinted with the module's hue, the
 * object drawn solid in that hue, and one detail held back in white. That is
 * the whole construction, identical in all eight, and it is what makes them a
 * set rather than eight drawings that happen to share a palette.
 *
 * -- What this replaced, and why --
 * For a long time every mark was the same four-node square: three constant
 * white nodes carrying no meaning, plus one coloured "key" in the top-right
 * corner that said which module you were in. The constellation did its job --
 * it was unmistakably one family -- but it spent three quarters of the mark
 * saying "this is the same app", which nobody needed telling three times, and
 * left a quarter for the only part that carried information. At sidebar size
 * the thing you actually had to read was about five pixels across.
 *
 * So the three nodes are gone and the object is the mark. Cohesion now comes
 * from the construction being identical rather than from a motif being
 * repeated, which is the more expensive way to get it and the only one that
 * leaves the whole tile for the picture.
 *
 * -- The three values --
 * 1. The ground. The module's light hue at 16%, over whatever is behind it.
 *    Translucent on purpose: it is the one part of the mark that follows the
 *    theme, and it does it without this file knowing anything about themes.
 * 2. The object. A light-to-deep ramp within the one hue, at full strength,
 *    landing on the workspace's own accent. Never two hues -- see HOME_MARK
 *    for the single exception.
 * 3. The detail, in white. Exactly one per mark, and it is always the thing
 *    that *names* the object rather than a highlight: the gap between a cart's
 *    basket and its rail, the clasp on a case, the keyhole. Restraint here is
 *    most of why these survive being small -- a second detail is the one that
 *    closes up into mud at 18px and takes the first one with it.
 *
 * The white is not painted. It is cut out of the object, so it shows the tinted
 * ground through: near-white on a light page, near-black on a dark one, and
 * right in all four themes without a branch anywhere.
 */

/**
 * The ground: a superellipse, not a rounded rectangle.
 *
 * Generated rather than written as a path with four arcs because the whole
 * point is that the curvature is continuous -- a rounded rect has four places
 * where a straight edge hands off to an arc, and at 44px you can see every one
 * of them. n = 4.6 is the exponent that reads as "the shape every app icon on
 * a phone is" without tipping over into a circle.
 */
function superellipse(size = 24, n = 4.6, steps = 96): string {
  const a = size / 2;
  const points: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    points.push(
      `${(a + Math.sign(c) * a * Math.abs(c) ** (2 / n)).toFixed(3)} ` +
        `${(a + Math.sign(s) * a * Math.abs(s) ** (2 / n)).toFixed(3)}`,
    );
  }
  return `M${points.join('L')}Z`;
}

/** Computed once. The shape never varies; only its fill does. */
const GROUND = superellipse();

/** How much of the ground the object is allowed. The rest is breathing room. */
const INSET = 0.8;

const SIZES = {
  sm: { box: 'size-6', px: 24 },
  md: { box: 'size-8', px: 32 },
  lg: { box: 'size-11', px: 44 },
} as const;

/**
 * The object, in the module's hue.
 *
 * Every one of these is closed, chunky and drawn about the same 24-unit box as
 * the ground. Read them as a set, never one at a time: two silhouettes chosen
 * separately end up confusable, and this set has already lost a shopping bag
 * that was indistinguishable from the briefcase beside it and a closed book
 * that read as an aeroplane.
 */
function Solid({ shape }: { shape: MarkShape }) {
  switch (shape) {
    case 'cart':
      // A cart, not a bag. The bag it replaced and the briefcase were both a
      // rounded rectangle with a bump on top and told apart only by their
      // proportion, which is not a difference anyone notices in a sidebar.
      return (
        <>
          <path d="M4.4 8.2h16.2a1.4 1.4 0 0 1 1.35 1.78l-2.1 7.5A2.6 2.6 0 0 1 17.35 19.4H8.5a2.6 2.6 0 0 1-2.5-1.9L3.1 6.5H1.5a1.3 1.3 0 0 1 0-2.6h2.6a1.3 1.3 0 0 1 1.25.95Z" />
          <circle cx="9.2" cy="21.2" r="1.8" />
          <circle cx="17" cy="21.2" r="1.8" />
        </>
      );

    case 'briefcase':
      // Wide, low, and the handle is a separate piece sitting on the lid
      // rather than a notch cut into it -- a notch is the first thing to close
      // up, and when it does the case becomes a plain rectangle.
      return (
        <>
          <rect x="2.2" y="7.9" width="19.6" height="13.2" rx="3.4" />
          <path d="M9 4.6h6a2.6 2.6 0 0 1 2.6 2.6v1.5h-2.8V7.4H9.2v1.3H6.4V7.2A2.6 2.6 0 0 1 9 4.6Z" />
        </>
      );

    case 'list':
    case 'lock':
    case 'book':
    case 'envelope':
    case 'flag':
    case 'terminal':
    case 'dash':
    default:
      return <SolidRest shape={shape} />;
  }
}

/** The other seven, split out only to keep either switch readable. */
function SolidRest({ shape }: { shape: MarkShape }) {
  switch (shape) {
    case 'list':
      // A card, and everything that says "list" is in the white. The object is
      // deliberately the dullest silhouette in the set: three white lines with
      // the last one struck through carry it, and a rounded square is the only
      // thing that gives them enough room to be three.
      return <rect x="3.2" y="2.9" width="17.6" height="18.2" rx="4" />;

    case 'lock':
      // A padlock. The shackle is a separate closed form rather than a stroked
      // arc, for the same reason nothing else here is stroked.
      return (
        <>
          <rect x="3.6" y="10.2" width="16.8" height="11.2" rx="3.6" />
          <path d="M12 2.6a5.4 5.4 0 0 1 5.4 5.4v2.6h-2.9V8a2.5 2.5 0 0 0-5 0v2.6H6.6V8A5.4 5.4 0 0 1 12 2.6Z" />
        </>
      );

    case 'book':
      // Open, not closed. A closed book is a rectangle with a bar down one
      // side, which the first pass drew and which everyone who looked at it
      // read as an aeroplane. Two leaves splayed from a gutter is a book at any
      // size, and it is the one asymmetric-about-the-horizontal shape here.
      return (
        <>
          <path d="M11 7.9 4 5.9A1.5 1.5 0 0 0 2.1 7.35v9.9a1.5 1.5 0 0 0 1.1 1.45L11 20.8Z" />
          <path d="M13 7.9v12.9l7.8-2.1a1.5 1.5 0 0 0 1.1-1.45v-9.9A1.5 1.5 0 0 0 20 5.9Z" />
        </>
      );

    case 'envelope':
      // An envelope with its flap up, so the silhouette peaks. A closed
      // envelope is a rounded rectangle, which the terminal beside it already
      // is and the list is a squarer version of -- three rectangles in one
      // switcher told apart by their proportions is the mistake this set was
      // redrawn to fix. The peak is the whole point: it is the only shape here
      // that is not flat on top.
      return (
        <path d="M12 2.5a1.7 1.7 0 0 1 1.02.34l8.14 6.1A2.1 2.1 0 0 1 22 10.62v7.78a3.4 3.4 0 0 1-3.4 3.4H5.4A3.4 3.4 0 0 1 2 18.4v-7.78a2.1 2.1 0 0 1 .84-1.68l8.14-6.1A1.7 1.7 0 0 1 12 2.5Z" />
      );

    case 'flag':
      // A pole with a swallowtail flag. The notch is what makes it a flag
      // rather than a sign on a post, and it is the only shape here with a
      // point cut into its edge.
      return (
        <>
          <rect x="3.4" y="2.4" width="2.8" height="19.4" rx="1.4" />
          <path d="M5 3.6h14.6a1.3 1.3 0 0 1 1.06 2.05L17.6 10l3.06 4.35A1.3 1.3 0 0 1 19.6 16.4H5Z" />
        </>
      );

    case 'terminal':
      // A window, and the prompt inside it is the whole joke. Steel rather than
      // a colour, and the one workspace deliberately off the sweep the others
      // sit on: this is the app looking at itself, not a place work lives.
      return <rect x="2.2" y="4.2" width="19.6" height="15.6" rx="3.6" />;

    case 'dash':
    default:
      // The app itself. Nineteen units by five and a half, at 3.4:1 -- fat
      // enough that the three-stop brand ramp has room to show all three, which
      // a thin rule does not. See HOME_MARK.
      return <rect x="2.6" y="9.2" width="18.8" height="5.6" rx="2.8" />;
  }
}

/**
 * The one detail, cut back out of the object.
 *
 * One per mark. If a second one ever looks necessary the object is wrong, not
 * the rule -- go and redraw the object.
 */
function Detail({ shape }: { shape: MarkShape }) {
  switch (shape) {
    case 'cart':
      // The gap between basket and rail. It is the single thing that stops a
      // trapezoid from being a trapezoid.
      return <rect x="6.1" y="10.6" width="14.6" height="1.9" rx="0.95" />;

    case 'briefcase':
      // The seam across the lid, and the clasp sitting on it.
      return (
        <>
          <rect x="2.2" y="12.4" width="19.6" height="2" rx="1" />
          <rect x="10.4" y="11.2" width="3.2" height="4.4" rx="1.1" />
        </>
      );

    case 'list':
      // Three lines, the last one shorter and struck off. The tick overruns the
      // card on purpose: it is the only thing in the set that breaks its own
      // silhouette, and it is what stops this reading as a page of text.
      return (
        <>
          <rect x="6.5" y="7.2" width="11" height="2" rx="1" />
          <rect x="6.5" y="11.2" width="11" height="2" rx="1" />
          <rect x="6.5" y="15.2" width="6.6" height="2" rx="1" />
          <path d="M13.9 17.9 16.3 20.3 21.6 15 19.9 13.3 16.3 16.9 15.6 16.2Z" />
        </>
      );

    case 'lock':
      // The keyhole, and only the keyhole. A seam across the body was drawn
      // first and made the lock a briefcase.
      return (
        <>
          <circle cx="12" cy="14.9" r="1.85" />
          <path d="M11 15.9h2l.5 3.3h-3Z" />
        </>
      );

    case 'book':
      // The gutter falls out of the two leaves being separate forms, so the
      // white here is only the lines on them -- two per leaf, tilted with the
      // page so they sit on it rather than on the viewer.
      return (
        <>
          <rect x="4.8" y="9.5" width="4.6" height="1.6" rx="0.8" transform="rotate(4 7.1 10.3)" />
          <rect x="4.8" y="13" width="3.4" height="1.6" rx="0.8" transform="rotate(4 6.5 13.8)" />
          <rect
            x="14.6"
            y="9.5"
            width="4.6"
            height="1.6"
            rx="0.8"
            transform="rotate(-4 16.9 10.3)"
          />
          <rect
            x="14.6"
            y="13"
            width="3.4"
            height="1.6"
            rx="0.8"
            transform="rotate(-4 16.3 13.8)"
          />
        </>
      );

    case 'terminal':
      // A chevron and a bar: the prompt, and the cursor after it.
      return (
        <>
          <path d="M6.6 9.1 10.9 12.7 6.6 16.3 5.1 14.5 7.3 12.7 5.1 10.9Z" />
          <rect x="12.4" y="14.6" width="6" height="2.1" rx="1.05" />
        </>
      );

    case 'flag':
      // The gap between pole and cloth. Without it the two merge into one
      // block at 18px and the pole stops reading as something you plant.
      return <rect x="6.2" y="3" width="1.5" height="14" rx="0.75" />;

    case 'envelope':
      // The fold the letter goes behind, drawn as one wide V. It runs the full
      // width on purpose: a small crease is the first thing to close up at
      // 18px, and without it the peak above reads as a roof.
      return <path d="M3.4 10.9 12 16.9 20.6 10.9v3.1L12 20v-3.1L3.4 14Z" />;

    case 'dash':
    default:
      // Nothing. The app is not one of the things, so there is nothing to name.
      return null;
  }
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
  const uid = useId();
  const rampId = `ramp${uid}`;
  const maskId = `mask${uid}`;

  return (
    <span
      className={cn('flex shrink-0 items-center justify-center', sizing.box, className)}
      aria-hidden
    >
      <svg width={sizing.px} height={sizing.px} viewBox="0 0 24 24" fill="none">
        <defs>
          {/*
            User space, not object space. Several of these objects are two
            pieces, and an objectBoundingBox ramp would restart on each of them
            -- the cart's two wheels would each get the full light-to-deep run
            and neither would agree with the basket above them.
          */}
          <linearGradient id={rampId} gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21">
            <stop offset="0" stopColor={key.from} />
            {key.mid ? <stop offset="0.5" stopColor={key.mid} /> : null}
            <stop offset="1" stopColor={key.to} />
          </linearGradient>

          {/*
            White keeps the object, black takes the detail back out of it. The
            result is a hole rather than a painted highlight, so what shows
            through is the tinted ground and the mark works in every theme.
          */}
          <mask id={maskId}>
            <g transform={`translate(12 12) scale(${INSET}) translate(-12 -12)`}>
              <g fill="#ffffff">
                <Solid shape={key.shape} />
              </g>
              <g fill="#000000">
                <Detail shape={key.shape} />
              </g>
            </g>
          </mask>
        </defs>

        <path d={GROUND} fill={key.from} fillOpacity={0.16} />
        <rect width="24" height="24" fill={`url(#${rampId})`} mask={`url(#${maskId})`} />
      </svg>
    </span>
  );
}
