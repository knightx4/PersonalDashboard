/* ui-ok-file: undefined-colour -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-chip -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-icon-button -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-label -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-link -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: raw-checkbox -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: raw-kbd -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: pulsing-dot -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: dashed-without-width -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: heavy-stroke -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: fixed-radius -- this file draws the app's markup from before the overhaul, on purpose. */
/* ui-ok-file: hand-rolled-box -- the radius swatches are drawings of a corner, and the prose names classes. */
/* ui-ok-file: fixed-control-height -- the radius swatches are drawings, not controls. */

import { ChevronDown, ChevronRight, HelpCircle, MoreHorizontal, Pencil, Plus, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Kbd } from '@/components/ui/kbd';
import { EmptyState } from '@/components/ui/empty-state';
import { Banner } from '@/components/ui/banner';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { Specimen, Specimens } from './frame';
import * as Now from './now';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Chip } from '@/components/ui/chip';
import { linkVariants } from '@/components/ui/link';
import { CheckRow, Switch } from '@/components/ui/field';
import { SectionHeading, SectionLabel } from '@/components/ui/section-heading';
import { Note } from '@/components/ui/note';
import { Stat } from '@/components/ui/stat';
import { LiveDot } from '@/components/ui/live-dot';
import { menuItemClass, popoverSurface } from '@/components/ui/popover';
import { SegmentedLinks, ToggleChipRow } from './after-interactive';

/**
 * The component overhaul, one entry per component (/preview/overhaul).
 *
 * `drift` is what the audit of 13 October 2026 counted in app/ and
 * components/. `problems` say what is wrong with the component as it stands
 * or with the copies made of it. `change` is the proposal. `moves` is what
 * the call sites would have to do. `now` draws today, `next` the proposal.
 */
export type Entry = {
  id: string;
  name: string;
  family: 'Controls' | 'Labels and text' | 'Containers' | 'Shape';
  /** One line: how far the app has drifted from a single version. */
  drift: string;
  problems: readonly string[];
  change: readonly string[];
  moves: string;
  now: () => React.ReactNode;
  next: () => React.ReactNode;
};

