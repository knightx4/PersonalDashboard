import { describe, expect, it } from 'vitest';
import {
  displaySummary,
  LISTS_WITH_DISPLAY,
  unreachableOptions,
} from '@/lib/list-display-registry';
import {
  displayHref,
  listDisplayMenu,
  NO_GROUP,
  parseListDisplay,
  type ListDisplaySpec,
} from '@/lib/list-display';

/**
 * Every option a list offers has to survive the trip through the URL.
 *
 * The design page names the lists with display options and what each one
 * offers, read off the same declarations the pages pass to the shared module.
 * A declared option the URL cannot carry is a row in the Display panel that
 * does nothing when you press it, which is worse than not offering it -- it
 * looks like the arrangement changed.
 *
 * Same idea as tests/dev-ui-measurements.test.ts holding that page's numbers
 * to the stylesheet: the rule on the page is checked against the thing it
 * describes rather than kept in step by hand.
 */

describe('what the design page says about the lists', () => {
  it('names four lists, none of them typed in twice', () => {
    const paths = LISTS_WITH_DISPLAY.map((entry) => entry.spec.pathname);
    expect(paths).toEqual([
      '/shopping/inventory',
      '/shopping/orders',
      '/jobs/roles',
      '/jobs/companies',
    ]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('says for each one what it sorts by, groups by and can hide', () => {
    for (const entry of LISTS_WITH_DISPLAY) {
      const [label, sorts, groups, hidden] = displaySummary(entry);
      expect(label).toBe(entry.label);
      expect(sorts).toContain(entry.spec.pathname);
      expect(sorts).not.toContain('sorts by nothing');
      expect(groups).not.toBe('No grouping.');
      expect(hidden).not.toBe('Every property always drawn.');
    }
  });
});

describe('every option a list offers can be reached from its URL', () => {
  it.each(LISTS_WITH_DISPLAY.map((entry) => [entry.label, entry] as const))(
    '%s declares nothing the URL cannot carry',
    (_label, entry) => {
      expect(unreachableOptions(entry.spec)).toEqual([]);
    },
  );

  it.each(LISTS_WITH_DISPLAY.map((entry) => [entry.label, entry] as const))(
    '%s reads every one of its options back out of the link that sets it',
    (_label, entry) => {
      const menu = listDisplayMenu(entry.spec, {});

      for (const sort of menu.sorts) {
        const asked = paramsOf(sort.href, entry.spec.pathname);
        expect(parseListDisplay(entry.spec, asked).sort).toBe(sort.id);
      }

      for (const group of menu.groups) {
        const asked = paramsOf(group.href, entry.spec.pathname);
        expect(parseListDisplay(entry.spec, asked).group).toBe(group.id);
      }

      for (const property of menu.properties) {
        const asked = paramsOf(property.href, entry.spec.pathname);
        expect(parseListDisplay(entry.spec, asked).hidden).toContain(property.id);
      }
    },
  );

  it('keeps a filter the page already carries when an option changes', () => {
    for (const entry of LISTS_WITH_DISPLAY) {
      const href = displayHref(entry.spec, { q: 'kettle' }, { sort: entry.spec.sorts[1]?.id });
      expect(href).toContain('q=kettle');
    }
  });
});

describe('the check catches a list that lies about itself', () => {
  // A probe, rather than trusting that a passing suite means the check works.
  const probe = (over: Partial<ListDisplaySpec<unknown>>): ListDisplaySpec<unknown> => ({
    pathname: '/probe',
    sorts: [{ id: 'newest', label: 'Newest', compare: () => 0 }],
    ...over,
  });

  it('catches a grouping whose id means no grouping', () => {
    const problems = unreachableOptions(
      probe({ groups: [{ id: NO_GROUP, label: 'By month', bucket: () => null }] }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no grouping');
  });

  it('catches a second sort hiding behind the id of the first', () => {
    const problems = unreachableOptions(
      probe({
        sorts: [
          { id: 'newest', label: 'Newest', compare: () => 0 },
          { id: 'newest', label: 'Oldest', compare: () => 0 },
        ],
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('two sorts share');
  });

  it('catches a default that is not one of the options', () => {
    const problems = unreachableOptions(probe({ defaultSort: 'cheapest' }));
    expect(problems).toEqual(['the default sort "cheapest" is not one of the sorts']);
  });

  it('catches two properties under one id', () => {
    const problems = unreachableOptions(
      probe({
        properties: [
          { id: 'price', label: 'Price' },
          { id: 'price', label: 'Cost' },
        ],
      }),
    );
    expect(problems).toHaveLength(1);
  });
});

/** The query of a link the control built, in the shape a page receives it. */
function paramsOf(href: string, pathname: string): Record<string, string> {
  const query = href.startsWith(`${pathname}?`) ? href.slice(pathname.length + 1) : '';
  return Object.fromEntries(new URLSearchParams(query).entries());
}
