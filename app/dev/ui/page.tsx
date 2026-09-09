import { PageHeader } from '@/components/shell/page-header';
import { Circle, CircleUser, Flag, Scale } from 'lucide-react';
import { Card, CardSection } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ChipSelect,
  ComposeBody,
  ComposeTitle,
  InlineInput,
  Input,
  Label,
} from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { Disclosure, Group } from '@/components/ui/disclosure';
import { LAWS, RESTRAINT_LAWS, SHAPE_LAWS } from './laws';

export const metadata = { title: 'UI' };

/**
 * The standard the interface is held to.
 *
 * This was a static HTML file in docs/, which is the wrong place for it in
 * exactly one way that matters: a document describing an interface is a
 * *second* copy of that interface, and the copy is wrong within a month. Here
 * the swatches are the real tokens, the controls are the real components and
 * the type scale is the real scale, so the page cannot describe an app that
 * does not exist. If a row below looks wrong, the app is wrong.
 *
 * It also means the standard is readable in the place the work happens,
 * beside the plan and the bug queue, rather than in a file somebody has to
 * remember to open.
 */

/** A named row of the page. Plain <section>s, so the whole page is skimmable. */
function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-title text-ink">{title}</h2>
        {lead ? <p className="mt-1 max-w-2xl text-body text-ink-muted">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Every colour below is a utility class, never `style={{ background:
 * 'var(--color-x)' }}`.
 *
 * That distinction is not cosmetic and it is worth knowing before you write
 * the next swatch. The scoped tokens -- accent above all -- are undefined at
 * :root and are given a value further down the tree, by <body>, by
 * [data-workspace], and again by any element painting a sheet. A custom
 * property *inherits its computed value*, so `var(--color-accent)` read at
 * :root computes to nothing and every descendant inherits that nothing, no
 * matter what the scope around them says. The utility resolves at the element
 * instead, which is the whole point of the scope system.
 */
/**
 * Three rows, rendered twice in "Shape, worked". Invented rather than fetched:
 * this page mirrors the design language, not the database, and an argument
 * about row height should not need a session to make it.
 */
const SHAPE_DEMO = [
  { mark: 'FG', role: 'Staff Engineer', company: 'Fieldgate', age: '2d' },
  { mark: 'NR', role: 'Platform Lead', company: 'Northrend Labs', age: '9d' },
  {
    mark: 'AC',
    role: 'Senior Backend Engineer',
    company: 'Ascent',
    age: '21d',
  },
] as const;

/**
 * Questions rather than rules, because a rule is obeyed by whoever already
 * agrees with it. A question has to be answered by whoever builds the thing,
 * and a wrong answer shows up in the answer rather than in a screenshot three
 * weeks later.
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
    'Which of these can the machine check?',
    'Boxes, control heights, hexes, font sizes and scoped tokens — check:ui settles those and holds new files to zero from their first line. Everything on this page that a grep cannot see is the part a person has to look at, at 390px, which is what /dev/surfaces is for.',
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

const TYPE_SCALE = [
  ['text-micro', '11px', 'Dense table cells. The floor.'],
  ['text-small', '12px', 'Labels, captions, hints.'],
  ['text-ui', '13px', 'Interface chrome: buttons, controls, nav.'],
  ['text-body', '14px', 'Prose and content.'],
  ['text-lead', '15px', 'A page description.'],
  ['text-title', '20px', 'A page or section heading.'],
  ['text-figure', '32px', 'A number the page is about.'],
] as const;

function Swatch({ swatch, name, note }: { swatch: string; name: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      {/* No hairline. A swatch is a solid mid-tone square on a card, and every
          token below -- ghost included -- has an edge against the surface
          without one being drawn. The border was the page that documents law
          11 breaking it. */}
      <span aria-hidden className={cn('size-7 shrink-0 rounded-control', swatch)} />
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink">{name}</p>
        <p className="text-small text-ink-muted">{note}</p>
      </div>
    </div>
  );
}

