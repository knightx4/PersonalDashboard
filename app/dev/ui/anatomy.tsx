import { CalendarDays, Circle, Search } from 'lucide-react';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { DetailLayout, Property, PropertyList } from '@/components/shell/detail-layout';
import { Group } from '@/components/ui/disclosure';
import { ChipSelect, ComposeBody, ComposeTitle, InlineInput, Input } from '@/components/ui/field';
import { Figure } from '@/components/ui/figure';
import { Meter } from '@/components/ui/meter';
import { Kbd } from '@/components/shell/key-hints';
import { ICON_STROKE } from './measurements';
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

const TIMELINE: readonly { when: string; what: string; note: string }[] = [
  { when: '4 Sep', what: 'Rejected', note: 'After the take-home, no stage given.' },
  { when: '28 Aug', what: 'Take-home sent', note: 'Two days to return it.' },
  { when: '21 Aug', what: 'Screen with the hiring manager', note: '30 minutes, video.' },
  { when: '14 Aug', what: 'First human reply', note: 'From the recruiter, not the portal.' },
  { when: '11 Aug', what: 'Confirmation', note: 'Automatic, from the ATS.' },
  { when: '11 Aug', what: 'Applied', note: 'Through the company board.' },
];

/**
 * A detail page: what it is, its properties, then what has happened to it.
 *
 * Drawn from what the role page and the order page carry rather than from
 * anywhere else, since those two are the pages moved onto it in #167 and #168.
 * The arrangement is `DetailLayout`, which is the answer #163 settled on: the
 * drawing and the pages are the same component, so a page cannot drift from
 * this without the drawing moving too.
 */
