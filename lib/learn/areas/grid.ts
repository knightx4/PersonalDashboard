import { countStates, settledCount, type Graph } from '@/lib/learn/graph/model';
import type { StatusGlyph } from '@/lib/status-glyphs';

/**
 * The areas grid on the Know page (LEARN-AREAS-SPEC, "The dashboard").
 *
 * Pure: the rows go in, the grid comes out, and `grid-load.ts` does the
 * reading. One row per domain in the table's order, one cell per field, and
 * two signals in every cell that are never added together. Interest is what
 * the vault's themes say you write about; tested is what the tracks placed
 * in the field say you have shown. KNOWLEDGE-SPEC removed the idea that
 * writing about something counts as knowing it, and one combined number
 * would bring it back, so nothing below produces one.
 */

export type GridDomain = { id: string; slug: string; name: string; position: number };
export type GridField = {
  id: string;
  domainId: string;
  name: string;
  slug: string;
  position: number;
};

/**
 * A vault theme with its placement. Exactly one of `fieldId` and `domainId`
 * is set on a placed theme; a theme with neither is unplaced and appears
 * nowhere on the grid.
 */
export type GridTheme = {
  name: string;
  strength: number;
  lastSeen: string | null;
  fieldId: string | null;
  domainId: string | null;
};

/** What one track has shown, read off its graph by `trackTested`. */
export type TrackTested = {
  known: number;
  total: number;
  /** Ideas with an answered question behind them, whatever state they are in. */
  answered: number;
  lastAnswered: string | null;
};

export type GridTrack = TrackTested & {
  name: string;
  fieldId: string | null;
  domainId: string | null;
};

export type Interest = {
  themes: number;
  /** Summed strength. An ordering, never printed (see the vault's map). */
  strength: number;
  lastWritten: string | null;
  /** The two strongest theme names, strongest first. */
  strongest: string[];
};

export type Tested = {
  tracks: string[];
  known: number;
  total: number;
  answered: number;
  lastAnswered: string | null;
};

/**
 * The four kinds the spec sorts a field into.
 *
 * `strong` and `getting-there` both need at least one answered question: a
 * track placed in a field with nothing answered has shown nothing yet, and
 * calling its field "getting there" would claim a test that never happened.
 * `strong` is read off the tested side alone; the shade beside it already
 * says whether you also write about it, and folding that in would make the
 * kind a combined score by another route.
 */
export type AreaKind = 'strong' | 'getting-there' | 'untested' | 'neither';

export type FieldCell = {
  id: string;
  slug: string;
  name: string;
  interest: Interest;
  tested: Tested;
  /** 0 to 3, how dark the cell is drawn. */
  shade: InterestShade;
  kind: AreaKind;
};

export type DomainRow = {
  id: string;
  slug: string;
  name: string;
  fields: FieldCell[];
  /** Themes and tracks placed at the domain itself, in none of its cells. */
  own: { interest: Interest; tested: Tested };
  /** The fields summed, plus what was placed at the domain. */
  total: { interest: Interest; tested: Tested };
};

export type AreaGrid = {
  domains: DomainRow[];
  /** Placed nowhere: themes about no field of study, tracks that span domains. */
  unplacedThemes: number;
  unplacedTracks: number;
};

export type InterestShade = 0 | 1 | 2 | 3;

/**
 * Where the shade steps up, as a share of the strongest field's interest.
 *
 * Relative rather than absolute because strength is a ranking with no unit:
 * the vault's strongest field is the darkest cell whatever its number is.
 * A tenth is where "you write about this" starts. At the vault's size in
 * September 2026 that is a dozen fields; below it are fields holding one to
 * nine themes, which is a stray note rather than a subject you keep coming
 * back to, and those are drawn faded with their count still shown.
 */
const WRITTEN_ABOUT_SHARE = 0.1;
const STRONG_INTEREST_SHARE = 0.4;

/**
 * Most ideas known, out of those in the tracks placed there. Half, because
 * below that the field is more gap than knowledge and `/learn/next` is
 * already working through it.
 */
