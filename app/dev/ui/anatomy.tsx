import { Search } from 'lucide-react';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { formatMoney } from '@/lib/money';

/**
 * How a whole page is arranged, drawn from the components that draw the real
 * ones.
 *
 * The rest of /dev/ui is about one surface at a time -- a row, a chip, a
 * figure -- and says nothing about where the title goes, what sits beside the
 * list, or what a page looks like once the rail has collapsed. That is the gap
 * these fill: one arrangement per shape of page the app has, rendered rather
 * than described.
 *
 * They are surfaces in /preview (app/preview/surfaces.tsx registers every
 * entry below) so /dev/ui can frame them in an iframe at 390 and at 1280. That
 * is the whole reason they live in their own file: an arrangement rendered
 * inline on /dev/ui would sit inside that page's 768px column and would
 * respond to the reader's window, so the phone drawing would never be a phone.
 * In a frame with its own viewport, `sm:` and `xl:` fire exactly as they do in
 * the app.
 *
 * The fixtures are shapes, not data. A page anatomy is about where things sit,
 * so the rows say only enough to have a length and a rhythm.
 */
export type Anatomy = {
  /** Its id in /preview, and the fragment on /dev/ui. */
  id: string;
  label: string;
  /** The parts, in the order they are read. One sentence per part at most. */
  note: string;
  render: () => React.ReactNode;
};

const LIST_ROWS: readonly { name: string; where: string; cents: number }[] = [
  { name: 'Sony WH-1000XM5', where: 'Amazon · Electronics', cents: 34_800 },
  { name: 'Oxford shirt, white', where: 'Uniqlo · Clothing', cents: 4_990 },
  { name: 'Brass floor lamp', where: 'Etsy · Home', cents: 12_400 },
  { name: 'Wirecutter kettle', where: 'John Lewis · Kitchen', cents: 6_500 },
  { name: 'Ridgeline backpack', where: 'Osprey · Outdoors', cents: 17_000 },
  { name: 'Wilderness board game', where: 'Zatu · Games', cents: 4_200 },
  { name: 'Espresso tamper', where: 'Amazon · Kitchen', cents: 2_800 },
  { name: 'Running shoes', where: 'Asics · Clothing', cents: 11_000 },
  { name: 'Cast iron pan, 26cm', where: 'Lodge · Kitchen', cents: 5_400 },
  { name: 'Desk lamp, articulated', where: 'Anglepoise · Home', cents: 22_500 },
  { name: 'Merino socks, five pairs', where: 'Uniqlo · Clothing', cents: 3_600 },
  { name: 'USB-C dock', where: 'Anker · Electronics', cents: 9_900 },
];

/**
 * A list page: rail, header, one surface of rows.
 *
 * Copied in shape from app/shopping/inventory/page.tsx, which is the longest
 * of them. The rail is a column from xl up and a button below it, which is
 * `LeftRail`'s own doing and the reason the two frames on /dev/ui differ more
 * here than anywhere else.
 */
function ListAnatomy() {
  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <LeftRail>
        <RailGroup label="Acquired">
          <RailItem label="Last 30 days" href="#" />
          <RailItem label="This year" href="#" active />
          <RailItem label="All time" href="#" />
        </RailGroup>
        <RailGroup label="Category">
          <RailItem label="Everything" href="#" active />
          <RailItem label="Electronics" href="#" count={12} />
          <RailItem label="Kitchen" href="#" count={9} />
          <RailItem label="Clothing" href="#" count={31} />
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Inventory"
          description="Everything you own, one line each."
          actions={<Button size="sm">Add item</Button>}
        />

        <form className="mb-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <Input
              aria-label="Search the anatomy list"
              placeholder="Search what you own…"
              className="pl-9"
            />
          </div>
        </form>

        <Card padding="none">
          <ul className="divide-y divide-border">
            {LIST_ROWS.map((row) => (
              <li key={row.name} className="card-pad-x row-pad flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-ui text-ink">
                  {row.name}
                  <span className="ml-2 text-ink-muted">{row.where}</span>
                </span>
                <span className="tabular shrink-0 text-small text-ink-muted">
                  {formatMoney(row.cents, 'USD', { showCents: false })}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <p className="mt-3 text-small text-ink-muted">
          {LIST_ROWS.length} items ·{' '}
          {formatMoney(
            LIST_ROWS.reduce((sum, row) => sum + row.cents, 0),
            'USD',
            { showCents: false },
          )}
        </p>
      </div>
    </div>
  );
}

export const ANATOMIES: readonly Anatomy[] = [
  {
    id: 'anatomy-list',
    label: 'A list page',
    note: 'From xl up the filters are a column down the left. Narrower than that they are a button above everything, and the page is one column. The rest is the same at both widths: the page header with the one action it owns, the search the list is read through, one surface of rows with hairlines between them, then the count.',
    render: () => <ListAnatomy />,
  },
];
