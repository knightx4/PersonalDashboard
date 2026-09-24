import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Circle, CircleUser, Flag, Scale } from 'lucide-react';
import { Card, CardSection } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  ChipSelect,
  ComposeBody,
  ComposeTitle,
  InlineInput,
  Input,
  Label,
} from '@/components/ui/field';
import { Kbd } from '@/components/shell/key-hints';
import { Skeleton } from '@/components/ui/skeleton';
import { Figure, FigureDelta } from '@/components/ui/figure';
import { Meter } from '@/components/ui/meter';
import { Sparkline } from '@/components/ui/sparkline';
import { ReturnFuse } from '@/components/ui/return-fuse';
import { formatMoney } from '@/lib/money';
import { CLOSING_DAYS, HEALTH_ORDER, HEALTH_STATES, type HealthState } from '@/lib/health';
import { DUE_SOON_DAYS } from '@/lib/returns/deadline';
import { cn } from '@/lib/cn';
import { displaySummary, LISTS_WITH_DISPLAY } from '@/lib/list-display-registry';
import { Disclosure, Group } from '@/components/ui/disclosure';
import { MODULES } from '@/lib/modules';
import { StatusGlyph } from '@/components/ui/status-glyph';
import {
  APPLICATION_STATUS_GLYPHS,
  FEEDBACK_HEALTH_GLYPHS,
  FINDING_HEALTH_GLYPHS,
  IDEA_HEALTH_GLYPHS,
  PLAN_HEALTH_GLYPHS,
  RAISED_HEALTH_GLYPHS,
  TASK_STATUS_GLYPHS,
  type StatusGlyph as GlyphName,
} from '@/lib/status-glyphs';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { PlanHealth } from '@/lib/plan/tree';
import type { TaskStatus } from '@/lib/todo/tasks/model';
import { ActivePalette } from './palette';
import { LAW_GROUPS } from './laws';
import { ANATOMIES } from './anatomy';
import * as C from './content';
import * as M from './measurements';

export const metadata = { title: 'UI' };

/**
 * The standard the interface is held to, and the only copy of it.
 *
 * This was a static HTML file in docs/, which is the wrong place for it in
 * exactly one way that matters: a document describing an interface is a
 * *second* copy of that interface, and the copy is wrong within a month. Here
 * the swatches are the real tokens, the controls are the real components, the
 * type scale is the real scale, and the numbers are held to globals.css by a
 * test -- so the page cannot describe an app that does not exist. If a row
 * below looks wrong, the app is wrong.
 *
 * Two halves, one page. The first is how the interface looks: the laws, the
 * colour, the type, the measurements, the motion. The second is how it
 * behaves: what a keystroke does, what waits, what earns an interruption, how
 * a row is found in five hundred. The second half is the one that decides
 * whether a tool is good to use, and for a while it was the half that lived in
 * the document nobody opened. It is here now, and the document is gone.
 *
 * It is long on purpose and it is one page on purpose: a standard split
 * across two places is two standards. The contents row under the header is
 * how it is skimmed.
 */