export default function DevUiPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <PageHeader
        title="UI"
        description="The design language, rendered from the tokens it describes. Every swatch, control and size below is the real one — this page is a mirror, not a specification."
      />

      <Section title="The tension, stated plainly">
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
        title="The laws"
        lead="Everything else on this page is one of these applied to a surface. One to eight are what the interface may claim. Nine to twelve are how much of itself it shows while claiming it. Thirteen to fifteen are the shape of the page, and exist because a sweep satisfied the first twelve and the screens were unchanged."
      >
        {/* One surface with hairlines, not fifteen cards. It was fifteen cards
          * until check:ui grew the law 13 rule and reported this page -- a
          * scrolled list of cards inside the document arguing against scrolled
          * lists of cards. */}
        <Card padding="none">
          <ol className="divide-y divide-border">
            {[...LAWS, ...RESTRAINT_LAWS, ...SHAPE_LAWS].map((law) => (
              <li key={law.n} className="card-pad-x row-pad flex gap-3">
                <span className="text-ui font-semibold tabular-nums text-accent">{law.n}</span>
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">{law.title}</p>
                  <p className="mt-0.5 text-body text-ink-muted">{law.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </Section>

      <Section
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
          <ComposeBody rows={1} placeholder="What it involves…" aria-label="Demonstration body" />
          <div className="flex flex-wrap items-center gap-1">
            <ChipSelect
              aria-label="Status"
              defaultValue="todo"
              icon={<Circle className="size-3.5" strokeWidth={2} />}
            >
              <option value="todo">Not started</option>
              <option value="doing">In progress</option>
            </ChipSelect>
            <ChipSelect
              aria-label="Priority"
              defaultValue="2"
              icon={<Flag className="size-3.5" strokeWidth={2} />}
            >
              <option value="1">Urgent</option>
              <option value="2">Normal</option>
            </ChipSelect>
            <ChipSelect
              aria-label="Size"
              defaultValue=""
              placeholderValue=""
              icon={<Scale className="size-3.5" strokeWidth={2} />}
            >
              <option value="">Size</option>
              <option value="s">Small</option>
            </ChipSelect>
            <ChipSelect
              aria-label="Assignee"
              defaultValue=""
              placeholderValue=""
              icon={<CircleUser className="size-3.5" strokeWidth={2} />}
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
              dial in the top bar moves them together. Comfortable is the default and is what snug
              used to be; the dial only ever takes away.
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
              of a word instead of a row. Ninety-one places in the app still draw the second box.
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
        title="Shape, worked"
        lead="Each pair is the same content twice: what the app does now, and what it should do. Both halves are real components."
      >
        {/* The left column is not a straw man. It is what the app ships, built
         * from the same Card everything else uses, and it breaks no law above.
         * That is why check:ui cannot see this and a phone can. */}
        <Group title="13 — The same list, twice">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-small text-ink-muted">
                A card per row: own border, own margin, two lines, a tile sized to the box.
                About 95px each. Nine fit a phone screen.
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
                A line per row: one surface, hairlines between, role and company on the same
                line. 36px each. Twenty-five fit.
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
                A caption, a box and a button, standing by in case today is the day this
                changes.
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
                It says thirty days, which is what someone came to find out. It is also an
                input, so changing it costs one click.
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
          <p className="text-body text-ink-muted">
            46 textareas and 45 selects are written into markup across the app, most on screens
            someone came to read. Counts rot, so re-measure rather than trust this line:{' '}
            <code className="text-ui">
              grep -rn &quot;&lt;Textarea|&lt;ComposeBody&quot; --include=*.tsx app components
            </code>
            .
          </p>
        </Group>

        <Group title="14 — The box nobody is typing in">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-small text-ink-muted">
                An empty composer, open on every visit. Not a value in an editor — an editor for
                nothing, holding the height of three lines of text that do not exist. This is the
                single biggest source of form-feel in the app.
              </p>
              <Card padding="dense" className="space-y-2">
                <Label htmlFor="ui-demo-open">Add a note</Label>
                <ComposeBody id="ui-demo-open" rows={3} placeholder="Add a note…" aria-label="Demonstration always-open composer" />
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
        title="Colour"
        lead="Colour is a claim. If you need one and none of these meanings is true, use ink and a shape."
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
        </div>
      </Section>

      <Section
        title="Type"
        lead="Seven sizes, named for what they are for. A size is chosen by role, never by how big it needs to look."
      >
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
          </ul>
        </Card>
      </Section>

      <Section
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
            Five rules, all of them things a grep can settle: a hand-rolled box, a control height
            written as a number, a scoped token read through <code className="text-ui">var()</code>,
            a raw hex, a font size off the scale. Everything else on this page is the residue a
            person has to read — <code className="text-ui">--list</code> shows where the machine
            thinks the mess is, and that is where to start looking.
          </p>
          <p>
            If a violation is genuinely right, say so where it is:{' '}
            <code className="text-ui text-ink">{'/* ui-ok: why */'}</code> on the line, or{' '}
            <code className="text-ui text-ink">ui-ok-file: rule-id</code> for a whole block. A rule
            with no way out gets worked around, and a worked-around rule also lies.
          </p>
        </Card>
      </Section>

      <Section title="Never">
        <Card padding="standard">
          <ul className="space-y-1.5 text-body text-ink-muted">
            {[
              'Render an empty section, a zero, or a skeleton of nothing.',
              'Show a short list where a source failed, without saying it failed.',
              'Invent precision the data does not have.',
              'Use a semantic colour for a meaning it does not carry.',
              'Put view state in component state instead of the URL.',
              'Write a hex, a font size, or a control height that is not a token.',
              'Read a scoped token through var(--color-…) in an inline style or an arbitrary value. Use the utility.',
              'Spend a label, a border and a heading on a field that needs a placeholder.',
              'Draw a box inside a box. Give the inner group a heading and space instead.',
              'Open a panel to edit one value that could be edited where it is read.',
              'Fold a section behind a line that does not say what is inside it.',
              'Draw a card per row in a list that is scrolled. One surface, hairlines, one line each.',
              'Give an item a second line without arguing for it — it halves what fits on a phone.',
              'Render a surface in edit mode when almost everyone arriving is reading.',
              'Explain a heading in a sentence under it on every viewing. Name it right; teach in the empty state.',
              'Print a caption above a box whose placeholder already says the same words.',
              'Delay the user to be charming.',
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-danger">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </div>
  );
}