function DetailAnatomy() {
  return (
    <DetailLayout
      header={
        <PageHeader
          title="Quantitative Developer"
          description="Jane Street · London · Hybrid"
          actions={
            <Button size="sm" variant="secondary">
              Original posting
            </Button>
          }
        />
      }
      properties={
        <PropertyList>
          <Property label="Applied" value="11 Aug 2026" />
          <Property label="Confirmed" value="11 Aug 2026" />
          <Property
            label="First reply"
            value="14 Aug 2026"
            hint="Automatic confirmations never set this."
          />
          <Property label="Source" value="Company board" />
          <Property label="Comp band" value="£120k – £160k" />
          <Property label="Posting" value="Closed" />
          <Property label="ATS" value="Greenhouse" />
          <Property label="Outcome" value="Rejected at take-home" />
        </PropertyList>
      }
    >
      <div className="space-y-6">
        <Group title="Timeline">
          <Card padding="none">
            <ul className="divide-y divide-border">
              {TIMELINE.map((event) => (
                <li key={event.what} className="card-pad-x row-pad flex gap-3">
                  <span className="tabular w-16 shrink-0 text-small text-ink-muted">
                    {event.when}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ui text-ink">{event.what}</span>
                    <span className="block text-small text-ink-muted">{event.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Group>

        <CardSection title="Notes" hint="What you wrote while reading the page.">
          <p className="text-body text-ink-muted">
            The take-home was a backtest harness. Ask about their data licensing next time.
          </p>
        </CardSection>
      </div>
    </DetailLayout>
  );
}

const SPEND_BY_MERCHANT: readonly { name: string; cents: number }[] = [
  { name: 'Amazon', cents: 184_300 },
  { name: 'Uniqlo', cents: 42_000 },
  { name: 'John Lewis', cents: 31_500 },
  { name: 'Etsy', cents: 8_600 },
];

/** The same total as the merchants above, cut the other way. */
const SPEND_BY_CATEGORY: readonly { name: string; cents: number }[] = [
  { name: 'Electronics', cents: 129_000 },
  { name: 'Home', cents: 61_500 },
  { name: 'Clothing', cents: 45_600 },
  { name: 'Kitchen', cents: 30_300 },
];

const RETURNABLE: readonly { name: string; left: string }[] = [
  { name: 'Ridgeline backpack', left: '4 days left' },
  { name: 'Espresso tamper', left: '11 days left' },
  { name: 'Merino socks, five pairs', left: '26 days left' },
];

/**
 * A dashboard: one figure, the breakdowns that explain it, what to act on.
 *
 * Drawn from app/shopping/dashboard/page.tsx and the analytics page, which are
 * the same arrangement with different numbers in it. /home and the jobs week
 * are not this shape and are not drawn here -- see the note in ANATOMIES.
 */
function DashboardAnatomy() {
  const total = SPEND_BY_MERCHANT.reduce((sum, row) => sum + row.cents, 0);
  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <LeftRail>
        <RailGroup label="Time range">
          <RailItem label="This month" href="#" active />
          <RailItem label="Last 3 months" href="#" />
          <RailItem label="This year" href="#" />
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader title="Dashboard" description="What you spent, and what is still returnable." />

        <div className="space-y-4">
          <Figure
            label="Spent this month"
            meta="1 – 30 September"
            value={formatMoney(total, 'USD', { showCents: false })}
            caption="Refunds already taken off."
            secondary={[
              { value: '31', label: 'orders' },
              { value: '3', label: 'still returnable' },
              {
                value: formatMoney(1_284_000, 'USD', { showCents: false }),
                label: 'owned, at cost',
              },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <CardSection title="Where it went" hint="By merchant, this month.">
              <ul className="space-y-2">
                {SPEND_BY_MERCHANT.map((row) => (
                  <li key={row.name} className="space-y-1">
                    <p className="flex items-baseline justify-between gap-3 text-ui">
                      <span className="text-ink">{row.name}</span>
                      <span className="tabular text-ink-muted">
                        {formatMoney(row.cents, 'USD', { showCents: false })}
                      </span>
                    </p>
                    <Meter
                      value={row.cents}
                      max={total}
                      label={`${row.name}, ${formatMoney(row.cents, 'USD', { showCents: false })} of ${formatMoney(total, 'USD', { showCents: false })}`}
                    />
                  </li>
                ))}
              </ul>
            </CardSection>

            <CardSection title="By category" hint="The same money, cut the other way.">
              <ul className="space-y-2">
                {SPEND_BY_CATEGORY.map((row) => (
                  <li key={row.name} className="space-y-1">
                    <p className="flex items-baseline justify-between gap-3 text-ui">
                      <span className="text-ink">{row.name}</span>
                      <span className="tabular text-ink-muted">
                        {formatMoney(row.cents, 'USD', { showCents: false })}
                      </span>
                    </p>
                    <Meter
                      value={row.cents}
                      max={total}
                      label={`${row.name}, ${formatMoney(row.cents, 'USD', { showCents: false })} of ${formatMoney(total, 'USD', { showCents: false })}`}
                    />
                  </li>
                ))}
              </ul>
            </CardSection>
          </div>

          <Card padding="none">
            <ul className="divide-y divide-border">
              {RETURNABLE.map((row) => (
                <li key={row.name} className="card-pad-x row-pad flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">{row.name}</span>
                  <span className="shrink-0 text-small text-ink-muted">{row.left}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * A settings page: one column of sections, each holding related values.
 *
 * The four settings pages -- shopping, jobs, vault and todo -- are this
 * arrangement at two column widths. What varies is how many sections there
 * are, not how one is built.
 */
function SettingsAnatomy() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="What this workspace does. Your name and timezone are under Account."
      />

      <div className="space-y-4">
        <CardSection title="Inboxes" hint="Where orders are read from.">
          <ul className="divide-y divide-border">
            <li className="row-pad flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-ui text-ink">you@gmail.com</span>
                <span className="block text-small text-ink-muted">Last sync 14 minutes ago</span>
              </span>
              <Button size="sm" variant="secondary">
                Sync now
              </Button>
            </li>
            <li className="row-pad flex items-center gap-3">
              <span className="min-w-0 flex-1 text-ui text-ink-muted">Add another inbox</span>
              <Button size="sm" variant="ghost">
                Connect
              </Button>
            </li>
          </ul>
        </CardSection>

        <CardSection
          title="Returns"
          hint="What counts as a return window when a merchant does not say."
        >
          <div className="flex items-center gap-2 text-body text-ink">
            Default return window
            <InlineInput
              aria-label="Default return window in days"
              defaultValue="30"
              className="tabular w-12 text-right font-medium"
            />
            <span className="text-small text-ink-muted">days</span>
          </div>
        </CardSection>

        <CardSection title="Categories" hint="Yours, in the order they are offered.">
          <ul className="divide-y divide-border">
            {SPEND_BY_CATEGORY.map((row, index) => (
              <li key={row.name} className="row-pad flex items-center gap-3 text-ui text-ink">
                <span className="min-w-0 flex-1">{row.name}</span>
                <span className="tabular shrink-0 text-small text-ink-muted">
                  {[31, 12, 9, 4][index]}
                </span>
              </li>
            ))}
          </ul>
        </CardSection>
      </div>
    </div>
  );
}

/**
 * A compose surface: what it files, one thing to type into, the properties as
 * chips, then the action.
 *
 * The shape of the capture panel in components/shell/capture.tsx, which is
 * where it is at its most complete. The same four parts are what a task
 * composer on /todo and a note box on a detail page are made of; they differ
 * in whether they float and in how many chips they carry.
 */
function ComposeAnatomy() {
  return (
    <div className="mx-auto max-w-lg">
      <Card padding="none">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
            New task · Todo
          </span>
          <Kbd always>esc</Kbd>
        </div>

        <div className="space-y-3 px-3 py-3">
          <ComposeTitle
            defaultValue=""
            placeholder="What has to happen"
            aria-label="Anatomy compose title"
          />
          {/* ui-ok: composer-always-open -- this is the drawing of a compose
           * surface. The panel it draws is opened on purpose and closes on
           * esc, which is what law 14 asks for. */}
          <ComposeBody rows={2} placeholder="What it involves…" aria-label="Anatomy compose body" />
          <div className="flex flex-wrap items-center gap-1">
            <ChipSelect
              aria-label="Anatomy status"
              defaultValue="todo"
              icon={<Circle className="size-3.5" strokeWidth={ICON_STROKE} />}
            >
              <option value="todo">Not started</option>
              <option value="doing">In progress</option>
            </ChipSelect>
            <ChipSelect
              aria-label="Anatomy due day"
              defaultValue="today"
              icon={<CalendarDays className="size-3.5" strokeWidth={ICON_STROKE} />}
            >
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
            </ChipSelect>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span className="text-small text-ink-muted">Enter files it.</span>
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
            <Button size="sm">File it</Button>
          </span>
        </div>
      </Card>
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
  {
    id: 'anatomy-detail',
    label: 'A detail page',
    note: 'The header, then the properties, then everything that has happened. From lg up the properties are a column on the right that stays put while the body scrolls; below that they are a grid of facts between the header and the body, because the facts are what the page was opened for.',
    render: () => <DetailAnatomy />,
  },
  {
    id: 'anatomy-dashboard',
    label: 'A dashboard',
    note: 'The range in the rail, then the one figure the page is about with its supporting numbers under a rule, then the breakdowns that explain it -- two across from lg, stacked below -- and the rows worth acting on at the foot. The shopping dashboard and the jobs analytics page are both this. /home and the jobs week are not: the first is a date and what needs you, the second is grouped lists, and neither has a figure.',
    render: () => <DashboardAnatomy />,
  },
  {
    id: 'anatomy-settings',
    label: 'A settings page',
    note: 'One column, a header, and a section per group of related values. Never a card per setting: a section holds as many rows as the group has, and a value that is read more often than it is changed is shown as itself with an input around it. All four settings pages are this at one of two column widths.',
    render: () => <SettingsAnatomy />,
  },
  {
    id: 'anatomy-compose',
    label: 'A compose surface',
    note: 'What it will file, one thing to type into, the properties as chips carrying their own values, and the action at the foot. No labels anywhere: a chip reading Today is its own caption. The capture panel is this floating over a scrim; a composer inside a page is the same four parts on a card.',
    render: () => <ComposeAnatomy />,
  },
];