const STRONG_KNOWN_SHARE = 0.5;

const blankInterest = (): Interest => ({
  themes: 0,
  strength: 0,
  lastWritten: null,
  strongest: [],
});

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** What a track has shown, from the same counts the tracks list says. */
export function trackTested(graph: Graph): TrackTested {
  let answered = 0;
  let lastAnswered: string | null = null;
  for (const concept of graph.concepts) {
    if (!concept.testedAt) continue;
    answered += 1;
    lastAnswered = later(lastAnswered, concept.testedAt);
  }
  const counts = countStates(graph);
  return { known: settledCount(counts), total: counts.total, answered, lastAnswered };
}

function interestOf(themes: GridTheme[]): Interest {
  const sorted = [...themes].sort(
    (a, b) => b.strength - a.strength || a.name.localeCompare(b.name),
  );
  return {
    themes: themes.length,
    strength: themes.reduce((sum, theme) => sum + theme.strength, 0),
    lastWritten: themes.reduce<string | null>((at, theme) => later(at, theme.lastSeen), null),
    strongest: sorted.slice(0, 2).map((theme) => theme.name),
  };
}

function testedOf(tracks: GridTrack[]): Tested {
  return {
    tracks: tracks.map((track) => track.name).sort((a, b) => a.localeCompare(b)),
    known: tracks.reduce((sum, track) => sum + track.known, 0),
    total: tracks.reduce((sum, track) => sum + track.total, 0),
    answered: tracks.reduce((sum, track) => sum + track.answered, 0),
    lastAnswered: tracks.reduce<string | null>((at, track) => later(at, track.lastAnswered), null),
  };
}

function sumInterest(parts: Interest[]): Interest {
  return {
    themes: parts.reduce((sum, part) => sum + part.themes, 0),
    strength: parts.reduce((sum, part) => sum + part.strength, 0),
    lastWritten: parts.reduce<string | null>((at, part) => later(at, part.lastWritten), null),
    // The strongest names of a sum are not the first names of its parts, and
    // the domain row does not show them, so a total carries none.
    strongest: [],
  };
}

function sumTested(parts: Tested[]): Tested {
  return {
    tracks: parts.flatMap((part) => part.tracks),
    known: parts.reduce((sum, part) => sum + part.known, 0),
    total: parts.reduce((sum, part) => sum + part.total, 0),
    answered: parts.reduce((sum, part) => sum + part.answered, 0),
    lastAnswered: parts.reduce<string | null>((at, part) => later(at, part.lastAnswered), null),
  };
}

export function shadeFor(strength: number, strongest: number): InterestShade {
  if (strength <= 0 || strongest <= 0) return 0;
  const share = strength / strongest;
  if (share >= STRONG_INTEREST_SHARE) return 3;
  if (share >= WRITTEN_ABOUT_SHARE) return 2;
  return 1;
}

export function kindOf(shade: InterestShade, tested: Tested): AreaKind {
  if (tested.answered > 0) {
    return tested.known >= tested.total * STRONG_KNOWN_SHARE ? 'strong' : 'getting-there';
  }
  // A track placed here with nothing answered yet is still something on the
  // way to being tested, so its field is not drawn as though it were empty.
  if (shade >= 2 || tested.tracks.length > 0) return 'untested';
  return 'neither';
}

