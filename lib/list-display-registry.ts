import { hideableProperties, NO_GROUP, type ListDisplaySpec } from '@/lib/list-display';
import { inventoryDisplay, type SortableInventoryItem } from '@/lib/inventory/list-display';
import { ordersDisplay, type SortableOrder } from '@/lib/orders/list-display';
import { companiesDisplay, rolesDisplay, type CompanyLike } from '@/lib/jobs/roles-display';

/**
 * Every list in the app with display options, and what each one offers.
 *
 * The design page states a rule about lists -- sort, filter, group and search
 * are four different questions, all from the URL -- and until now nothing in
 * the app read it. This is the list of pages that obey it, read off the same
 * declarations the pages themselves pass to the shared module, so the page
 * cannot say one thing and the design page another.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one row per list, each spec over its own row type
type AnySpec = ListDisplaySpec<any>;

export type ListWithDisplay = {
  /** What the page is called on the design page. */
  label: string;
  spec: AnySpec;
};

export const LISTS_WITH_DISPLAY: readonly ListWithDisplay[] = [
  { label: 'Inventory', spec: inventoryDisplay<SortableInventoryItem>() },
  { label: 'Orders', spec: ordersDisplay<SortableOrder>() },
  { label: 'Roles', spec: rolesDisplay() },
  { label: 'Companies', spec: companiesDisplay<CompanyLike>() },
];

/** One row on the design page: the list, then what it offers. */
export function displaySummary(entry: ListWithDisplay): string[] {
  const sorts = entry.spec.sorts.map((sort) => sort.label).join(', ');
  const groups = (entry.spec.groups ?? []).map((group) => group.label).join(', ');
  const hideable = hideableProperties(entry.spec)
    .map((property) => property.label)
    .join(', ');

  return [
    entry.label,
    `${entry.spec.pathname} — sorts by ${sorts || 'nothing'}.`,
    groups ? `Groups by ${groups}.` : 'No grouping.',
    hideable ? `Can hide ${hideable}.` : 'Every property always drawn.',
  ];
}

/**
 * Ways a declared option cannot be reached from the URL.
 *
 * An option a list offers and the page cannot read back is a row in the
 * Display panel that does nothing when you click it -- which is worse than not
 * offering it, because it looks like the arrangement changed.
 */
export function unreachableOptions(spec: AnySpec): string[] {
  const problems: string[] = [];

  const seenSort = new Set<string>();
  for (const sort of spec.sorts) {
    if (!sort.id) problems.push('a sort with no id');
    else if (seenSort.has(sort.id)) problems.push(`two sorts share the id "${sort.id}"`);
    seenSort.add(sort.id);
  }

  const seenGroup = new Set<string>();
  for (const group of spec.groups ?? []) {
    if (group.id === NO_GROUP) {
      problems.push(`the grouping "${group.label}" uses the id that means no grouping`);
    } else if (seenGroup.has(group.id)) {
      problems.push(`two groupings share the id "${group.id}"`);
    }
    seenGroup.add(group.id);
  }

  const seenProperty = new Set<string>();
  for (const property of spec.properties ?? []) {
    if (seenProperty.has(property.id)) {
      problems.push(`two properties share the id "${property.id}"`);
    }
    seenProperty.add(property.id);
  }

  if (spec.defaultSort && !seenSort.has(spec.defaultSort)) {
    problems.push(`the default sort "${spec.defaultSort}" is not one of the sorts`);
  }
  if (spec.defaultGroup && spec.defaultGroup !== NO_GROUP && !seenGroup.has(spec.defaultGroup)) {
    problems.push(`the default grouping "${spec.defaultGroup}" is not one of the groupings`);
  }

  return problems;
}
