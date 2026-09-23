/**
 * The design laws, as far as a machine can hold them.
 *
 *   npm run check:ui                  # check
 *   npm run check:ui -- --list        # check, and print every violation
 *   npm run check:ui -- --module vault  # check one workspace's files only
 *   npm run check:ui -- --update      # re-record the baseline
 *
 * Written after an audit found eighty-six hand-rolled boxes and one bug that
 * had been shipping silently for months, both by grep. That is the argument
 * for this file: everything findable that way should be found by a script that
 * runs on every push, not by whoever happens to look. A review finds a
 * violation once; a gate finds it forever.
 *
 * It only holds the laws that are *mechanical*. "Does this feel like a form"
 * is not in here and cannot be -- that is the residue a person reads. What is
 * in here is the majority by count, which is what clears the ground so the
 * residue is visible.
 *
 * -- The ratchet --
 * The codebase did not pass on the day this was written, and waiting until it
 * did would have meant landing the gate after the cleanup it exists to
 * measure. So violations are counted per file per rule and compared against
 * scripts/ui-baseline.json: a count going *up*, or a violation in a file with
 * no entry, fails. A count going down is reported and asks for --update, which
 * is how the number only ever moves one way. New code is held to zero from its
 * first line, because a new file has no baseline entry.
 *
 * -- The pressure valve --
 * A `ui-ok:` comment on the offending line, or on the line above it,
 * suppresses that line. For something that is right across a whole block --
 * the four brand hexes inside a Google logo, say -- `ui-ok-file: <rule-id>`
 * anywhere in the file suppresses that one rule in that one file. It has to
 * name the rule, so it is an exemption rather than an amnesty: a file excused
 * for its logo is still held to every other law.
 *
 * A rule that cannot be escaped gets worked around by whoever is in a hurry,
 * and a worked-around rule is worse than no rule because it also lies. The
 * reason after the colon is not checked -- it is there so the next reader
 * knows it was a decision rather than an oversight.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { MODULE_IDS, isModuleId, type ModuleId } from '../lib/modules';
import { scopeForFile, UI_SCOPES } from '../lib/ui-review/scope';

const ROOT = process.cwd();
const BASELINE = join(ROOT, 'scripts/ui-baseline.json');
const ROOTS = ['app', 'components'];

/**
 * The primitives are where the app is allowed to write the thing everywhere
 * else must not. `Card` has to say `rounded-card border` somewhere, or there
 * is no Card for anyone to use instead.
 */
const EXEMPT = ['components/ui/'];

// -- The one rule that reads the real CSS -----------------------------------
/**
 * Which `--color-*` are unsafe to read through `var()`.
 *
 * A custom property inherits its *computed* value. The scoped tokens are given
 * their value below :root -- at <body>, at [data-workspace], again at anything
 * painting a sheet -- so `var(--color-accent)` read at :root computes to
 * nothing and every descendant inherits that nothing, whatever scope surrounds
 * it. The utility class resolves at the element and is correct; the var is
 * silently empty. Not a hypothetical: four checkboxes shipped with
 * `accent-[var(--color-accent)]` and no accent colour at all.
 *
 * Derived, not listed. A token is unsafe when its `--c-*` source is never
 * declared at :root or in a theme block, and that is a fact about
 * app/globals.css which this reads rather than remembers -- so a token that
 * gains or loses a root value moves in and out of this set on its own.
 */
