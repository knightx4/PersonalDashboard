import type { AreaGrid } from './grid';

/**
 * Opening a place on the areas grid and moving a theme out of it (plan #797,
 * LEARN-AREAS-SPEC "Placement").
 *
 * Pure: which place the URL names, the themes in it in the order they are
 * listed, where each could go instead, and the three columns a move writes.
 * `themes-load.ts` reads the rows and `app/learn/know/move-actions.ts` writes
 * them.
 */

/**
 * Where a theme sits: one field, one whole domain, or neither. Never both,
 * which the table's `theme_fields_target_ck` also refuses.
 */
export type PlaceTarget = { fieldId: string | null; domainId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value a destination carries in the move form. */
export function targetValue(target: PlaceTarget): string {
  if (target.fieldId) return `field:${target.fieldId}`;
  if (target.domainId) return `domain:${target.domainId}`;
  return 'none';
}

/** The inverse of `targetValue`. Null for anything it would not have written. */
export function parseTarget(value: string): PlaceTarget | null {
  if (value === 'none') return { fieldId: null, domainId: null };
  const [kind, id, ...rest] = value.split(':');
  if (rest.length > 0 || !id || !UUID.test(id)) return null;
  if (kind === 'field') return { fieldId: id, domainId: null };
  if (kind === 'domain') return { fieldId: null, domainId: id };
  return null;
}

/**
 * The columns a move writes. The basis and the runner-up are left as the
 * placement pass wrote them: the page shows the basis as what the pass
 * thought once `moved_by_hand` is set, and leaving both alone is what lets
 * an undo put the row back exactly.
 */
export function placementUpdate(
  target: PlaceTarget,
  movedByHand: boolean,
): { field_id: string | null; domain_id: string | null; moved_by_hand: boolean } {
  return { field_id: target.fieldId, domain_id: target.domainId, moved_by_hand: movedByHand };
}

export type Destination = { value: string; label: string };
export type DestinationGroup = { label: string; options: Destination[] };

/**
 * Every place a theme can be moved to, grouped by domain in the grid's order:
 * the domain as a whole first, then its fields. "Not on the grid" is not in a
 * group; the form offers it on its own.
 */
export function destinationsFor(grid: AreaGrid): DestinationGroup[] {
  return grid.domains.map((domain) => ({
    label: domain.name,
    options: [
      {
        value: targetValue({ fieldId: null, domainId: domain.id }),
        label: `All of ${domain.name}`,
      },
      ...domain.fields.map((field) => ({
        value: targetValue({ fieldId: field.id, domainId: null }),
        label: field.name,
      })),
    ],
  }));
}

/** A field's name by id, for the runner-up line. */
export function fieldName(id: string, grid: AreaGrid): string | null {
  for (const domain of grid.domains) {
    const field = domain.fields.find((cell) => cell.id === id);
    if (field) return field.name;
  }
  return null;
}

export type OpenedPlace =
  | { kind: 'field'; target: PlaceTarget; slug: string; name: string; domainName: string }
  | { kind: 'domain'; target: PlaceTarget; slug: string; name: string }
  | { kind: 'unplaced'; target: PlaceTarget };

/**
 * The place the URL opens, if any. `?field=<slug>` opens a field,
 * `?domain=<slug>` the themes placed at a domain as a whole, and
 * `?unplaced=1` the themes on no part of the grid. A slug the grid does not
 * have opens nothing, the same as no parameter.
 */
export function openedPlace(
  params: { field?: string; domain?: string; unplaced?: string },
  grid: AreaGrid,
): OpenedPlace | null {
  if (params.field) {
    for (const domain of grid.domains) {
      const field = domain.fields.find((cell) => cell.slug === params.field);
      if (field) {
        return {
          kind: 'field',
          target: { fieldId: field.id, domainId: null },
          slug: field.slug,
          name: field.name,
          domainName: domain.name,
        };
      }
    }
    return null;
  }
  if (params.domain) {
    const domain = grid.domains.find((row) => row.slug === params.domain);
    return domain
      ? {
          kind: 'domain',
          target: { fieldId: null, domainId: domain.id },
          slug: domain.slug,
          name: domain.name,
        }
      : null;
  }
  if (params.unplaced) return { kind: 'unplaced', target: { fieldId: null, domainId: null } };
  return null;
}

/** One theme in an opened place, with the placement that put it there. */
export type PlacedTheme = {
  /** The `theme_fields` row, which is what a move updates. */
  placementId: string;
  name: string;
  strength: number;
  basis: string;
  runnerUpId: string | null;
  movedByHand: boolean;
  target: PlaceTarget;
};

/** Strongest first, the same order the cell names its two strongest in. */
export function sortPlacedThemes(themes: PlacedTheme[]): PlacedTheme[] {
  return [...themes].sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
}

/**
 * The runner-up worth naming beside a theme. None when the pass named none,
 * and none when the theme has since been moved into that very field.
 */
export function runnerUpOf(theme: PlacedTheme, grid: AreaGrid): string | null {
  if (!theme.runnerUpId || theme.runnerUpId === theme.target.fieldId) return null;
  return fieldName(theme.runnerUpId, grid);
}
