import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The UI page hands the standard each step's outline, read from the
 * plan_item_outlines view, so a moment names the step that builds it the way
 * the plan page heads the row. A view that cannot be read leaves the map
 * empty and the moments fall back to the number.
 */

let outlineRead: { data: unknown; error: unknown } = { data: [], error: null };
const reads: [string, string, unknown][] = [];

vi.mock('@/lib/auth/server', () => ({
  requireUser: async () => ({ id: 'u' }),
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          reads.push([table, column, value]);
          return Promise.resolve(outlineRead);
        },
      }),
    }),
  }),
}));
vi.mock('@/lib/plan/correction-share-load', () => ({ loadCorrectionWeeks: async () => null }));
vi.mock('@/lib/dev/taste-removals-load', () => ({ loadRemovedTaste: async () => [] }));
vi.mock('@/app/dev/ui/standard', () => ({
  UiStandard: () => null,
}));

const { default: DevUiPage } = await import('@/app/dev/ui/page');

beforeEach(() => {
  reads.length = 0;
});

describe('the UI page', () => {
  it("passes the standard each step's outline by number", async () => {
    outlineRead = { data: [{ number: 1084, outline: '1073.4' }], error: null };
    const page = await DevUiPage();

    expect(reads).toEqual([['plan_item_outlines', 'user_id', 'u']]);
    expect([...(page.props.outlines as Map<number, string>)]).toEqual([[1084, '1073.4']]);
  });

  it('passes an empty map when the view cannot be read', async () => {
    outlineRead = { data: null, error: { message: 'no view' } };
    const page = await DevUiPage();

    expect((page.props.outlines as Map<number, string>).size).toBe(0);
  });
});