function unsafeTokens(): Set<string> {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

  // The names `@theme inline` exposes, and the raw variable each points at.
  const exposed = new Map<string, string>();
  for (const [, name, source] of css.matchAll(/--color-([\w-]+):\s*var\(--(c-[\w-]+)\)/g)) {
    exposed.set(name, source);
  }

  // Every raw variable given a value at :root or under a theme -- everything
  // that has resolved before any scope gets involved.
  const rooted = new Set<string>();
  for (const block of css.matchAll(/(:root|\[data-theme='[\w-]+'\])[^{]*\{([\s\S]*?)\n\}/g)) {
    // Capture without the leading `--`, to match the shape `exposed` holds.
    for (const [, name] of block[2]!.matchAll(/^\s*--(c-[\w-]+):/gm)) rooted.add(name);
  }

  const unsafe = new Set<string>();
  for (const [name, source] of exposed) if (!rooted.has(source)) unsafe.add(name);
  return unsafe;
}

const UNSAFE = unsafeTokens();

// -- The rules --------------------------------------------------------------
type Rule = {
  id: string;
  law: string;
  says: string;
  instead: string;
  /**
   * Paths this one rule does not ask about. Absent means everywhere under
   * ROOTS, which is what nearly every rule wants.
   *
   * Separate from EXEMPT above, which excuses the primitives from every rule
   * at once. This is for a rule whose subject has a home: the place the thing
   * is *defined* has to be allowed to write it, or there is nothing for
   * everywhere else to use instead.
   */
  skip?: RegExp;
  /**
   * Paths this rule asks about, and no others. Absent means everywhere under
   * ROOTS.
   *
   * The inverse of `skip`, for a rule whose subject only exists in one kind of
   * file: a server action lives in an actions file, and a rule about actions
   * asked of every component would be a rule about nothing.
   */
  only?: RegExp;
  /** Every offending span on this line, or nothing. */
  find: (line: string, context: RuleContext) => string[];
};

/**
 * What a rule can see besides the line it is on.
 *
 * Most rules need nothing here: a hex or an off-scale size is settled by the
 * line it is written on. The shape rules are not. A card drawn per row opens on
 * the `.map(` and names `<Card` three lines down; a composer left open is
 * recognised by what is *not* above it. Both are still line-anchored -- the hit
 * is reported where the offending markup starts -- they just need to look
 * around before deciding.
 */
type RuleContext = {
  /** The file, relative to the root, for a rule about where a file sits. */
  file: string;
  /** Which line this is, counting from zero. */
  index: number;
  /** The six lines below, for a shape that opens on one line and lands on another. */
  after: string[];
  /** Every line above, for walking out to what encloses this one. */
  before: string[];
  /** The whole file, for asking what kind of surface this is. */
  source: string;
};

/** A condition that can keep the markup beneath it off the screen. */
const GATE = /\{\s*\w[\w.]*\s*&&|\?\s*\(|\)\s*:\s*\(|\{editing|\{open|\{isOpen|\{show/;

/** `if (!composing) return …` -- a guard beside the JSX rather than around it. */
const EARLY_RETURN = /\bif\s*\(![\w.]+\)\s*(?:\{|return)/;

/** Where a block ends, for the walk below: the function this line lives in. */
const FUNCTION_START = /^\s*(?:export\s+)?(?:default\s+)?function\s|^\s*const\s+\w+\s*=\s*\(/;

/** How deep a line is indented, which stands in for how deeply it is nested. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Whether any block enclosing this line matches `pattern`.
 *
 * Walks outward by indentation: each successively shallower line above is an
 * ancestor of this one, near enough, in a codebase formatted this consistently.
 * Stops at the enclosing function, because past that the question is about a
 * different component and the answer would be a coincidence.
 */
function encloses(line: string, before: string[], pattern: RegExp): boolean {
  let level = indentOf(line);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const candidate = before[i]!;
    if (!candidate.trim() || indentOf(candidate) >= level) continue;
    level = indentOf(candidate);
    if (pattern.test(candidate)) return true;
    if (FUNCTION_START.test(candidate)) return false;
  }
  return false;
}

/**
 * Whether a trimmed line is comment text.
 *
 * `{/*` is in the list because JSX comments open that way, and leaving it out
 * silently broke the valve for every rule that fires on markup rather than on a
 * class string: the marker sat directly above the offending line, the walker
 * did not recognise the line it was on as a comment, and stopped before
 * reading it. Found by trying to excuse a card-per-row that was genuinely
 * right and being unable to.
 */
function isCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('{/*')
  );
}

/**
 * `border` on its own. `border-t` is a rule drawn between things rather than a
 * frame drawn around one, and law 11 is about frames.
 *
 * The lookbehind is what stops `bg-border` counting as a border. `border` is
 * both a utility and the name of a colour token, so `bg-border`, `divide-border`
 * and `ring-border` all contained the word and none of them draws an edge --
 * which is how a 1px progress track spelled `h-1 flex-1 rounded-full bg-border`
 * came to be reported as a hand-rolled box in three files. A false positive is
 * worse than a miss here: the only ways to clear one are to write `ui-ok:` on a
 * line that never broke the law, which turns the gate into a lie, or to mangle
 * correct code until the grep stops matching.
 *
 * That was first fixed with a lookbehind, which stopped `bg-border` but left a
 * subtler one: the lookahead excluding `border-t` and `border-2` let
 * `border-<colour>` through, so `border-t border-border` -- a top rule with a
 * colour, and no frame anywhere -- would have been reported as a box. Nothing
 * in the tree was spelled that way, so it never fired, but a latent false
 * positive in a gate is a trap laid for whoever writes that line next.
 *
 * So this stopped being a pattern with exceptions and became what it always
 * meant: the token is exactly `border`, on its own. Everything hyphenated is
 * something else -- a side, a width, a colour -- and none of those is a frame.
 */
const FULL_BORDER = /(?:^|\s)border(?=\s|$)/;

/**
 * Every shape a class list is written in.
 *
 * The first two are the obvious ones. The third is here because a sweep found
 * two boxes this missed: a class list spelled inside a ternary, a `cn()` call
 * or a concatenation is still a class list, and reading only `className="…"`
 * meant a box drawn conditionally was invisible while the identical box drawn
 * unconditionally was caught. That is the worst kind of gap in a gate -- not
 * that it misses things, but that what it misses correlates with the code
 * being complicated, which is where the mistakes are.
 *
 * So the third alternative takes any single- or double-quoted string that
 * looks like a class list, anywhere on the line. It is looser than the first
 * two on purpose: the two rules that consume it both require a `rounded-` and
 * a bare `border` in the same string, which prose does not contain.
 */
const CLASS_STRING =
  /className=(?:"([^"]*)"|\{`([^`]*)`\})|'([^']*\b(?:rounded|border|bg)-[^']*)'/g;


/**
 * Whether a route segment, or any segment above it, has this file.
 *
 * Next resolves loading.tsx and error.tsx from the nearest ancestor, so a page
 * is covered by one written anywhere between it and app/. The walk stops at
 * app/ itself: the root layout's own files cover every route, and this gate
 * wants each workspace to draw its own shape.
 */
function routeHas(file: string, name: 'loading.tsx' | 'error.tsx'): boolean {
  let dir = dirname(file);
  while (dir !== 'app' && dir !== '.' && dir.startsWith('app')) {
    if (existsSync(join(ROOT, dir, name))) return true;
    dir = dirname(dir);
  }
  return false;
}

/** The class strings on this line, however they are spelled. */
function classStrings(line: string): string[] {
  return [...line.matchAll(CLASS_STRING)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
}

/**
 * The opening tag that starts on this line, up to its closing `>`, joined into
 * one string. Props in this codebase are one per line once there are more than
 * two, so a rule reading only the first line of a tag misses most of them.
 */
function openingTag(line: string, after: string[]): string {
  const parts = [line];
  for (const next of after) {
    if (/>\s*$|\/>/.test(parts[parts.length - 1]!)) break;
    parts.push(next);
  }
  return parts.join(' ');
}

/** Text a person reads: JSX text between tags, and quoted strings. */
const READ_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;

const RULES: Rule[] = [
  {
    id: 'hand-rolled-box',
    law: '11',
    says: 'a rounded box with a full border, drawn by hand',
    instead: 'Card, CardSection, or Group where the grouping needs no frame at all',
    find: (line) => {
      const out: string[] = [];
      for (const match of line.matchAll(CLASS_STRING)) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        if (/\brounded-/.test(value) && FULL_BORDER.test(value)) out.push(value.slice(0, 64));
      }
      return out;
    },
  },
  {
    id: 'fixed-control-height',
    law: '9',
    says: 'a control height written as a number',
    instead: 'h-(--control-h), so it follows the density dial and the controls beside it',
    /**
     * `h-9`, and not `min-h-9`.
     *
     * This is FULL_BORDER's mistake in a second rule and it was found the same
     * way -- by reading what the gate was reporting rather than trusting the
     * count. The pattern was `\b(h-(?:9|10|11)|min-h-24)\b`, and `\b` matches
     * between the hyphen and the `h`, so every `min-h-9` and `max-h-10` in the
     * tree was reported as a control written at a fixed height. It was
     * reporting exactly two things, and neither was a control: an hour lane in
     * the week grid (`min-h-9`, the floor an empty hour keeps so a day does
     * not collapse) and a day square in the month grid (`sm:min-h-24`).
     *
     * `min-h-24` was in the list on purpose, aimed at a hand-sized textarea.
     * But it is the same category error as the one it let through: the rule's
     * own name and its own message say *a control height*, and a min-height is
     * a floor on a container -- what a calendar cell, a drop target or an empty
     * lane needs so it stays clickable when it holds nothing. There is no dial
     * variable for that and nothing beside it to agree with, so there is
     * nothing for the rule to be asking.
     *
     * So it means what it says: an exact height, on its own, which is the
     * shape a control is written in. Everything with a prefix is a different
     * property.
     */
    find: (line) => [...line.matchAll(/(?<![\w-])(h-(?:9|10|11))\b/g)].map((m) => m[1]!),
  },
  {
    id: 'scoped-token-in-var',
    law: '-',
    says: 'a scoped token read through var(), which computes to nothing at :root and inherits that nothing',
    instead: 'the utility class, which resolves at the element instead',
    find: (line) => {
      const out: string[] = [];
      for (const match of line.matchAll(/var\(--color-([\w-]+)\)/g)) {
        if (UNSAFE.has(match[1]!)) out.push(match[0]);
      }
      return out;
    },
  },
  {
    id: 'raw-hex',
    law: '4',
    says: 'a colour written as a hex',
    instead: 'a token: four themes cannot follow a literal',
    find: (line) => [...line.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]),
  },
  {
    id: 'off-scale-text',
    law: '-',
    says: 'a font size outside the named scale',
    instead: 'text-micro | text-small | text-ui | text-body | text-title | text-figure',
    find: (line) => [...line.matchAll(/\btext-\[[\d.]+(?:px|rem|em)\]/g)].map((m) => m[0]),
  },
  {
    id: 'card-per-row',
    law: '13',
    says: 'a Card drawn once per item in a list',
    instead: 'one surface with divide-y between rows, so a row costs 36px instead of 95',
    /**
     * A `.map(` in JSX with a `<Card` a few lines under it.
     *
     * Two lines of context rather than one, because the pattern is spread over
     * both -- and the map has to be inside JSX, or `new Map(people.map(...))`
     * and a `days.map()` filter both report as lists of cards. Requiring the
     * `{` in front dropped exactly those two from eleven candidates to nine,
     * and all nine were real.
     *
     * This rule is fuzzier than the other five, which is what the baseline and
     * the valve are for: a chooser of four cards side by side is law 13 obeyed,
     * not broken, and says so on the line.
     */
    find: (line, { after }) => {
      if (!/\{\s*[\w.[\]()\s,...]*\.map\(/.test(line)) return [];
      return after.some((next) => /<Card\b/.test(next)) ? ['<Card> per mapped row'] : [];
    },
  },
  {
    id: 'stage-tint-without-glyph',
    law: '4',
    says: 'a stage tint painted as the ground of a chip, where the shape should be saying the state',
    instead: 'StatusGlyph in the stage ink, which still says the state in a greyscale screenshot',
    /**
     * `bg-status-*-tint`, anywhere but where the stage chip is drawn.
     *
     * Eleven statuses were told apart by hue alone until the glyphs landed,
     * which meant anybody who cannot separate amber from red read the same
     * chip for "in process" and "rejected". The glyph is what carries the
     * state now, and StatusBadge is the only thing that draws it — so a tint
     * appearing anywhere else is a surface that copied a class list from an
     * older one and left the shape behind.
     *
     * Three places are allowed to write it: components/ui, which is exempt
     * from every rule and is where the glyph itself lives; the badge, which is
     * the one map from a status to a colour; and /dev/ui, which is the page
     * showing the reader what the tints are.
     */
    skip: /^(?:components\/jobs\/ui\/status-badge\.tsx|app\/dev\/ui\/)/,
    find: (line) => [...line.matchAll(/\bbg-status-[\w-]+-tint\b/g)].map((m) => m[0]),
  },
  {
    id: 'composer-always-open',
    law: '14',
    says: 'a compose box standing open in a section that lists what is already there',
    instead: 'AddTrigger, and render the composer when it is pressed',
    /**
     * A `Textarea` or `ComposeBody` with nothing above it that could be hiding
     * it, in a component that also renders a list.
     *
     * The list is what makes this checkable. A create form is allowed to open
     * in edit mode -- law 14 says so, and a new-role page is nothing but a
     * form -- so a rule that only asked "is this composer ungated" reported 27
     * sites of which a third were creates doing the right thing. Requiring the
     * component to also render existing items narrows it to the case AddTrigger
     * was written for: a section whose job is to show what you have written,
     * leading with an empty box for writing more. That is 19, of which about
     * four are still creates that happen to list something, and those say so on
     * the line.
     *
     * "Nothing above it that could be hiding it" walks the enclosing blocks by
     * indentation rather than reading a fixed window, which is the difference
     * between a rule worth having and one worth ignoring. The window version
     * read fourteen lines up and was wrong seven times out of nine: the settings
     * page hides five composers behind one `{!editing ? (` fifty lines above
     * them, and a rule that cannot see that reports the page every time it is
     * already right.
     *
     * Two signals, because a composer is hidden in two different shapes:
     *
     *   - An ancestor holds a condition -- `&&`, either half of a ternary, or a
     *     state name this codebase uses for open-ness. Found by walking out to
     *     each successively shallower line until the enclosing function.
     *   - The function returns early -- `if (!composing) return <AddTrigger …>`.
     *     That guard is a sibling of the JSX, not an ancestor of it, so the walk
     *     steps straight past. Scanned for separately.
     *
     * Still not a parse. It cannot see across a component boundary: a form
     * component rendered only when editing looks bare from inside, which is
     * what the plan view's two are. Excuse those where they stand.
     */
    find: (line, { before, source }) => {
      if (!/<(?:Textarea|ComposeBody)\b/.test(line)) return [];
      if (!/\{\s*[\w.[\]()]*\.map\(/.test(source)) return [];
      if (encloses(line, before, GATE) || before.some((l) => EARLY_RETURN.test(l))) return [];
      return ['composer open on arrival'];
    },
  },
  {
    id: 'action-without-tier',
    law: '-',
    says: 'an action with no latency tier',
    instead: '// latency: instant | optimistic | pending directly above it',
    /**
     * An exported action with no `// latency:` line above it.
     *
     * /dev/ui gives every write one of three tiers and the app predated the
     * table, so a tier that lives anywhere but beside the action drifts from it
     * -- which is why it is a comment on the function (#171) and why this is
     * what makes somebody write one. The gate can only see that a tier is
     * there; whether it is the right one is a reading, not a grep.
     *
     * The tag has to be in the comment block directly above, which is where
     * the eye looks and the only place that cannot end up describing a
     * different function. A blank line between the tag and the export breaks
     * the block, so the tag has to be the line above -- after any doc comment,
     * not before it.
     */
    only: /actions\.tsx?$/,
    find: (line, { before }) => {
      const declared = /^export async function (\w+)\(/.exec(line);
      if (!declared) return [];

      for (let above = before.length - 1; above >= 0; above -= 1) {
        const previous = before[above]!.trim();
        if (!isCommentLine(previous)) break;
        if (/^\/\/\s*latency:\s*(?:instant|optimistic|pending)\b/.test(previous)) return [];
      }

      return [`${declared[1]}() has no tier`];
    },
  },

  {
    id: 'window-dialog',
    law: '-',
    says: 'the browser’s own confirm, alert or prompt',
    instead: 'an inline two-step confirm that names what will be lost, or undo in the toast',
    find: (line) => [...line.matchAll(/\bwindow\.(?:confirm|alert|prompt)\(/g)].map((m) => m[0]),
  },
  {
    id: 'hover-only-action',
    law: '-',
    says: 'a control that only appears on hover, so a phone never shows it',
    instead: 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100, visible on touch and revealed for a pointer',
    /**
     * A bare `opacity-0` with a hover reveal in the same class list. The right
     * spelling starts visible and hides only from `sm:` up; the wrong one
     * starts hidden everywhere, and a phone has no hover to reveal it with.
     */
    find: (line) =>
      classStrings(line)
        .filter((value) => /(?<![\w:-])opacity-0\b/.test(value))
        .filter((value) => /group-(?:hover|focus-within):opacity-100/.test(value))
        .map((value) => value.slice(0, 64)),
  },
  {
    id: 'icon-stroke',
    law: '-',
    says: 'a Lucide icon at a stroke other than 1.75',
    instead: 'strokeWidth={1.75}: one library, one weight',
    /**
     * PascalCase tags only. A lower-case `<path>` or `<line>` in a chart or a
     * mark is drawn by hand and chooses its own weight; an icon does not.
     */
    find: (line, { after }) => {
      if (!/<[A-Z]\w*\b/.test(line)) return [];
      const tag = openingTag(line, after);
      const stroke = /strokeWidth=\{([\d.]+)\}/.exec(tag);
      return stroke && stroke[1] !== '1.75' ? [`strokeWidth={${stroke[1]}}`] : [];
    },
  },
  {
    id: 'focus-removed',
    law: '-',
    says: 'outline-none with no focus style to replace it',
    instead: 'a focus: or focus-visible: ring in the same class list, so the keyboard can still see where it is',
    /**
     * A bare field inside a frame that lights up with `focus-within:` is fine:
     * the frame is the focus style. So an enclosing focus-within excuses it.
     */
    find: (line, { before }) => {
      if (encloses(line, before, /focus-within:/)) return [];
      return classStrings(line)
        .filter((value) => /(?<![\w:-])outline-none\b/.test(value))
        .filter((value) => !/\bfocus(?:-visible|-within)?:/.test(value))
        .map((value) => value.slice(0, 64));
    },
  },
  {
    id: 'spinner',
    law: '-',
    says: 'a spinner',
    instead: 'a skeleton of the real shape, or a pending label on the control that is working',
    find: (line) => [...line.matchAll(/\banimate-spin\b|\bLoader2\b/g)].map((m) => m[0]),
  },
  {
    id: 'resting-shadow',
    law: '11',
    says: 'a drop shadow on something that does not float',
    instead: 'a hairline: depth is a border, and shadow is for popovers, menus and sheets',
    find: (line) =>
      classStrings(line)
        .filter((value) => /(?<![\w:-])shadow-(?:sm|md|lg|xl|2xl)\b/.test(value))
        .filter((value) => !/\b(?:absolute|fixed|z-overlay|z-popover|popover)/.test(value))
        .map((value) => value.slice(0, 64)),
  },
  {
    id: 'two-hue-gradient',
    law: '-',
    says: 'a gradient between two hues',
    instead: 'one colour; the home mark is the only two-hue gradient in the app',
    find: (line) =>
      classStrings(line)
        .filter((value) => /\bbg-(?:gradient|linear|radial)-/.test(value))
        .filter((value) => /\bfrom-/.test(value) && /\bto-/.test(value))
        .map((value) => value.slice(0, 64)),
  },
  {
    id: 'small-input',
    law: '-',
    says: 'a text input under 16px on a phone, which makes iOS zoom the page on focus',
    instead: 'Input, Select or Textarea from components/ui/field, or text-base sm:text-ui on the raw element',
    find: (line, { after }) => {
      if (!/<(?:input|select|textarea)\b/.test(line)) return [];
      const tag = openingTag(line, after);
      if (/type="(?:checkbox|radio|hidden|range|file|color|submit|button)"/.test(tag)) return [];
      if (!/\btext-(?:micro|small|ui|body)\b/.test(tag) || /\btext-base\b/.test(tag)) return [];
      return [tag.match(/<\w+/)![0]];
    },
  },
  {
    id: 'product-copy',
    law: '-',
    says: 'copy the voice rules rule out: "successfully", an exclamation mark, or a Submit/OK button',
    instead: 'say what happened, with no exclamation; name the button for what it does',
    /**
     * Read text only -- JSX text between tags, and strings -- so `!ok` and
     * `a !== b` in code are not copy. /dev/ui quotes the don'ts to show them,
     * so it is the one place allowed to write them.
     */
    skip: /^app\/dev\/ui\//,
    find: (line) => {
      const out: string[] = [];
      if (/\bsuccessfully\b/i.test(line)) out.push('"successfully"');
      for (const match of line.matchAll(READ_TEXT)) {
        const text = match[1]!.trim();
        if (/[A-Za-z]!(?:\s|$)/.test(text)) out.push(text.slice(0, 48));
        if (/^(?:Submit|OK|Okay)$/.test(text)) out.push(text);
      }
      for (const match of line.matchAll(/(['"`])([A-Z][^'"`]*[a-z]!)\1/g)) out.push(match[2]!.slice(0, 48));
      // The pictographic planes only: a star or a tick is a text character
      // this app sets on purpose, and neither is an emoji.
      if (/[\u{1F300}-\u{1FAFF}]/u.test(line)) out.push('emoji');
      return out;
    },
  },
  {
    id: 'streak',
    law: '-',
    says: 'a streak: a count that punishes a missed day',
    instead: 'progress that is earned, shown over time; see Progress on /dev/ui',
    /** /dev/ui is where the rule against streaks is written, so it says the word. */
    skip: /^app\/dev\/ui\//,
    find: (line) => [...line.matchAll(/\bstreaks?\b/gi)].map((m) => m[0]),
  },
  {
    id: 'route-without-loading',
    law: '-',
    says: 'a page with no loading.tsx between it and app/',
    instead: 'a loading.tsx rendering the page’s real shape, so the layout does not jump when data lands',
    only: /^app\/.+\/page\.tsx$/,
    find: (_line, { file, index }) =>
      index === 0 && !routeHas(file, 'loading.tsx') ? ['no loading.tsx'] : [],
  },
  {
    id: 'route-without-error',
    law: '2',
    says: 'a page with no error.tsx between it and app/',
    instead: 'an error.tsx that says what could not be read, so a failure is stated rather than a blank',
    only: /^app\/.+\/page\.tsx$/,
    find: (_line, { file, index }) =>
      index === 0 && !routeHas(file, 'error.tsx') ? ['no error.tsx'] : [],
  },
];

// -- The walk ---------------------------------------------------------------
type Hit = { file: string; line: number; rule: Rule; text: string };

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function scan(target: ModuleId | null): Hit[] {
  const hits: Hit[] = [];
  for (const root of ROOTS) {
    for (const path of files(join(ROOT, root))) {
      const file = relative(ROOT, path);
      if (EXEMPT.some((prefix) => file.startsWith(prefix))) continue;
      if (target && scopeForFile(file) !== target) continue;
      const source = readFileSync(path, 'utf8');
      const lines = source.split('\n');
      const excused = new Set(
        [...source.matchAll(/ui-ok-file:\s*([\w-]+)/g)].map((match) => match[1]!),
      );
      lines.forEach((line, index) => {
        // Prose, not code. A doc comment explaining why not to write
        // `var(--color-accent)` should not be reported for writing it, and the
        // file that documents these rules is the file most likely to quote
        // them. Continuation lines of a block comment and whole-line `//`
        // comments are the two shapes that carry prose; a real declaration
        // never starts a line with `*`.
        const trimmed = line.trimStart();
        if (isCommentLine(trimmed)) return;

        // The valve: on this line, or anywhere in the comment block directly
        // above it.
        //
        // It used to read exactly one line up, which quietly made the valve
        // unusable for the reasons this codebase actually writes. Every
        // justification here is a paragraph -- that is the house style and the
        // point of it -- so a four-line explanation put `ui-ok:` on its first
        // line and the marker fell out of range. The only way to be excused
        // was to give a one-line reason, which is the opposite of what the
        // valve is for.
        if (line.includes('ui-ok:')) return;
        let above = index - 1;
        while (above >= 0) {
          const previous = lines[above]!.trim();
          if (!isCommentLine(previous)) break;
          if (previous.includes('ui-ok:')) return;
          above -= 1;
        }
        for (const rule of RULES) {
          if (excused.has(rule.id)) continue;
          if (rule.skip?.test(file)) continue;
          if (rule.only && !rule.only.test(file)) continue;
          const context: RuleContext = {
            file,
            index,
            after: lines.slice(index + 1, index + 7),
            before: lines.slice(0, index),
            source,
          };
          for (const text of rule.find(line, context)) {
            hits.push({ file, line: index + 1, rule, text });
          }
        }
      });
    }
  }
  return hits;
}

/** `rule file` -> count. Flat, so a diff of the baseline reads as a list. */
function tally(hits: Hit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const hit of hits) {
    const key = `${hit.rule.id} ${hit.file}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * The workspace this run is about, from `--module <id>`.
 *
 * A run narrowed to one module scans that module's files, compares them
 * against their own baseline entries and fails on a new violation there, so
 * "is the vault in line" is a question with an answer rather than a share of
 * one number for the whole app.
 */
function targetModule(): ModuleId | null {
  const at = process.argv.indexOf('--module');
  if (at === -1) return null;
  const id = process.argv[at + 1];
  if (!id || !isModuleId(id)) {
    console.error(`--module takes one of: ${MODULE_IDS.join(', ')}`);
    process.exit(1);
  }
  return id;
}

// -- The report -------------------------------------------------------------
const target = targetModule();
const hits = scan(target);
const counts = tally(hits);

if (process.argv.includes('--update')) {
  // A narrowed run has only looked at one module, so recording it would drop
  // every other module's entry and quietly reset the ratchet.
  if (target) {
    console.error('--update records the whole baseline, so it cannot be narrowed to --module.');
    process.exit(1);
  }
  const ordered = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`Recorded ${hits.length} violations across ${Object.keys(ordered).length} file/rule pairs.`);
  process.exit(0);
}

let baseline: Record<string, number> = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
} catch {
  console.error('No baseline yet. Record one with: npm run check:ui -- --update');
  process.exit(1);
}

if (process.argv.includes('--list')) {
  for (const hit of hits) console.log(`${hit.file}:${hit.line}  ${hit.rule.id}  ${hit.text}`);
  console.log('');
}

const regressions = hits.filter((hit) => {
  const key = `${hit.rule.id} ${hit.file}`;
  return (counts[key] ?? 0) > (baseline[key] ?? 0);
});

if (regressions.length > 0) {
  console.error(`\n✗ ${regressions.length} new UI violation(s).\n`);
  const explained = new Set<string>();
  for (const hit of regressions) {
    console.error(`  ${hit.file}:${hit.line}`);
    console.error(`    ${hit.text}`);
    if (!explained.has(hit.rule.id)) {
      explained.add(hit.rule.id);
      // The id as well as the law, because the id is what a file-wide
      // exemption has to name and there is nowhere else to read it off.
      console.error(`    law ${hit.rule.law} · ${hit.rule.id}: ${hit.rule.says}`);
      console.error(`    use ${hit.rule.instead}`);
    }
    console.error('');
  }
  console.error('If it is genuinely right, say so on the line: /* ui-ok: why */');
  console.error('The laws are at /dev/ui, and in app/dev/ui/laws.ts.\n');
  process.exit(1);
}

/** `  ·  name`, or the count if there is one. */
function standing(n: number, name: string): string {
  return `  ${n === 0 ? '  ·' : String(n).padStart(3)}  ${name}`;
}

// Per-rule standings, so the number that is meant to fall is visible.
const byRule = new Map<string, number>();
for (const hit of hits) byRule.set(hit.rule.id, (byRule.get(hit.rule.id) ?? 0) + 1);
for (const rule of RULES) console.log(standing(byRule.get(rule.id) ?? 0, rule.id));

// Per-module standings, which is what says where the work is. Every scope is
// listed, including the ones at zero: a module missing from the list reads as
// a module nobody has counted.
const byScope = new Map<string, number>();
for (const hit of hits) {
  const scope = scopeForFile(hit.file);
  byScope.set(scope, (byScope.get(scope) ?? 0) + 1);
}
console.log('');
for (const scope of target ? [target] : UI_SCOPES) {
  console.log(standing(byScope.get(scope) ?? 0, scope));
}

// What the baseline says about the files this run actually looked at.
const known = Object.entries(baseline)
  .filter(([key]) => !target || scopeForFile(key.slice(key.indexOf(' ') + 1)) === target)
  .reduce((sum, [, n]) => sum + n, 0);
const fixed = known - hits.length;
if (fixed > 0) {
  console.log(`\n✓ No new violations, and ${fixed} fewer than the baseline.`);
  console.log('  Lock the gain in: npm run check:ui -- --update\n');
} else {
  console.log(`\n✓ No new UI violations. ${hits.length} known, none added.\n`);
}