/** A named row of the page. Plain <section>s with ids, so the whole page is skimmable and linkable. */
function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <div>
        <h2 className="text-title text-ink">{title}</h2>
        {lead ? <p className="mt-1 max-w-2xl text-body text-ink-muted">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A list of rules: one sentence each, on one surface. */
function Rules({ items }: { items: readonly string[] }) {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item} className="card-pad-x row-pad text-body text-ink">
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * A small table: the first cell names the thing, the rest describe it. The
 * first description is set in ink and the others muted, so a three-column
 * row reads as "what · the fact · the detail" rather than as three equal
 * columns fighting for the eye.
 */
function Rows({
  rows,
  labelWidth = 'sm:grid-cols-[11rem_1fr]',
}: {
  rows: readonly C.Row[];
  labelWidth?: string;
}) {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {rows.map(([label, ...rest]) => (
          <li key={label} className={cn('card-pad-x row-pad grid gap-x-4 gap-y-0.5', labelWidth)}>
            <p className="text-ui font-medium text-ink">{label}</p>
            <div className="min-w-0">
              {rest.map((cell, index) => (
                <p
                  key={index}
                  className={cn('text-body', index === 0 ? 'text-ink' : 'text-ink-muted')}
                >
                  {cell}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Every colour below is a utility class, never `style={{ background:
 * 'var(--color-x)' }}`.
 *
 * The scoped tokens -- accent above all -- are undefined at :root and are given
 * a value further down the tree, by <body>, by [data-workspace], and again by
 * any element painting a sheet. A custom property *inherits its computed
 * value*, so `var(--color-accent)` read at :root computes to nothing and every
 * descendant inherits that nothing, no matter what the scope around them says.
 * The utility resolves at the element instead, which is the whole point of the
 * scope system.
 */
function Swatch({ swatch, name, note }: { swatch: string; name: string; note?: string }) {
  return (
    <div className="flex items-center gap-3">
      {/* No hairline. A swatch is a solid mid-tone square on a card, and every
          token below -- ghost included -- has an edge against the surface
          without one being drawn. */}
      <span aria-hidden className={cn('size-7 shrink-0 rounded-control', swatch)} />
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink">{name}</p>
        {note && <p className="text-small text-ink-muted">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Three rows, rendered twice in "Shape, worked". Invented rather than fetched:
 * this page mirrors the design language, not the database, and an argument
 * about row height should not need a session to make it.
 */
const SHAPE_DEMO = [
  { mark: 'FG', role: 'Staff Engineer', company: 'Fieldgate', age: '2d' },
  { mark: 'NR', role: 'Platform Lead', company: 'Northrend Labs', age: '9d' },
  { mark: 'AC', role: 'Senior Backend Engineer', company: 'Ascent', age: '21d' },
] as const;

/**
 * Questions rather than rules, because a rule is obeyed by whoever already
 * agrees with it. A question has to be answered by whoever builds the thing.
 */
const BUILD_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'Is this scrolled, or is it a handful of things side by side?',
    'Scrolled means a list: one surface, hairlines, one line per item. Cards are for a small fixed set compared against each other — a summary strip, a chooser of four. If you cannot say the number out loud, it is a list.',
  ],
  [
    'What is the one line of an item, and what has to be on it?',
    'Decide this before the markup, because it is what sets the height. Name first in ink, its qualifier muted after it on the same line, then the numbers right-aligned in tabular figures. A second line is a decision to halve how much fits, so it has to be argued for.',
  ],
  [
    'Who is arriving, and are they reading or writing?',
    'Reading, nearly always. Then the surface renders values, and the editors are what a click reveals. Landing in edit mode is right for a create — a new order, a new role — and almost nowhere else.',
  ],
  [
    'What can be shown instead of said?',
    'A count instead of a description. A value instead of a label. A name that is right instead of a name and a sentence explaining it. If a caption and a placeholder say the same thing, the caption goes.',
  ],
  [
    'What is here when there is nothing to show?',
    'Answer it now, not last. Empty is the state a new surface spends its first weeks in, it is where the explanation belongs that law 15 takes out of the headings, and law 1 forbids the alternative of drawing the section anyway with a zero in it.',
  ],
  [
    'Which loop is this, and which tier is each write?',
    'Capture, triage, act or review — and instant, optimistic or pending for every write, with the optimistic failure path in the same commit. A page that cannot answer either is about to become the wrong kind of page.',
  ],
  [
    'Which of these can the machine check?',
    'Boxes, control heights, hexes, font sizes and scoped tokens — check:ui settles those. The numbers on this page are held to globals.css by a test. Everything else is the part a person has to look at, at 390px, which is what /dev/surfaces is for.',
  ],
];

const INK_ROLES = [
  ['bg-ink', 'Ink', 'What is being read.'],
  ['bg-ink-muted', 'Muted', 'Labels, captions, the second line.'],
  ['bg-ink-ghost', 'Ghost', 'Placeholders. Never a fact.'],
] as const;

const MEANINGS = [
  ['bg-accent', 'Accent', 'You are here. Changes per workspace.'],
  ['bg-positive', 'Positive', 'Money came back. Never generic success.'],
  ['bg-caution', 'Caution', 'Needs a decision, not an alarm.'],
  ['bg-danger', 'Danger', 'Something is wrong or will be destroyed.'],
] as const;

/**
 * Literal class names, because Tailwind finds classes by reading source. A
 * template built from the module id would compile to nothing.
 */
const WORKSPACE_HUES: Record<(typeof MODULES)[number]['id'], string> = {
  shopping: 'bg-w-shopping',
  jobs: 'bg-w-jobs',
  todo: 'bg-w-todo',
  vault: 'bg-w-vault',
  learn: 'bg-w-learn',
  news: 'bg-w-news',
  goals: 'bg-w-goals',
  dev: 'bg-w-dev',
};

/**
 * Seven stage hues, and the nine statuses drawn in them.
 *
 * The last two borrow a hue -- withdrawn takes the lead one, role closed takes
 * the ghosted one -- and are told apart by their glyph alone, which is the
 * argument for the glyphs in one line. The status id is here rather than a
 * glyph name so the shape comes from lib/status-glyphs.ts and this page cannot
 * drift from what the app draws.
 */
const PIPELINE = [
  ['bg-status-lead', 'bg-status-lead-tint', 'lead', 'Lead', 'Seen, not yet pursued.'],
  [
    'bg-status-submitted',
    'bg-status-submitted-tint',
    'submitted',
    'Submitted',
    'Sent, and landed somewhere real.',
  ],
  [
    'bg-status-process',
    'bg-status-process-tint',
    'in_process',
    'In process',
    'Someone is talking to you.',
  ],
  [
    'bg-status-final',
    'bg-status-final-tint',
    'final_round',
    'Final round',
    'The last conversation.',
  ],
  ['bg-status-offer', 'bg-status-offer-tint', 'offer', 'Offer', 'They said yes.'],
  ['bg-status-rejected', 'bg-status-rejected-tint', 'rejected', 'Rejected', 'They said no.'],
  [
    'bg-status-ghosted',
    'bg-status-ghosted-tint',
    'ghosted',
    'Ghosted',
    'Nobody said anything. Drawn as an outline.',
  ],
  [
    'bg-status-lead',
    'bg-status-lead-tint',
    'withdrawn',
    'Withdrawn',
    'You pulled out. The lead hue, struck through.',
  ],
  [
    'bg-status-ghosted',
    'bg-status-ghosted-tint',
    'role_closed',
    'Role closed',
    'The job went away. The ghosted hue, barred.',
  ],
] as const satisfies readonly (readonly [string, string, ApplicationStatus, string, string])[];

/** The other ladder the glyphs carry: a task on /todo. */
const TASK_STATES = [
  ['open', 'Open', 'Nothing has happened to it yet. The same shape as a lead.'],
  ['done', 'Done', 'Finished. The one glyph that is a tick, because it is also the toggle.'],
  ['dropped', 'Dropped', 'You decided against it. The same shape as a withdrawal.'],
] as const satisfies readonly (readonly [TaskStatus, string, string])[];

/**
 * The third ladder: a step on /dev/plan. The five fills first, then the marks.
 *
 * Fourteen states on eleven shapes. Which one a step is in is worked out in
 * lib/plan/tree.ts and is not its status column -- a question nobody has
 * answered is not "not started", "ready" is read off what the step waits on,
 * and the three readings of a claim are read off the run behind it rather than
 * off the column, which cannot tell a session that is pushing from one that
 * died an hour ago. Three of those readings share the three-quarter fill
 * because they are the same rung: the step is claimed, and the word and the
 * tone say what the session is doing, and a setup job shares the bar with a
 * blocked step for the same kind of reason -- both are stopped on you.
 * lib/plan/tree.ts carries the reason each of the fourteen is kept.
 */
const PLAN_STATES = [
  ['proposed', 'Proposed', 'Written by a session and waiting on you. The empty hexagon a lead is.'],
  ['not_started', 'Not started', 'You accepted it. Nobody has picked it up.'],
  ['ready', 'Ready', 'Nothing it waits on is still open, so it can be started now.'],
  ['in_progress', 'In progress', 'Claimed, and nothing has looked into what the session is doing.'],
  ['working', 'In progress', 'Claimed, and its run has pushed something recently.'],
  ['quiet', 'Quiet', 'Claimed, and its run has pushed nothing for twenty minutes.'],
  [
    'abandoned',
    'Stopped',
    'A session claimed it and its run ended without closing it. The cross, because it leaves the ladder.',
  ],
  ['done', 'Done', 'Built and verified. The row carries the commit that did it.'],
  [
    'unanswered',
    'Unanswered',
    'A question waiting on you. The one letterform in the set, because no fill said it.',
  ],
  ['answered', 'Answered', 'You answered it, and every step beneath is built against it.'],
  [
    'blocked',
    'Waiting on you',
    'Stopped on something only you can settle. Barred, like a closed role.',
  ],
  [
    'setup',
    'Setup',
    'A job that was always yours -- an account, a key. Barred like a blocked step, because it stops the same work.',
  ],
  ['waiting', 'Waiting', 'Waits on another step. Dashed, like an application nobody answered.'],
  ['dropped', 'Dropped', 'Decided against. The same shape as a withdrawal.'],
] as const satisfies readonly (readonly [PlanHealth, string, string])[];

/**
 * The four queues beside the plan, all on /dev.
 *
 * They are one section rather than four because the interesting thing about
 * them is where they agree: a note nobody has picked up and a confirmed finding
 * are both half filled, a question waiting on you is a question mark whether it
 * was raised by a session or filed by a pass, and everything nobody is doing is
 * struck through. Each queue keeps a shape of its own only where it knows
 * something the others do not.
 */
const DEV_QUEUE_STATES = [
  [
    'Bugs and requests',
    [
      [FEEDBACK_HEALTH_GLYPHS.ready, 'Ready', 'Filed, nobody on it. Half filled, like a ready step.'],
      [
        FEEDBACK_HEALTH_GLYPHS.planned,
        'Planned',
        'Written into the build plan and worked from there. Dashed, like a step waiting on another.',
      ],
      [FEEDBACK_HEALTH_GLYPHS.working, 'In progress', 'A run has claimed it.'],
      [
        FEEDBACK_HEALTH_GLYPHS.waiting,
        'Waiting on you',
        'Stopped on an answer only you have, and you have not given it.',
      ],
      [
        FEEDBACK_HEALTH_GLYPHS.answered,
        'Answered',
        'Blocked, and you replied in the thread. It is a session\u2019s again, and the column still says blocked.',
      ],
      [FEEDBACK_HEALTH_GLYPHS.done, 'Done', 'Fixed and committed.'],
      [FEEDBACK_HEALTH_GLYPHS.dropped, 'Dropped', 'You decided against it.'],
    ],
  ],
  [
    'Raised',
    [
      [
        RAISED_HEALTH_GLYPHS.waiting,
        'Waiting on you',
        'A session asked you something. The question mark, not the bar: a raise is a question.',
      ],
      [
        RAISED_HEALTH_GLYPHS.unfinished,
        'Nothing done',
        'Answered, with no action and no reason for none. Work a session still owes.',
      ],
      [RAISED_HEALTH_GLYPHS.answered, 'Answered', 'You replied and something came of it.'],
      [RAISED_HEALTH_GLYPHS.closed, 'Done', 'You read what came of it and filed the row.'],
      [RAISED_HEALTH_GLYPHS.dropped, 'Dropped', 'You turned it down.'],
    ],
  ],
  [
    'UI findings',
    [
      [FINDING_HEALTH_GLYPHS.waiting, 'Waiting on you', 'A pass proposed it. Confirm it or dismiss it.'],
      [FINDING_HEALTH_GLYPHS.ready, 'Confirmed', 'You agreed it is real, and nobody is on it yet.'],
      [FINDING_HEALTH_GLYPHS.dropped, 'Dropped', 'You looked and left it alone.'],
    ],
  ],
  [
    'Ideas',
    [
      [IDEA_HEALTH_GLYPHS.open, 'Not shaped', 'A sentence, and nothing has happened to it.'],
      [
        IDEA_HEALTH_GLYPHS.waiting,
        'Waiting on you',
        'A session shaped it into a proposal. Nothing happens until you approve it.',
      ],
      [IDEA_HEALTH_GLYPHS.shaped, 'Shaped', 'It is a feature being built on the plan page.'],
      [IDEA_HEALTH_GLYPHS.done, 'Done', 'The feature it became has shipped.'],
      [
        IDEA_HEALTH_GLYPHS.dropped,
        'Dismissed',
        'Put aside, and one press brings it back. The word is what keeps it apart from dropped.',
      ],
    ],
  ],
] as const satisfies readonly (readonly [
  string,
  readonly (readonly [GlyphName, string, string])[],
])[];

const TYPE_SCALE = [
  ['text-micro', '11px', 'Dense table cells, badges, keycaps. The floor.'],
  ['text-small', '12px', 'Labels, captions, hints, row metadata.'],
  ['text-ui', '13px', 'Interface chrome: buttons, controls, nav, rows.'],
  ['text-body', '14px', 'Prose, content, page descriptions, compose titles.'],
  ['text-title', '20px', 'A page or section heading. Display face, tracking-tight.'],
  ['text-figure', '32px', 'A number a card is about.'],
  ['text-figure-lg', '48px', 'The one figure a page is about, on a phone.'],
] as const;

const DENSITY_LABELS = ['Comfortable', 'Snug', 'Dense'] as const;
const DENSITY_IDS = ['comfortable', 'snug', 'dense'] as const;

/** The page in order, for the contents row. */
const CONTENTS: readonly (readonly [string, string])[] = [
  ['tension', 'The tension'],
  ['laws', 'The laws'],
  ['restraint', 'Restraint, worked'],
  ['shape', 'Shape, worked'],
  ['anatomy', 'Page anatomy'],
  ['before', 'Before you draw'],
  ['colour', 'Colour'],
  ['themes', 'Themes'],
  ['type', 'Type'],
  ['measurements', 'Measurements'],
  ['elevation', 'Elevation'],
  ['motion', 'Motion'],
  ['loops', 'The four loops'],
  ['wayfinding', 'Where am I'],
  ['latency', 'Latency'],
  ['undo', 'Undo'],
  ['bulk', 'Bulk'],
  ['keyboard', 'Keyboard'],
  ['search', 'Search'],
  ['save', 'The save model'],
  ['cross', 'Across workspaces'],
  ['speaks', 'Where it speaks'],
  ['ladder', 'Attention'],
  ['finding', 'Finding a row'],
  ['surfaces', 'Surfaces'],
  ['data', 'Numbers'],
  ['shell', 'The shell'],
  ['states', 'States'],
  ['first-run', 'First run'],
  ['touch', 'Touch'],
  ['alive', 'Alive'],
  ['a11y', 'Accessibility'],
  ['voice', 'Voice'],
  ['gate', 'The gate'],
  ['ship', 'Before you ship'],
  ['never', 'Never'],
];

/**
 * The specimens for the data display section.
 *
 * Sample values rather than real rows: a design page that queries the database
 * shows whatever this month happens to look like, and a month with one order
 * demonstrates nothing. The shapes are the ones the dashboard and the returns
 * tracker actually draw.
 */
const DEMO_MERCHANTS: readonly { name: string; cents: number; trend: number[] }[] = [
  { name: 'Amazon', cents: 184_300, trend: [40, 62, 51, 88, 74, 96, 120, 105, 143, 131, 168, 184] },
  { name: 'Uniqlo', cents: 42_000, trend: [0, 0, 0, 12, 8, 0, 0, 24, 18, 31, 26, 42] },
  { name: 'Etsy', cents: 8_600, trend: [6, 4, 9, 5, 7, 3, 8, 6, 4, 9, 7, 8] },
];

/** Whole dollars, the way the dashboard sets a figure. */
const dollars = (cents: number) => formatMoney(cents, 'USD', { showCents: false });

/** Thirty days, so the four fuses below are four lengths of the same window. */
const DEMO_WINDOW_DAYS = 30;

const DEMO_DAYS_LEFT: Record<HealthState, number> = {
  'on-track': 26,
  'at-risk': 12,
  closing: 4,
  overdue: -2,
};

/**
 * Read off the thresholds rather than typed out, so the page cannot describe
 * bands the code stopped using.
 */
const HEALTH_BANDS: Record<HealthState, string> = {
  'on-track': `More than ${DUE_SOON_DAYS} days left`,
  'at-risk': `${CLOSING_DAYS + 1} to ${DUE_SOON_DAYS} days left`,
  closing: `${CLOSING_DAYS} days left or fewer`,
  overdue: 'Past the deadline',
};

/**
 * One page arrangement, at both widths.
 *
 * The arrangement is an `<iframe>` of `/preview?s=<id>` rather than the
 * components rendered here, and that is the whole reason the drawing is worth
 * anything: rendered inline it would sit in this page's 768px column and
 * respond to the reader's window, so a phone arrangement would never be seen
 * on a phone. A frame has its own viewport, and `sm:` and `xl:` fire inside it
 * exactly as they do in the app.
 *
 * Both widths at once rather than a toggle, so the two can be compared without
 * pressing anything -- and so this page stays a server component.
 */
function AnatomyFrames({ id, label }: { id: string; label: string }) {
  return (
    // The laptop frame is 512px drawn and the page's column is narrower than
    // that on a phone, so the pair scrolls sideways in its own box rather than
    // taking the page with it. Wrapping instead would put a 512px figure in a
    // 358px column, which is the same overflow one line lower.
    <div className="overflow-x-auto">
      <div className="flex w-max items-start gap-3">
        {M.ANATOMY_FRAMES.map((frame) => (
          // The label above the frame, not under it: the two frames are
          // different heights, so captions beneath them would sit at two
          // different levels with nothing to line up against.
          <figure key={frame.id} className="space-y-1">
            <figcaption className="text-small text-ink-muted">{frame.label}</figcaption>
            <div
              className="overflow-hidden rounded-control bg-canvas"
              style={{ width: frame.width * frame.scale, height: frame.height * frame.scale }}
            >
              <iframe
                src={`/preview?s=${id}`}
                title={`${label} at ${frame.width}px`}
                loading="lazy"
                className="origin-top-left border-0"
                style={{
                  width: frame.width,
                  height: frame.height,
                  transform: `scale(${frame.scale})`,
                }}
              />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

export default function DevUiPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <PageHeader
        title="UI"
        description="The whole standard, rendered from the tokens it describes. Every swatch, control, size and number below is the real one — this page is a mirror, not a specification, and it is the only copy."
        actions={
          /* Where the standard gets held against the app, one module at a
             time. It is a different question from what the standard is, which
             is why it is a page rather than a section here. */
          <Link href="/dev/ui/review" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Review
          </Link>
        }
      />

      {/* Chrome for a long document: a row of names, muted until pointed at.
          Not a sidebar, because the page is read in one column on purpose. */}
      <nav aria-label="Contents" className="-mt-4 flex flex-wrap gap-x-3 gap-y-1">
        {CONTENTS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-ui text-ink-muted hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <Section id="tension" title="The tension, stated plainly">
        <Card padding="standard" className="space-y-3 text-body text-ink-muted">
          <p>
            Most tools you admire are precise but anonymous. They are built to look correct in a
            screenshot on someone else&rsquo;s laptop, so every decision trends toward the safe
            middle: one grey, one blue, one radius, no texture, no jokes, no risk. That discipline
            is why they feel good to use. It is also why they all feel the same.
          </p>
          <p>
            The old web had the opposite problem. Every page was personal but incoherent — your own
            colours, your own cursor, your own tiled background, and no craft holding it together.
          </p>
          <p className="text-ink">
            This app takes the craft from the first and the ownership from the second. Rigorous
            grid, rigorous contrast, rigorous motion — and then, inside that frame, real colour,
            real texture, and a handful of ideas a large product would never ship because they
            cannot be justified to a committee. This is one person&rsquo;s dashboard. It does not
            need to be justified to a committee.
          </p>
        </Card>
      </Section>

      <Section
        id="laws"
        title="The laws"
        lead="Sixteen, grouped by what they govern. Everything else on this page is one of these applied to a surface. The numbers are fixed for life: they are cited in code and in commits."
      >
        {/* One surface. The groups are told apart by a heading and air, and
         * the laws inside each by hairlines -- law 11 and law 13 applied to
         * the page that states them. It was five cards for a moment, and
         * the gate said so. */}
        <Card padding="none">
          <div className="divide-y divide-border">
            {LAW_GROUPS.map((group) => (
              <section key={group.title} className="pb-1 pt-3">
                <div className="card-pad-x mb-1">
                  <h3 className="text-small font-semibold text-ink-muted">{group.title}</h3>
                  <p className="text-small text-ink-muted">{group.lead}</p>
                </div>
                <ol className="divide-y divide-border">
                  {group.laws.map((law) => (
                    <li key={law.n} className="card-pad-x row-pad flex gap-3">
                      <span className="text-ui font-semibold tabular-nums text-accent">
                        {law.n}
                      </span>
                      <div className="min-w-0">
                        <p className="text-body font-medium text-ink">{law.title}</p>
                        <p className="mt-0.5 text-body text-ink-muted">{law.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </Card>
      </Section>

      <Section
        id="restraint"
        title="Restraint, worked"
        lead="Laws 9 to 12 are four views of one idea: the interface should get out from in front of the thing the person came for. Here they are on one surface, which is the only honest way to show them — each is easy to obey alone and they are only hard together."
      >
        {/*
         * This block used to be the thing it warns about: a card of labelled,
         * bordered, full-width fields in a two-column grid, demonstrating the
         * primitives one at a time. It read as a form because it was one. A
         * page arguing for restraint cannot be the loudest surface in the app.
         */}
        <Card padding="standard" className="space-y-3">
          <ComposeTitle
            defaultValue=""
            placeholder="What has to happen"
            aria-label="Demonstration title"
          />
          {/* ui-ok: composer-always-open -- the compose surface being
           * demonstrated. It is one line until typed into, which is the
           * shape law 14 asks for, and the rule cannot see the difference. */}
          <ComposeBody rows={1} placeholder="What it involves…" aria-label="Demonstration body" />
          <div className="flex flex-wrap items-center gap-1">
            <ChipSelect
              aria-label="Status"
              defaultValue="todo"
              icon={<Circle className="size-3.5" strokeWidth={M.ICON_STROKE} />}
            >
              <option value="todo">Not started</option>
              <option value="doing">In progress</option>
            </ChipSelect>
            <ChipSelect
              aria-label="Priority"
              defaultValue="2"
              icon={<Flag className="size-3.5" strokeWidth={M.ICON_STROKE} />}
            >
              <option value="1">Urgent</option>
              <option value="2">Normal</option>
            </ChipSelect>
            <ChipSelect
              aria-label="Size"
              defaultValue=""
              placeholderValue=""
              icon={<Scale className="size-3.5" strokeWidth={M.ICON_STROKE} />}
            >
              <option value="">Size</option>
              <option value="s">Small</option>
            </ChipSelect>
            <ChipSelect
              aria-label="Assignee"
              defaultValue=""
              placeholderValue=""
              icon={<CircleUser className="size-3.5" strokeWidth={M.ICON_STROKE} />}
            >
              <option value="">Nobody</option>
              <option value="me">Me</option>
            </ChipSelect>
          </div>
          <div className="flex items-center gap-1 border-t border-border pt-2">
            <span className="text-small text-ink-muted">
              One thing to type into, four properties carrying their own values, no label anywhere.
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
              <Button size="sm">Add</Button>
            </span>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Group title="9 — Density">
            <p className="text-body text-ink-muted">
              Every control above reads <code className="text-ui">--control-h</code> and the density
              dial in the top bar moves them together. Comfortable is the default; the dial only
              ever takes away. The numbers are under Measurements.
            </p>
          </Group>
          <Group title="10 — Disclosure">
            <p className="text-body text-ink-muted">
              Native <code className="text-ui">&lt;details&gt;</code>, so it folds before JavaScript
              loads. The closed line carries the fact that makes opening it a choice.
            </p>
            <Disclosure title="Retailers with a custom window" meta="11 · longest 90 days">
              <p className="text-body text-ink-muted">
                The indent is the grouping, in place of the border law 11 forbids.
              </p>
            </Disclosure>
          </Group>
          <Group title="11 — Group and ChipSelect">
            <p className="text-body text-ink-muted">
              These four notes are groups: told apart by headings and air, not by boxes inside this
              box. A chip is the same move on a control — the value is the label, so it is the width
              of a word instead of a row.
            </p>
          </Group>
          <Group title="12 — InlineInput">
            <div className="flex items-center gap-2">
              <span className="text-body text-ink">Return window</span>
              <InlineInput
                aria-label="Demonstration return window, in days"
                defaultValue="30"
                className="tabular w-14 text-right font-medium"
              />
              <span className="text-small text-ink-muted">days</span>
            </div>
            <p className="text-body text-ink-muted">
              Point at the number. It is an input, set exactly like the text it stands in for, so a
              page of these reads as values rather than as a form.
            </p>
          </Group>
        </div>
      </Section>

      <Section
        id="shape"
        title="Shape, worked"
        lead="Each pair is the same content twice: the shape to avoid, and the shape to build. Both halves are real components."
      >
        {/* The left column is not a straw man. It is built from the same Card
         * everything else uses, and it breaks no law above. That is why
         * check:ui cannot see this and a phone can. */}
        <Group title="13 — The same list, twice">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-small text-ink-muted">
                A card per row: own border, own margin, two lines, a tile sized to the box. About
                95px each. Nine fit a phone screen.
              </p>
              <div className="space-y-2">
                {/* ui-ok: card-per-row -- this is the demonstration. The card
                 * shape is the thing being argued against, and has to be
                 * drawn in order to be argued against. */}
                {SHAPE_DEMO.map((row) => (
                  <Card key={row.role} padding="dense" className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-control bg-shell text-micro text-ink-muted">
                      {row.mark}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui text-ink">{row.role}</span>
                      <span className="block truncate text-small text-ink-muted">
                        {row.company}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-micro text-ink-ghost">{row.age}</span>
                  </Card>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-small text-ink">
                A line per row: one surface, hairlines between, role and company on the same line.
                36px each. Twenty-five fit.
              </p>
              <ul className="divide-y divide-border">
                {SHAPE_DEMO.map((row) => (
                  <li key={row.role}>
                    <span
                      // ui-ok: fixed-control-height -- 36px is the subject of
                      // this demonstration, not a control being sized. Reading
                      // it from the density dial would hide the one number the
                      // law is about.
                      className="flex h-9 items-center gap-2 rounded-control px-2 hover:bg-shell-hover"
                    >
                      <span className="grid size-4 shrink-0 place-items-center text-micro text-ink-ghost">
                        {row.mark}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ui text-ink">
                        {row.role}
                        <span className="ml-2 text-ink-muted">{row.company}</span>
                      </span>
                      <span className="tabular shrink-0 text-micro text-ink-ghost">{row.age}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-body text-ink-muted">
            Nothing was removed but the container. The same four facts, in a third of the height.
            Multiply by every list in the app.
          </p>
        </Group>

        <Group title="14 — The same value, twice">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-small text-ink-muted">
                A caption, a box and a button, standing by in case today is the day this changes.
              </p>
              <Card padding="dense" className="space-y-1">
                <Label htmlFor="ui-demo-window">Return window</Label>
                <div className="flex items-center gap-2">
                  <Input id="ui-demo-window" defaultValue="30" className="w-full" />
                  <Button size="sm">Save</Button>
                </div>
              </Card>
            </div>
            <div className="space-y-2">
              <p className="text-small text-ink">
                It says thirty days, which is what someone came to find out. It is also an input, so
                changing it costs one click.
              </p>
              <Card padding="dense" className="flex items-center gap-2">
                <span className="text-body text-ink">Return window</span>
                <InlineInput
                  aria-label="Demonstration return window in days, read first"
                  defaultValue="30"
                  className="tabular w-12 text-right font-medium"
                />
                <span className="text-small text-ink-muted">days</span>
              </Card>
            </div>
          </div>
        </Group>

        <Group title="14 — The box nobody is typing in">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-small text-ink-muted">
                An empty composer, open on every visit. Not a value in an editor — an editor for
                nothing, holding the height of three lines of text that do not exist.
              </p>
              <Card padding="dense" className="space-y-2">
                <Label htmlFor="ui-demo-open">Add a note</Label>
                {/* ui-ok: composer-always-open -- this is the demonstration of
                 * the fault. Drawn on purpose so it can be argued against. */}
                <ComposeBody
                  id="ui-demo-open"
                  rows={3}
                  placeholder="Add a note…"
                  aria-label="Demonstration always-open composer"
                />
                <div className="flex justify-end">
                  <Button size="sm">Save</Button>
                </div>
              </Card>
            </div>
            <div className="space-y-2">
              <p className="text-small text-ink">
                One line, which becomes the composer when clicked. Costs a row instead of a card,
                and the Save arrives with the typing rather than waiting for it.
              </p>
              <Card padding="dense">
                <Button size="sm" variant="ghost">
                  + Add a note
                </Button>
              </Card>
            </div>
          </div>
        </Group>

        <Group title="15 — The same heading, twice">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-small text-ink-muted">
                A name and a sentence explaining the name. True, useful once, and then furniture on
                every visit for the rest of the app&rsquo;s life.
              </p>
              <Card padding="dense">
                <p className="text-ui font-semibold text-ink">Submitted</p>
                <p className="text-small text-ink-muted">Sent, and landed somewhere real.</p>
              </Card>
            </div>
            <div className="space-y-2">
              <p className="text-small text-ink">
                A name that carries itself, and a count, which is a fact rather than a gloss. The
                sentence moves to the empty state, where the person who has never seen this is
                actually standing.
              </p>
              <Card padding="dense">
                <p className="flex items-baseline gap-2 text-ui font-semibold text-ink">
                  Submitted
                  <span className="tabular text-small font-normal text-ink-ghost">14</span>
                </p>
              </Card>
            </div>
          </div>
        </Group>
      </Section>

      <Section
        id="anatomy"
        title="Page anatomy"
        lead="Where the parts of a whole page sit, and what moves when the window is a phone. Each one is a real arrangement in a frame of its own — 390 wide, then 1280 — rendered from the same components the pages use."
      >
        {ANATOMIES.map((anatomy) => (
          <Group
            key={anatomy.id}
            title={anatomy.label}
            action={
              <a
                href={`/preview?s=${anatomy.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-small text-ink-muted hover:text-accent"
              >
                Open alone
              </a>
            }
          >
            <p className="text-body text-ink-muted">{anatomy.note}</p>
            <AnatomyFrames id={anatomy.id} label={anatomy.label} />
          </Group>
        ))}
      </Section>

      <Section
        id="before"
        title="Before you draw a surface"
        lead="Answer these before writing markup. Each one is cheap now and expensive once the surface exists."
      >
        <Card padding="none">
          <ul className="divide-y divide-border">
            {BUILD_QUESTIONS.map(([question, answer]) => (
              <li key={question} className="card-pad-x row-pad">
                <p className="text-body font-medium text-ink">{question}</p>
                <p className="mt-0.5 text-body text-ink-muted">{answer}</p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section
        id="colour"
        title="Colour"
        lead="Colour is a claim. Three inks, four meanings, six workspaces and seven stages, and that is every hue the interface has. If you need one and none of these is true, use ink and a shape."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <CardSection title="Ink">
            <div className="space-y-3">
              {INK_ROLES.map(([swatch, name, note]) => (
                <Swatch key={swatch} swatch={swatch} name={name} note={note} />
              ))}
            </div>
          </CardSection>
          <CardSection title="Meanings">
            <div className="space-y-3">
              {MEANINGS.map(([swatch, name, note]) => (
                <Swatch key={swatch} swatch={swatch} name={name} note={note} />
              ))}
            </div>
          </CardSection>
          <CardSection
            title="Workspace accents"
            hint="One arc through blue, violet and pink, so six differently coloured rooms read as one house. Chrome takes the accent; content keeps its own meaning."
          >
            <div className="space-y-3">
              {MODULES.map((entry) => (
                <Swatch
                  key={entry.id}
                  swatch={WORKSPACE_HUES[entry.id]}
                  name={entry.label}
                  note={entry.description}
                />
              ))}
            </div>
          </CardSection>
          <CardSection
            title="Pipeline stages"
            hint="One hue per stage, the same in every theme and every workspace, and nowhere else in the app. The tint beside each is the ground it used to sit on; the glyph after it is what the row says with the colour taken away."
          >
            <div className="space-y-3">
              {PIPELINE.map(([hue, tint, status, name, note]) => (
                <div key={status} className="flex items-center gap-3">
                  <span aria-hidden className="flex shrink-0 overflow-hidden rounded-control">
                    <span className={cn('size-7', hue)} />
                    <span className={cn('size-7', tint)} />
                  </span>
                  {/* Plain ink, not the stage hue the badge draws it in. The
                      two swatches beside it are the colour; this column is the
                      shape, and withdrawn against lead is only readable when
                      the hue is not helping. */}
                  <StatusGlyph
                    glyph={APPLICATION_STATUS_GLYPHS[status]}
                    size={20}
                    className="text-ink"
                  />
                  <div className="min-w-0">
                    <p className="text-ui font-medium text-ink">{name}</p>
                    <p className="text-small text-ink-muted">{note}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardSection>
          <CardSection
            title="Task states"
            hint="The second ladder. A task is not a pipeline, so it takes three of the same shapes rather than a hue of its own."
          >
            <div className="space-y-3">
              {TASK_STATES.map(([status, name, note]) => (
                <div key={status} className="flex items-center gap-3">
                  <StatusGlyph glyph={TASK_STATUS_GLYPHS[status]} size={20} className="text-ink" />
                  <div className="min-w-0">
                    <p className="text-ui font-medium text-ink">{name}</p>
                    <p className="text-small text-ink-muted">{note}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardSection>
          <CardSection
            title="Plan states"
            hint="The third ladder, and the one that borrows most: five fills from a proposal to a finished step, and marks for the six states that are not on that ladder. Three readings of a claim share the three-quarter fill, because all three are a step somebody has in hand. The question mark is the only shape the plan brought with it."
          >
            <div className="space-y-3">
              {PLAN_STATES.map(([health, name, note]) => (
                <div key={health} className="flex items-center gap-3">
                  <StatusGlyph glyph={PLAN_HEALTH_GLYPHS[health]} size={20} className="text-ink" />
                  <div className="min-w-0">
                    <p className="text-ui font-medium text-ink">{name}</p>
                    <p className="text-small text-ink-muted">{note}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardSection>
          <CardSection
            title="The other dev queues"
            hint="Bugs, raises, findings and ideas drew their own pills until #503, and printed their status column until #504. Each reads what its row means now \u2014 a note you have replied to is not still waiting on you \u2014 and the shapes and the words are shared."
          >
            <div className="space-y-4">
              {DEV_QUEUE_STATES.map(([queue, states]) => (
                <div key={queue} className="space-y-3">
                  <p className="text-small font-semibold text-ink">{queue}</p>
                  {states.map(([glyph, name, note]) => (
                    <div key={`${queue}-${name}`} className="flex items-center gap-3">
                      <StatusGlyph glyph={glyph} size={20} className="text-ink" />
                      <div className="min-w-0">
                        <p className="text-ui font-medium text-ink">{name}</p>
                        <p className="text-small text-ink-muted">{note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CardSection>
        </div>
        <Card padding="standard" className="space-y-3 text-body text-ink-muted">
          <p>
            <span className="text-ink">A tint is a sheet.</span> An accent chip or a caution banner
            is an opaque ground the size of a sentence, and the text on it belongs to the chip, not
            to the page behind it — so every tint takes back the sheet&rsquo;s ink the way a card
            does. A fractional ground is not a sheet, it is a wash: on a dark bench it comes out
            dark and wants the ink of whatever it is washing over, which is what inheriting gives it
            for free.
          </p>
          <p>
            <span className="text-ink">Two borders, and the difference is legal.</span>{' '}
            <code className="text-ui">border</code> is the container hairline.{' '}
            <code className="text-ui">control</code> is the border of an input, a select or a
            checkbox — often the only thing identifying it as a control, which makes it a user
            interface component owing 3:1 that a hairline does not pay.
          </p>
          <p>
            <span className="text-ink">Every text and ground pair clears 4.5:1 in every theme</span>
            , and <code className="text-ui">scripts/check-contrast.ts</code> fails the build on
            anything under. Do not hand-tune a value without re-running it.
          </p>
        </Card>
      </Section>

      <Section
        id="themes"
        title="Themes"
        lead="Light or dark and any colour on the circle, so there is no list to print. The strip is the theme you are in, drawn with the tokens every other surface reads."
      >
        <Card padding="standard">
          <ActivePalette />
        </Card>
        <Rules items={C.THEME_RULES} />
      </Section>

      <Section
        id="type"
        title="Type"
        lead="Three families and a named scale. A size is chosen by role, never by how big it needs to look."
      >
        <Card padding="standard" className="space-y-2 text-body text-ink-muted">
          <p>
            <span className="text-ink">Inter does all the work.</span> Bricolage Grotesque is the
            voice: page titles, the one big figure, the workspace label, and nothing else. Use it
            big or not at all — at 13px a grotesque is a slightly odd Inter, and the difference is
            noise rather than voice. A mono for the status line, keycaps, and anything that is
            literally a machine talking. No serifs anywhere: this is an instrument panel, not a
            document.
          </p>
          <p>
            <span className="text-ink">Anything in a column of numbers is tabular.</span> Money,
            counts, dates, durations. A column of proportional digits that shifts as it updates is
            the cheapest way to make a dashboard feel unreliable.
          </p>
        </Card>
        <Card padding="none">
          <ul className="divide-y divide-border">
            {TYPE_SCALE.map(([cls, px, note]) => (
              <li
                key={cls}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 card-pad-x row-pad"
              >
                <span className={`${cls} min-w-40 text-ink`}>{cls}</span>
                <span className="text-small tabular-nums text-ink-ghost">{px}</span>
                <span className="text-small text-ink-muted">{note}</span>
              </li>
            ))}
            <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 card-pad-x row-pad">
              <span className="min-w-40 font-display text-title text-ink">text-figure-xl</span>
              <span className="text-small tabular-nums text-ink-ghost">72px</span>
              <span className="text-small text-ink-muted">
                The one figure a page is about. Nothing else is ever set this large.
              </span>
            </li>
          </ul>
        </Card>
      </Section>

      <Section
        id="measurements"
        title="Measurements"
        lead="The numbers, in pixels. Each is copied from globals.css and a test fails when the two disagree, which is what lets a page of typed numbers call itself a mirror."
      >
        <Group title="The density dial">
          <p className="text-small text-ink-muted">
            One attribute on the document, three values. Below is the same row at each density,
            rendered by the real attribute, so what the dial does is visible without turning it.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {/* ui-ok: card-per-row -- three densities compared side by side is
             * a fixed set of three, which is what cards are for; the Card
             * inside each is the same one-surface list at that density. */}
            {DENSITY_IDS.map((density, index) => (
              <div key={density} data-density={density} className="space-y-2">
                <p className="text-small font-medium text-ink-muted">
                  {DENSITY_LABELS[index]}{' '}
                  <span className="tabular font-normal text-ink-ghost">
                    {M.ROW_HEIGHT[index]}px row
                  </span>
                </p>
                <Card padding="none">
                  <ul className="divide-y divide-border">
                    {SHAPE_DEMO.slice(0, 2).map((row) => (
                      <li key={row.role} className="card-pad-x row-pad flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-ui text-ink">{row.role}</span>
                        <span className="tabular shrink-0 text-micro text-ink-ghost">
                          {row.age}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`A ${density} control`}
                    defaultValue="Control"
                    className="min-w-0"
                  />
                  <Button size="md">Save</Button>
                </div>
              </div>
            ))}
          </div>
          <Card padding="none">
            <ul className="divide-y divide-border">
              <li className="card-pad-x row-pad grid grid-cols-[1fr_repeat(3,3.5rem)] gap-x-2 text-micro font-semibold uppercase tracking-wider text-ink-muted">
                <span>Variable</span>
                {DENSITY_LABELS.map((label) => (
                  <span key={label} className="text-right">
                    {label.slice(0, 4)}
                  </span>
                ))}
              </li>
              {M.DIAL.map((row) => (
                <li
                  key={row.variable}
                  className="card-pad-x row-pad grid grid-cols-[1fr_repeat(3,3.5rem)] items-baseline gap-x-2"
                >
                  <span className="min-w-0">
                    <code className="text-ui text-ink">{row.variable}</code>
                    <span className="block text-small text-ink-muted">{row.what}</span>
                  </span>
                  {row.px.map((value, index) => (
                    <span key={index} className="tabular text-right text-ui text-ink">
                      {value}
                    </span>
                  ))}
                </li>
              ))}
              <li className="card-pad-x row-pad grid grid-cols-[1fr_repeat(3,3.5rem)] items-baseline gap-x-2">
                <span className="min-w-0">
                  <code className="text-ui text-ink">--control-h</code>
                  <span className="block text-small text-ink-muted">
                    Control height with a pointer, from 40rem up. A finger needs the bigger target
                    above; a mouse does not.
                  </span>
                </span>
                {M.CONTROL_H_POINTER.map((value, index) => (
                  <span key={index} className="tabular text-right text-ui text-ink">
                    {value}
                  </span>
                ))}
              </li>
              <li className="card-pad-x row-pad grid grid-cols-[1fr_repeat(3,3.5rem)] items-baseline gap-x-2">
                <span className="min-w-0">
                  <span className="text-ui text-ink">A list row</span>
                  <span className="block text-small text-ink-muted">
                    One line of text-ui plus the row padding. The same as a pointer control at every
                    density, so a row and a control on one surface agree.
                  </span>
                </span>
                {M.ROW_HEIGHT.map((value, index) => (
                  <span key={index} className="tabular text-right text-ui text-ink">
                    {value}
                  </span>
                ))}
              </li>
            </ul>
          </Card>
        </Group>

        <div className="grid gap-3 sm:grid-cols-2">
          <CardSection title="Radius">
            <ul className="space-y-2">
              {M.RADII.map((radius) => (
                <li key={radius.name} className="flex items-baseline gap-3">
                  <span className="tabular w-8 shrink-0 text-right text-ui text-ink">
                    {radius.px ? radius.px : '∞'}
                  </span>
                  <span className="min-w-0">
                    <code className="text-ui text-ink">{radius.name}</code>
                    <span className="block text-small text-ink-muted">{radius.where}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardSection>
          <CardSection
            title="Icons"
            hint={`Lucide, ${M.ICON_STROKE} stroke, currentColor, never filled.`}
          >
            <ul className="space-y-2">
              {M.ICONS.map((icon) => (
                <li key={icon.px} className="flex items-baseline gap-3">
                  <span className="tabular w-8 shrink-0 text-right text-ui text-ink">
                    {icon.px}
                  </span>
                  <span className="text-small text-ink-muted">{icon.where}</span>
                </li>
              ))}
            </ul>
          </CardSection>
        </div>

        <CardSection
          title="Space"
          hint="A 4px grid. The steps in use, and what each one is for — a gap not on this list is a decision, and says why."
        >
          <ul className="space-y-1.5">
            {M.SPACING.map((space) => (
              <li key={space.step} className="flex items-baseline gap-3">
                <span className="tabular w-8 shrink-0 text-right text-ui text-ink">{space.px}</span>
                <span className="text-small text-ink-muted">{space.where}</span>
              </li>
            ))}
          </ul>
        </CardSection>
        <Rules items={C.ICON_RULES} />
      </Section>

      <Section
        id="elevation"
        title="Elevation and layering"
        lead="Depth in three themes is a hairline. A shadow at rest belongs only to a layer that floats, and there are two of those. Above the layers, who paints over whom is a ladder with eight rungs; each is a named utility in globals.css, and a new z-index picks one by name."
      >
        <Rows rows={M.ELEVATION} labelWidth="sm:grid-cols-[7rem_1fr]" />
        <Card padding="none">
          <ul className="divide-y divide-border">
            {M.Z_LADDER.map((rung) => (
              <li key={rung.z} className="card-pad-x row-pad flex items-baseline gap-4">
                <span className="tabular w-10 shrink-0 text-right text-ui font-medium text-ink">
                  {rung.z}
                </span>
                <code className="w-28 shrink-0 text-small text-ink">{rung.utility}</code>
                <span className="text-body text-ink-muted">{rung.what}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="pt-2">
          <h3 className="text-ui font-semibold text-ink">Stacking contexts</h3>
          <p className="mt-1 max-w-2xl text-body text-ink-muted">
            The ladder above ranks eight rungs, which only holds where they are all in the same
            stacking context. The shell makes several, so some pairs of rungs never meet. This is
            every rung utility in app/ and components/ walked up its ancestors.
          </p>
        </div>
        <Rows rows={M.STACKING_CONTEXTS} labelWidth="sm:grid-cols-[13rem_1fr]" />
        <Rules items={M.STACKING_RULES} />
      </Section>

      <Section
        id="motion"
        title="Motion"
        lead="One duration, one easing, and every animation in the app in one table. All of it drops under prefers-reduced-motion."
      >
        <Card padding="standard" className="flex flex-wrap items-center gap-4">
          <Button>Press me</Button>
          <Card interactive padding="dense" className="text-ui text-ink-muted">
            Lift on hover
          </Card>
          <Skeleton className="h-4 w-32" />
          <span className="flex items-center gap-1 text-small text-ink-muted">
            hold <Kbd always>⌘</Kbd> for the hints
          </span>
        </Card>
        <Rows rows={M.MOTION} labelWidth="sm:grid-cols-[7rem_1fr]" />
        <Rules items={M.MOTION_RULES} />
      </Section>

      <Section id="loops" title="The four loops" lead={C.LOOPS_LEAD}>
        <Rows rows={C.LOOPS} labelWidth="sm:grid-cols-[6rem_1fr]" />
        <Rules items={C.LOOPS_RULES} />
      </Section>

      <Section id="wayfinding" title="Where am I, and how do I get back">
        <Rules items={C.WAYFINDING} />
      </Section>

      <Section id="latency" title="Latency: what is instant, what waits" lead={C.LATENCY_LEAD}>
        <Rows rows={C.LATENCY} labelWidth="sm:grid-cols-[7rem_1fr]" />
      </Section>

      <Section id="undo" title="Undo beats confirm" lead={C.UNDO_LEAD}>
        <Rows rows={C.UNDO} />
      </Section>

      <Section id="bulk" title="Bulk" lead={C.BULK_LEAD}>
        <Rules items={C.BULK} />
      </Section>

      <Section id="keyboard" title="The keyboard model" lead={C.KEYBOARD_LEAD}>
        <Card padding="none">
          <ul className="divide-y divide-border">
            {C.KEYBOARD.map(([key, means]) => (
              <li key={key} className="card-pad-x row-pad flex items-baseline gap-4">
                <span className="w-24 shrink-0">
                  <Kbd always>{key}</Kbd>
                </span>
                <span className="text-body text-ink">{means}</span>
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-small text-ink-muted">
          The model is the standard; which keys a given list answers to today is on the ideas page
          and the plan, not here.
        </p>
      </Section>

      <Section id="search" title="Search is one system">
        <Rules items={C.SEARCH} />
      </Section>

      <Section id="save" title="Forms: the save model">
        <Rules items={C.SAVE_MODEL} />
      </Section>

      <Section id="cross" title="Across workspaces" lead={C.CROSS_WORKSPACE_LEAD}>
        <Rules items={C.CROSS_WORKSPACE} />
      </Section>

      <Section
        id="speaks"
        title="The three places the app speaks"
        lead="Different surfaces answering different questions. Keeping them distinct is what stops any of them becoming noise."
      >
        <Rows rows={C.PLACES} />
        <Card padding="standard" className="text-body text-ink-muted">
          {C.TIME_AS_LENGTH}
        </Card>
      </Section>

      <Section id="ladder" title="The attention ladder" lead={C.LADDER_LEAD}>
        <Rows rows={C.LADDER} />
        <Rules items={C.NOTIFICATION_RULES} />
      </Section>

      <Section id="finding" title="Finding one row in five hundred">
        <Rules items={C.FINDING} />
        {/* The lists that actually answer the rule above, read off the
            declarations the pages pass to the shared display module rather
            than typed here a second time. */}
        <Group title="Lists with display options">
          <Rows rows={LISTS_WITH_DISPLAY.map(displaySummary)} labelWidth="sm:grid-cols-[9rem_1fr]" />
        </Group>
      </Section>

      <Section
        id="surfaces"
        title="Surfaces"
        lead="Pick the shape from the question the user is asking, and the width from how the page is read."
      >
        <Rows rows={C.SHAPES} labelWidth="sm:grid-cols-[6rem_1fr]" />
        <Rows rows={C.PAGE_WIDTHS} labelWidth="sm:grid-cols-[7rem_1fr]" />
        <Group title="Rows">
          <Rules items={C.ROW_RULES} />
        </Group>
        <Group title="Tables">
          <Rules items={C.TABLE_RULES} />
        </Group>
        <Group title="Filters">
          <Rules items={C.FILTER_RULES} />
        </Group>
        <Group title="Banners">
          <Rows rows={C.BANNER_TONES} labelWidth="sm:grid-cols-[4rem_1fr]" />
        </Group>
      </Section>

      <Section id="data" title="Numbers, and how they are drawn" lead={C.DATA_LEAD}>
        <Rows rows={C.DATA_DISPLAY} labelWidth="sm:grid-cols-[7rem_1fr]" />

        {/* On the page ground and not in a card, which is the Figure rule
            above. Putting the specimen in a card would be the page breaking
            its own law in the act of stating it. */}
        <Figure
          label="Spent this month"
          meta="1–30 Sept"
          value={dollars(184_300)}
          aside={<FigureDelta label="12% less" direction="down" suffix="than August" />}
          caption={`${dollars(196_300)} gross, less ${dollars(12_000)} refunded`}
          secondary={[
            { value: dollars(41_200), label: 'still returnable' },
            { value: '9', label: 'orders' },
          ]}
        />

        <Group title="A delta, both ways">
          <Card
            padding="standard"
            className="flex flex-wrap gap-x-8 gap-y-1 text-ui text-ink-muted"
          >
            <FigureDelta label="12% less" direction="down" suffix="than August" />
            <FigureDelta label="8% more" direction="up" suffix="than August" />
            <FigureDelta label={null} direction={null} />
          </Card>
        </Group>

        <Group title="A share, and whether it is new">
          <Card padding="standard">
            <ul className="space-y-3">
              {DEMO_MERCHANTS.map((merchant) => (
                <li key={merchant.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-ui">
                    <span className="font-medium text-ink">{merchant.name}</span>
                    <span className="ml-auto mr-1 self-center">
                      <Sparkline
                        values={merchant.trend}
                        label={`${merchant.name}: twelve months of spending`}
                      />
                    </span>
                    <span className="tabular text-ink">{dollars(merchant.cents)}</span>
                  </div>
                  <Meter
                    value={merchant.cents}
                    max={DEMO_MERCHANTS[0].cents}
                    label={`${merchant.name}: ${dollars(merchant.cents)} of ${dollars(DEMO_MERCHANTS[0].cents)}, the most spent at one merchant`}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </Group>

        <Group title="A window closing, in four states">
          <Card padding="none">
            <ul className="divide-y divide-border">
              {HEALTH_ORDER.map((state) => (
                <li
                  key={state}
                  className="card-pad-x row-pad grid gap-x-4 gap-y-1 sm:grid-cols-[7rem_9rem_1fr] sm:items-center"
                >
                  <p className="text-ui font-medium text-ink">{HEALTH_STATES[state].label}</p>
                  <ReturnFuse
                    daysLeft={DEMO_DAYS_LEFT[state]}
                    windowDays={DEMO_WINDOW_DAYS}
                    deadline="2026-10-01"
                  />
                  <p className="text-body text-ink-muted">{HEALTH_BANDS[state]}</p>
                </li>
              ))}
            </ul>
          </Card>
        </Group>

        <Card padding="standard" className="text-body text-ink-muted">
          {C.TIME_AS_LENGTH}
        </Card>
        <Rules items={C.DATA_RULES} />
      </Section>

      <Section id="shell" title="The shell">
        <Rules items={C.SHELL_RULES} />
      </Section>

      <Section id="states" title="States">
        <Rows rows={C.STATES} labelWidth="sm:grid-cols-[5rem_1fr]" />
      </Section>

      <Section id="first-run" title="First run">
        <Rules items={C.FIRST_RUN} />
      </Section>

      <Section id="touch" title="Touch">
        <Rules items={C.TOUCH} />
      </Section>

      <Section id="alive" title="Alive" lead={C.ALIVE_LEAD}>
        <Rows rows={C.ALIVE} />
      </Section>

      <Section id="a11y" title="Accessibility contract">
        <Rules items={C.A11Y} />
      </Section>

      <Section id="voice" title="Voice" lead={C.VOICE_LEAD}>
        <div className="grid gap-3 sm:grid-cols-2">
          <CardSection title="Do">
            <ul className="space-y-2">
              {C.VOICE_DO.map((line) => (
                <li key={line} className="text-body text-ink">
                  &ldquo;{line}&rdquo;
                </li>
              ))}
            </ul>
          </CardSection>
          <CardSection title="Don’t">
            <ul className="space-y-2">
              {C.VOICE_DONT.map((line) => (
                <li
                  key={line}
                  className="text-body text-ink-muted line-through decoration-danger/60"
                >
                  &ldquo;{line}&rdquo;
                </li>
              ))}
            </ul>
          </CardSection>
        </div>
        <Rules items={C.VOICE} />
      </Section>

      <Section
        id="gate"
        title="The gate"
        lead="The mechanical half of these laws runs on every push. It does not ask nicely."
      >
        <Card padding="standard" className="space-y-2 text-body text-ink-muted">
          <p>
            <code className="text-ui text-ink">npm run check:ui</code> counts violations per file
            per rule against a recorded baseline. A count going up fails; a new file has no baseline
            entry, so new code is held to zero from its first line. A count going down asks to be
            locked in, which is how the number only ever moves one way.
          </p>
          <p>
            Six rules, all of them things a grep can settle: a hand-rolled box, a control height
            written as a number, a scoped token read through <code className="text-ui">var()</code>,
            a raw hex, a font size off the scale, a card drawn per row. Contrast is a second gate in{' '}
            <code className="text-ui">scripts/check-contrast.ts</code>, and the numbers on this page
            are a third, in the test suite. Everything else here is the residue a person has to read
            — <code className="text-ui">--list</code> shows where the machine thinks the mess is,
            and that is where to start looking.
          </p>
          <p>
            If a violation is genuinely right, say so where it is:{' '}
            <code className="text-ui text-ink">{'/* ui-ok: why */'}</code> on the line, or{' '}
            <code className="text-ui text-ink">ui-ok-file: rule-id</code> for a whole block. A rule
            with no way out gets worked around, and a worked-around rule also lies.
          </p>
        </Card>
      </Section>

      <Section
        id="ship"
        title="Before you ship a surface"
        lead="The checklist. Every line is a law or a rule above, applied; if one cannot be ticked, the surface is not done."
      >
        <Card padding="none">
          <ol className="divide-y divide-border">
            {C.CHECKLIST.map((line, index) => (
              <li key={line} className="card-pad-x row-pad flex gap-3">
                <span className="tabular w-5 shrink-0 text-right text-ui text-ink-ghost">
                  {index + 1}
                </span>
                <span className="text-body text-ink">{line}</span>
              </li>
            ))}
          </ol>
        </Card>
      </Section>

      <Section
        id="never"
        title="Never"
        lead="Only the nevers that are not already a law. Each was a real bug once."
      >
        <Card padding="standard">
          <ul className="space-y-1.5 text-body text-ink-muted">
            {C.NEVER.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-danger">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-small text-ink-muted">
          Something wrong with a surface? Say so on{' '}
          <Link href="/dev/surfaces" className="text-accent hover:underline">
            Surfaces
          </Link>
          , where every one is rendered at the width it is read at.
        </p>
      </Section>
    </div>
  );
}