export const ENTRIES: readonly Entry[] = [
  {
    id: 'button',
    name: 'Button',
    family: 'Controls',
    drift: 'About 190 hand-written buttons in 99 files, about 60 of them shaped like a Button.',
    problems: [
      'Underlined text actions such as "Not a match" and "Regenerate" are written by hand 27 times. They come in three versions: hover to ink, hover to accent, and underlined only on hover.',
      'Small ghost buttons inside rows ("Keep", "Cancel") are written about 20 times at px-1 to px-1.5, with no shared height.',
      'Four files add a pressed state to a secondary Button by hand, each with slightly different classes.',
      'The ghost variant turns accent on hover, which claims the button is selected. The hand-written copies mostly hover to sunken, so ghost buttons on one page disagree.',
    ],
    change: [
      'Add a `link` variant for underlined text actions: muted ink, a quiet underline that darkens on hover, and no fixed height.',
      'Add an `xs` size (24px tall, small text) for buttons inside rows.',
      'Add a `pressed` prop that sets aria-pressed and the accent-tint on state.',
      'Ghost hover becomes sunken ground and full ink. Accent is kept for "on" and for the primary action.',
    ],
    moves: 'Mechanical: each hand-written copy becomes <Button variant=… size=…>. A check:ui rule against `underline underline-offset-2` on a raw <button> keeps it that way.',
    now: () => <Now.NowButtons />,
    next: () => (
      <Specimens>
        <Specimen label="primary, secondary, ghost, danger (ghost now hovers quiet)">
          <Button>Save</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Delete</Button>
        </Specimen>
        <Specimen label="variant=link: every underlined text action">
          <Button variant="link">Not a match</Button>
          <Button variant="link">Regenerate</Button>
          <Button variant="link">I don&rsquo;t know</Button>
        </Specimen>
        <Specimen label="size=xs, for a button inside a row">
          <Button variant="ghost" size="xs">Keep</Button>
          <Button variant="secondary" size="xs">Undo</Button>
        </Specimen>
        <Specimen label="pressed, for a button that is a toggle">
          <Button variant="secondary" pressed>Reading now</Button>
          <Button variant="secondary" pressed={false}>Read now</Button>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'icon-button',
    name: 'Icon button',
    family: 'Controls',
    drift: 'One shared IconActionButton, used by 1 file outside components/ui; about 50 hand-written copies.',
    problems: [
      'The copies come in five sizes (16, 20, 24, 28 and 32px) and four radii (rounded, rounded-lg, rounded-control, rounded-full).',
      'The shared one hovers to accent, and 23 copies hover to sunken.',
      'Icons inside are 14 or 16px with stroke 1.75 or 2, so two icon buttons beside each other can differ in weight.',
      'rounded-lg is a fixed 8px. In the Aurora and Dawn themes the controls beside it are rounder, and in Poster they are square while it stays rounded.',
    ],
    change: [
      'One IconButton with two sizes: `sm` is 24px with a 14px icon, and `md` is 32px with a 16px icon. The size sets the icon size, so a call site cannot get it wrong.',
      'The radius is rounded-control, so it follows the theme.',
      'It hovers to sunken. `active` is the only state that uses accent.',
      'A label is required. It becomes aria-label and the tooltip.',
    ],
    moves: 'IconActionButton becomes an alias of IconButton md. Each hand-written copy moves to sm or md; a copy at size-7 picks the nearer one.',
    now: () => <Now.NowIconButtons />,
    next: () => (
      <Specimens>
        <Specimen label="md: 32px, 16px icon">
          <IconButton label="Edit">
            <Pencil strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton label="More">
            <MoreHorizontal strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton label="Close">
            <X strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton label="More, open" active>
            <MoreHorizontal strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Specimen>
        <Specimen label="sm: 24px, 14px icon, for inside a row">
          <IconButton label="Open" size="sm">
            <ChevronRight strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton label="Fold" size="sm">
            <ChevronDown strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton label="Add" size="sm">
            <Plus strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'chip',
    name: 'Chip',
    family: 'Labels and text',
    drift: 'No shared component. About 60 hand-written chips in four radii, two text sizes and four grounds.',
    problems: [
      'rounded-pill is used 37 times in 21 files, mostly in Learn, and no token defines it, so those chips draw with square corners.',
      'bg-accent-soft is also undefined, so the "What you selected" chip in Learn has no ground at all.',
      'The same neutral chip sits on canvas, sunken or raised depending on the file.',
      'Some are uppercase with tracking and some are not, with no rule for which.',
    ],
    change: [
      'One Chip with five tones (neutral, accent, caution, danger, positive) and two sizes (sm is micro text, md is small text).',
      'It is always rounded-full and never uppercase. Numbers in it are tabular.',
      'A chip is never pressable. A chip you press is a ToggleChip (next entry).',
      'KindBadge and PersonBadge are rebuilt on Chip. A check:ui rule rejects `rounded-pill` and `bg-accent-soft`.',
    ],
    moves: 'Mechanical. The tone follows the colour each copy already uses; uppercase copies lose the uppercase.',
    now: () => <Now.NowChips />,
    next: () => (
      <Specimens>
        <Specimen label="md, the five tones">
          <Chip>Behavioural</Chip>
          <Chip tone="accent">What you selected</Chip>
          <Chip tone="caution">
            <AlertTriangle strokeWidth={1.75} aria-hidden />
            Not synced
          </Chip>
          <Chip tone="danger">Rejected</Chip>
          <Chip tone="positive">Delivered</Chip>
        </Specimen>
        <Specimen label="sm, for inside a dense row">
          <Chip size="sm">Applied</Chip>
          <Chip size="sm" tone="accent">Raised</Chip>
          <Chip size="sm">×3</Chip>
          <Chip size="sm" tone="caution">
            <HelpCircle strokeWidth={1.75} aria-hidden />2
          </Chip>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'toggle-chip',
    name: 'Toggle chip',
    family: 'Controls',
    drift: 'About 20 hand-written chip and filter rows in four styles.',
    problems: [
      'The day picker is written twice, in the task form and in capture. One puts text-surface on the accent, the other text-fill-ink. fill-ink is the token for text on a filled accent (button.tsx); text-surface reads today only because the surface happens to contrast with the accent in each theme.',
      'Filter rows are rounded-lg at ui size in one place and pill-shaped at small size in another, for the same job.',
      'The changelog and calendar use a filled accent for "selected". Segmented and Tabs use accent tint, so a page with both shows two meanings of selected.',
    ],
    change: [
      'One ToggleChip: rounded-full, 28px tall, small text and a hairline border when off.',
      'When on, it uses accent tint and accent ink, the same on-state as Segmented and Tabs.',
      'A row of them picks one or several, and on a phone it stays on one line ending in "More" (the categories-one-line preference).',
    ],
    moves: 'The day pickers, filter rows and grouping rows move to ToggleChip. FilterChips in the shell is rebuilt on it.',
    now: () => <Now.NowToggleChips />,
    next: () => (
      <Specimens>
        <Specimen label="A day picker">
          <ToggleChipRow options={['Today', 'Tomorrow', 'Friday']} initial="Today" />
        </Specimen>
        <Specimen label="A filter row">
          <ToggleChipRow options={['All', 'Open', 'Done']} initial="All" />
        </Specimen>
        <Specimen label="A grouping row">
          <ToggleChipRow options={['Day', 'Week', 'Feature']} initial="Week" />
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'segmented',
    name: 'Segmented',
    family: 'Controls',
    drift: 'Nine files copy Segmented’s class string by hand, so a row of links can wear it.',
    problems: [
      'Segmented takes buttons with onChange, and a view switch is a row of links, so each page that needs one copies the string.',
      'The pipeline view switch copies it at h-7 instead of the density height, so it is shorter than the button beside it at the default density.',
    ],
    change: [
      'Export `segmentClass(on)` and a SegmentedLinks wrapper from segmented.tsx, so a row of links looks the same as Segmented without copying anything.',
      'There is no visual change. This entry is about removing nine copies and the one that has drifted.',
    ],
    moves: 'The nine copies import segmentClass. view-toggle.tsx gets the density height back.',
    now: () => <Now.NowSegmented />,
    next: () => (
      <Specimens>
        <Specimen label="SegmentedLinks: the same look, as links, on the density dial">
          <SegmentedLinks options={['Focus', 'Board', 'Table']} initial="Focus" />
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'link',
    name: 'Link',
    family: 'Labels and text',
    drift: '239 files import next/link directly, against 21 using ui/link. Inline links come in six class strings.',
    problems: [
      'A link inside a sentence is accent with no underline in 29 places, accent and medium weight in 13, and underlined ink in 11. A reader on a phone, who cannot hover, sees no underline in most of them.',
      'Only ui/link shows the pending state when a link is pressed, so most links give no sign that a press was taken (the loading-at-once preference).',
      'About eight raw <a> elements point at routes inside the app, which reloads the whole page.',
    ],
    change: [
      'Export `linkVariants` with two tones. `inline` is for a link in a sentence: accent with a faint accent underline that darkens on hover. `quiet` is for a link under a row as metadata: muted ink with a hairline underline.',
      'Every internal link goes through ui/link. An ESLint rule restricts importing next/link anywhere else.',
    ],
    moves: 'A codemod for the next/link import. Inline class strings become linkVariants({ tone }).',
    now: () => <Now.NowLinks />,
    next: () => (
      <Specimens>
        <Specimen label="inline: a link inside a sentence">
          <p className="text-ui text-ink">
            Read the{' '}
            <a href="#links" className={linkVariants({ tone: 'inline' })}>
              posting
            </a>{' '}
            first.
          </p>
        </Specimen>
        <Specimen label="quiet: a link under a row">
          <div>
            <p className="text-ui text-ink">Send Dana the follow-up on the backtester question</p>
            <a href="#links" className={cn(linkVariants({ tone: 'quiet' }), 'text-small')}>
              Senior Software Engineer, Research Platform
            </a>
          </div>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'checkbox',
    name: 'Checkbox and switch',
    family: 'Controls',
    drift: 'No shared component. 28 checkboxes in three spellings; two settings use a checkbox with role="switch".',
    problems: [
      'The most common spelling (`rounded border-border text-accent focus:ring-accent/30`) was written for the Tailwind forms plugin, which is not installed. Those classes do nothing, and the box is the browser’s default blue.',
      'A checkbox with a title and a line of hint under it is written about ten times, with the gap and alignment differing each time.',
      'Settings that take effect at once are drawn as checkboxes, which look like they need a Save.',
    ],
    change: [
      'A Checkbox coloured by the accent token through accent-color, so it follows the theme.',
      'A CheckRow holding the box, the title and the hint, aligned to the first line of the title.',
      'A Switch for a setting that applies the moment it is pressed. It is a real role="switch" button with the same row shape.',
    ],
    moves: 'The 28 checkboxes move to Checkbox or CheckRow. The haptics and notification settings move to Switch.',
    now: () => <Now.NowCheckboxes />,
    next: () => (
      <Specimens>
        <Specimen label="CheckRow">
          <div className="w-full space-y-1">
            <CheckRow title="Count toward the budget" defaultChecked />
            <CheckRow title="Ready to build" hint="A session can pick it up." defaultChecked />
            <CheckRow title="Already read it" />
          </div>
        </Specimen>
        <Specimen label="Switch, for a setting that applies at once">
          <div className="w-full">
            {[
              { label: 'Haptics', hint: 'A small tap when something is done.', on: true },
              { label: 'Morning summary', hint: undefined, on: false },
            ].map((row) => (
              <label key={row.label} className="flex items-start justify-between gap-4 py-1">
                <span className="min-w-0">
                  <span className="block text-ui text-ink">{row.label}</span>
                  {row.hint && <span className="mt-0.5 block text-small text-ink-muted">{row.hint}</span>}
                </span>
                <Switch defaultChecked={row.on} className="mt-0.5" />
              </label>
            ))}
          </div>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'section-heading',
    name: 'Section heading and label',
    family: 'Labels and text',
    drift: 'GroupHeader has 5 uses against 79 hand-written uppercase labels in six styles; section headings are split between ui and body size.',
    problems: [
      'On the company page, one card’s heading has an icon and the next does not. The first card’s action sits on its own line under the heading, and the second’s sits beside it.',
      'The small uppercase label over a group of values comes in micro, small and ui sizes, with tracking-wide or tracking-wider.',
      'GroupHeader requires a count, so places with no count write their own label.',
    ],
    change: [
      'A SectionHeading at ui size and semibold, with an optional count beside it and the action on the same line, right-aligned. It has no icon, because the card is the grouping and the icon only adds weight to the heading.',
      'A SectionLabel for the small label over a field or a group: micro, uppercase, tracking-wider, with an optional count. GroupHeader is rebuilt on it.',
      'CardSection draws its heading through SectionHeading, so the action-on-its-own-line case cannot happen.',
    ],
    moves: 'The 79 labels move to SectionLabel. Headings with an icon lose the icon.',
    now: () => <Now.NowHeadings />,
    next: () => (
      <Specimens>
        <Specimen label="Two cards on one page, both through SectionHeading">
          <div className="w-full space-y-3">
            <div className="sheet card-pad-dense rounded-card bg-surface">
              <SectionHeading title="Roles here, across cycles" count={2} action={<Button variant="ghost" size="sm">Merge roles</Button>} />
              <p className="text-ui text-ink">Senior Software Engineer, Research Platform</p>
            </div>
            <div className="sheet card-pad-dense rounded-card bg-surface">
              <SectionHeading
                title="Tasks"
                count={1}
                action={
                  <Button variant="ghost" size="sm">
                    <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
                    Add
                  </Button>
                }
              />
              <p className="text-ui text-ink">Send Dana the follow-up</p>
            </div>
          </div>
        </Specimen>
        <Specimen label="SectionLabel, with and without a count">
          <div className="space-y-3">
            <SectionLabel count={4}>This week</SectionLabel>
            <SectionLabel>What they asked</SectionLabel>
          </div>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'note',
    name: 'Note and banner',
    family: 'Containers',
    drift: 'Banner is shared. About 50 inset boxes and 23 tinted boxes inside cards are written by hand.',
    problems: [
      'A box inside a card uses rounded, rounded-md, rounded-lg, rounded-control or rounded-card, and padding p-3, px-2 py-1.5 or px-3 py-2.5.',
      'Warnings that belong to one row are small hand-written caution boxes, because Banner is sized for the top of a page.',
      'One copy uses caution at 40% opacity, which is a fourth caution colour.',
      'Quotes and Dash’s words are boxed in the same way as the person’s own notes, against the no-bare-text preference that they look different.',
    ],
    change: [
      'A Note for anything boxed inside a card. It has four tones: neutral (sunken), accent and caution (each with a glyph), and quote (a left rule and no box).',
      'It uses one radius (the control’s) and one inset (px-3 py-2).',
      'Banner stays for the message at the top of a page, unchanged.',
    ],
    moves: 'Each inset box picks a tone. The caution/40 copy becomes caution.',
    now: () => <Now.NowCallouts />,
    next: () => (
      <Specimens>
        <Specimen label="Banner, unchanged, for the top of a page">
          <Banner tone="warn" className="w-full">The vault has not synced since Tuesday.</Banner>
        </Specimen>
        <Specimen label="Note, the four tones">
          <div className="w-full space-y-2">
            <Note>Rent is due on the first.</Note>
            <Note tone="caution">The deadline passed two days ago.</Note>
            <Note tone="accent" title="The takeaway">Spaced repetition beats rereading.</Note>
            <Note tone="quote">&ldquo;We move fast, and we want people who like that.&rdquo;</Note>
          </div>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'empty-state',
    name: 'Empty state',
    family: 'Containers',
    drift: '85 uses of EmptyState; about 10 dashed cards and 15 bare lines written by hand.',
    problems: [
      'EmptyState is sized for a whole page, so empty sections inside a page write their own dashed card at py-6, py-8 or py-10, in ui or body text.',
      'Most of those copies add `border-dashed` to a card without a border width. A card has no border at rest, so the dashed outline never draws, and the empty state is plain text floating in a gap. About 20 places do this.',
      'Bare lines such as "No steps under this feature yet." say what is missing but give no way to add it, against the add-is-one-press preference.',
    ],
    change: [
      'EmptyState gets a `size`: `page` is today’s component, `box` is a dashed card for an empty section, and `inline` is one line for an empty list inside a card.',
      'Each size takes an action, so the empty state can end itself in one press.',
    ],
    moves: 'Dashed cards move to size="box", bare lines to size="inline" with the add action that already sits elsewhere on the page.',
    now: () => <Now.NowEmpty />,
    next: () => (
      <Specimens>
        <Specimen label="page, unchanged">
          <EmptyState className="w-full" title="No roles yet" description="Roles you save from a posting land here." />
        </Specimen>
        <Specimen label="box, for an empty section">
          <div className="w-full">
            <EmptyState size="box" title="No mail linked yet" description="Mail about this role is linked when it arrives.">
              <Button variant="secondary" size="sm">Find mail</Button>
            </EmptyState>
          </div>
        </Specimen>
        <Specimen label="inline, for an empty list inside a card">
          <EmptyState size="inline" title="No steps under this feature yet.">
            <Button variant="link">Add a step</Button>
          </EmptyState>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'value-list',
    name: 'Value list',
    family: 'Containers',
    drift: '25 uses of ValueList; 23 hand-written <dl> elements.',
    problems: [
      'Order totals, sale panels and game details write their own <dl>, each with its own gap and its own label colour.',
      'The hand-written ones put the value on the right, and ValueList puts it under the label on a phone. That is the right choice for long values and the wrong one for money.',
    ],
    change: [
      'ValueRow gets `align="end"` for a short value read against its label (money, counts and dates), which keeps label and value on one line at every width.',
      'It also gets `total` for the line that sums the ones above it: a hairline, then semibold.',
    ],
    moves: 'The 23 <dl>s move onto ValueList.',
    now: () => <Now.NowValues />,
    next: () => (
      <Specimens>
        <Specimen label="ValueList, unchanged, for long values">
          <ValueList className="w-full">
            <ValueRow label="Ordered" value="12 Sep 2026" />
            <ValueRow label="Return by" value="12 Oct 2026" />
            <ValueRow label="Tracking" value="" />
          </ValueList>
        </Specimen>
        <Specimen label='align="end" and total, for money'>
          <dl className="w-full space-y-1.5">
            {[
              ['Subtotal', '$84.00'],
              ['Shipping', '$6.50'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4">
                <dt className="text-small text-ink-muted">{label}</dt>
                <dd className="tabular text-ui text-ink">{value}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1.5">
              <dt className="text-small font-medium text-ink">Total</dt>
              <dd className="tabular text-ui font-semibold text-ink">$90.50</dd>
            </div>
          </dl>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'stat',
    name: 'Stat',
    family: 'Labels and text',
    drift: 'Figure has 6 uses. Smaller numbers with a label are written by hand at title and body size.',
    problems: [
      'A count with its label is drawn at text-title with no tracking in the inbox, and at text-body with tight tracking on the jobs home page.',
      'The label is above the number in one place and below it in another.',
    ],
    change: [
      'A Stat: the number first, then the label under it in small muted text.',
      'It has two sizes, `md` at title size in the display face and `sm` at body size, both tabular and tight.',
      'Figure stays for the one number a page is about.',
    ],
    moves: 'The hand-written stat rows move to Stat. Figure’s secondary row is rebuilt on Stat sm.',
    now: () => <Now.NowStats />,
    next: () => (
      <Specimens>
        <Specimen label="md">
          <div className="flex gap-8">
            <Stat value="14" label="To read" />
            <Stat value="3" label="Waiting on you" />
          </div>
        </Specimen>
        <Specimen label="sm">
          <div className="flex gap-6">
            <Stat size="sm" value="23" label="Applied" />
            <Stat size="sm" value="4" label="Interviews" />
          </div>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'kbd',
    name: 'Keyboard key',
    family: 'Labels and text',
    drift: 'Kbd has 12 uses; 8 raw <kbd> elements in two other styles.',
    problems: [
      'The review list and the email matcher draw their own keys, one on surface and one on canvas, at two sizes, with no bottom edge, so they do not look like Kbd.',
    ],
    change: [
      'No change to Kbd itself. The raw keys move to <Kbd always>.',
      'Kbd moves from components/shell to components/ui, because it is a primitive and not part of the frame.',
    ],
    moves: 'Eight lines.',
    now: () => <Now.NowKbd />,
    next: () => (
      <Specimens>
        <Specimen label="Kbd everywhere">
          <span className="flex items-center gap-1 text-small text-ink-muted">
            <Kbd always>j</Kbd>/<Kbd always>k</Kbd> to move
          </span>
          <Kbd always>1</Kbd>
          <Kbd always>⌘K</Kbd>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'live-dot',
    name: 'Live dot',
    family: 'Labels and text',
    drift: 'Four hand-written copies.',
    problems: [
      'animate-pulse fades the dot itself, so for part of every second it is almost invisible, and a glance can read it as off.',
      'It keeps pulsing when the person has asked for reduced motion.',
    ],
    change: [
      'A LiveDot that stays solid and pulses a ring behind it. The pulse stops under reduced motion and the dot stays.',
      'It comes in accent (running) and caution (gone quiet).',
    ],
    moves: 'Four lines.',
    now: () => <Now.NowLiveDot />,
    next: () => (
      <Specimens>
        <Specimen label="Running">
          <p className="flex items-center gap-2 text-small text-accent">
            <LiveDot />
            Dash is planning this area
          </p>
        </Specimen>
        <Specimen label="Gone quiet">
          <p className="flex items-center gap-2 text-small text-ink-muted">
            <LiveDot tone="caution" />
            No word for 20 minutes
          </p>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'menu',
    name: 'Menu and popover',
    family: 'Containers',
    drift: 'ActionMenu and Popover draw two different panels; about five autocomplete lists build a third and fourth.',
    problems: [
      'ActionMenu’s panel is rounded-lg, a fixed 8px, and Popover’s is rounded-card, which follows the theme. Two menus on one page have different corners.',
      'ActionMenu’s items run edge to edge and hover to canvas. Popover’s inset items use rounded-md.',
      'Merchant, return-policy and link-picker autocompletes each build their own list, at two stacking layers and two offsets.',
    ],
    change: [
      'One floating surface (rounded-card, raised, a hairline border, and shadow-lg) for menus, popovers and autocomplete lists.',
      'Menu items sit inset by 4px, with control-radius rows that hover to sunken. Destructive items stay danger.',
      'One Combobox is extracted from TimezoneField for the autocompletes.',
    ],
    moves: 'ActionMenu’s panel and items change in one file; the autocompletes move to Combobox.',
    now: () => <Now.NowMenus />,
    next: () => (
      <Specimens>
        <Specimen label="One surface, inset items">
          <div className={cn(popoverSurface, 'w-52 p-1')}>
            {['Open', 'Rename', 'Move to…'].map((item) => (
              <button key={item} type="button" className={menuItemClass()}>
                {item}
              </button>
            ))}
            <div className="my-1 h-px bg-border" aria-hidden />
            <button type="button" className={menuItemClass(true)}>
              Delete
            </button>
          </div>
        </Specimen>
      </Specimens>
    ),
  },
  {
    id: 'shape',
    name: 'Corners and icons',
    family: 'Shape',
    drift: 'Eleven radius names in use, only three of which follow the theme; icons at four sizes and two stroke weights.',
    problems: [
      'rounded-lg (88 places), rounded-md (32) and rounded-xl are fixed sizes. In Aurora and Dawn they are less round than the controls around them, and in Poster, where everything is square, they stay rounded.',
      'rounded-pill renders nothing (see Chip).',
      'Icons are 12, 14, 16 or 20px, and 14px is used more than the 16px the standard calls the default. Stroke 2 appears 235 times against 297 for the 1.75 the standard sets, most of it in Learn.',
    ],
    change: [
      'Four radii, all following the theme: control (8px) for anything you press or type in, card (12px) for anything that holds content, pane (16px) for the page itself, and full for chips and dots.',
      'Add a `--radius-pill` token that is full everywhere and 0 in Poster, so chips square up with the rest of that theme.',
      'Icons are 14px inline with text, 16px everywhere else and 20px only in empty states and the dock. Stroke is 1.75, set once in an Icon wrapper instead of on each icon.',
      'check:ui gets rules for rounded-(sm|md|lg|xl|2xl), arbitrary radii and strokeWidth={2}.',
    ],
    moves: 'Mostly mechanical: rounded-md and rounded-lg map to control, popovers and thumbnails to card.',
    now: () => <Now.NowShape />,
    next: () => (
      <Specimens>
        <Specimen label="Four radii, all following the theme">
          <div className="grid w-full grid-cols-4 gap-3">
            {[
              ['rounded-control', 'Press or type'],
              ['rounded-card', 'Holds content'],
              ['rounded-pane', 'The page'],
              ['rounded-full', 'Chips, dots'],
            ].map(([name, use]) => (
              <div key={name} className="space-y-1">
                <div className={cn('h-10 w-full border border-border-strong bg-surface', name)} />
                <p className="break-all font-mono text-micro text-ink-muted">{name}</p>
                <p className="text-micro text-ink-ghost">{use}</p>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="Icons: 14 inline, 16 default, 20 for empty states; stroke 1.75 throughout">
          {(['size-3.5', 'size-4', 'size-5'] as const).map((size) => (
            <span key={size} className="flex flex-col items-center gap-1 rounded-control bg-sunken px-2 py-1.5">
              <Pencil className={cn(size, 'text-ink')} strokeWidth={1.75} aria-hidden />
              <span className="font-mono text-micro text-ink-ghost">{size.replace('size-', '')}/1.75</span>
            </span>
          ))}
        </Specimen>
      </Specimens>
    ),
  },
];

/** Components the audit found sound, with what stays as it is and why. */
export const KEPT: readonly { name: string; why: string }[] = [
  { name: 'Card and CardSection', why: 'Used in 274 files. CardSection only changes by drawing its heading through SectionHeading.' },
  { name: 'Field (Input, Select, Textarea, InlineInput, ChipSelect)', why: 'Used in 183 files, with no hand-written select and three hand-written textareas. The date and time pills could join it later.' },
  { name: 'Disclosure and folds', why: 'About 160 uses. The 15 hand-written folds are already counted by check:ui and can only go down.' },
  { name: 'Toast', why: '49 uses. Six local "Copied" timers would go into a CopyButton built on it.' },
  { name: 'Skeleton', why: 'All 19 loading files use it.' },
  { name: 'PageHeader', why: '175 uses. About 25 hand-written <h1> elements move onto it, mostly in the vault and onboarding.' },
  { name: 'Tabs, Table, Meter, StatusGlyph, ModuleMark, DashMark, Markdown, Sparkline', why: 'Each is used as designed, with at most two or three copies.' },
];

export const FAMILIES = ['Controls', 'Labels and text', 'Containers', 'Shape'] as const;