export function buildAreaGrid(input: {
  domains: GridDomain[];
  fields: GridField[];
  themes: GridTheme[];
  tracks: GridTrack[];
  /** Tracks not placed yet, or placed across domains. Counted, not drawn. */
  unplacedTracks?: number;
}): AreaGrid {
  const themesAt = new Map<string, GridTheme[]>();
  const tracksAt = new Map<string, GridTrack[]>();
  let unplacedThemes = 0;
  let unplacedTracks = input.unplacedTracks ?? 0;

  // A placement names a field or a domain, never both, so keying both kinds
  // of id into one map cannot count anything twice. A field id takes
  // precedence if a bad row ever carried both.
  for (const theme of input.themes) {
    const at = theme.fieldId ?? theme.domainId;
    if (!at) {
      unplacedThemes += 1;
      continue;
    }
    themesAt.set(at, [...(themesAt.get(at) ?? []), theme]);
  }
  for (const track of input.tracks) {
    const at = track.fieldId ?? track.domainId;
    if (!at) {
      unplacedTracks += 1;
      continue;
    }
    tracksAt.set(at, [...(tracksAt.get(at) ?? []), track]);
  }

  const fieldInterest = new Map(
    input.fields.map((field) => [field.id, interestOf(themesAt.get(field.id) ?? [])]),
  );
  const strongest = Math.max(
    0,
    ...[...fieldInterest.values()].map((interest) => interest.strength),
  );

  const domains = [...input.domains]
    .sort((a, b) => a.position - b.position)
    .map((domain): DomainRow => {
      const fields = input.fields
        .filter((field) => field.domainId === domain.id)
        .sort((a, b) => a.position - b.position)
        .map((field): FieldCell => {
          const interest = fieldInterest.get(field.id) ?? blankInterest();
          const tested = testedOf(tracksAt.get(field.id) ?? []);
          const shade = shadeFor(interest.strength, strongest);
          return {
            id: field.id,
            slug: field.slug,
            name: field.name,
            interest,
            tested,
            shade,
            kind: kindOf(shade, tested),
          };
        });

      const own = {
        interest: interestOf(themesAt.get(domain.id) ?? []),
        tested: testedOf(tracksAt.get(domain.id) ?? []),
      };
      return {
        id: domain.id,
        slug: domain.slug,
        name: domain.name,
        fields,
        own,
        total: {
          interest: sumInterest([own.interest, ...fields.map((field) => field.interest)]),
          tested: sumTested([own.tested, ...fields.map((field) => field.tested)]),
        },
      };
    });

  return { domains, unplacedThemes, unplacedTracks };
}

/** The shape beside each kind, so the kind reads with the colour taken away (law 4). */
export const AREA_KIND_GLYPHS: Record<Exclude<AreaKind, 'neither'>, StatusGlyph> = {
  strong: 'full',
  'getting-there': 'half',
  untested: 'dashed',
};

/**
 * What each kind is called on screen. `untested` has two names because a
 * field can be untested for two reasons: you write about it and have never
 * been asked, which is the cell the spec calls the most useful on the page,
 * or a track has been placed there and nothing in it has been answered yet.
 */
export function kindLabel(cell: Pick<FieldCell, 'kind' | 'shade'>): string | null {
  switch (cell.kind) {
    case 'strong':
      return 'Strong';
    case 'getting-there':
      return 'Getting there';
    case 'untested':
      return cell.shade >= 2 ? 'Written about, not tested' : 'Not tested yet';
    default:
      return null;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The interest half as a line: its size and its date. `day` turns a
 * timestamp into words in the account's timezone; it is passed in so this
 * stays pure and the page's "today" is the page's.
 */
export function interestLine(
  interest: Interest,
  day: (at: string | null) => string | null,
): string {
  if (interest.themes === 0) return 'No themes';
  const when = day(interest.lastWritten);
  const size = plural(interest.themes, 'theme', 'themes');
  return when ? `${size}, last written ${when}` : size;
}

/**
 * The tested half as a line. Always "known out of total", never a share: a
 * percentage of nineteen ideas claims a precision the answers do not have.
 */
export function testedLine(tested: Tested, day: (at: string | null) => string | null): string {
  if (tested.tracks.length === 0) return 'No track here';
  if (tested.total === 0) return 'No ideas yet';
  const size = `${tested.known} of ${plural(tested.total, 'idea', 'ideas')} known`;
  if (tested.answered === 0) return `${size}, nothing answered yet`;
  const when = day(tested.lastAnswered);
  return when ? `${size}, last answered ${when}` : size;
}
