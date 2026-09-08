import { PageHeader } from '@/components/shell/page-header';
import { Card, CardSection } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { Banner } from '@/components/ui/banner';
import { cn } from '@/lib/cn';
import { DENSITY_LAW, LAWS } from './laws';

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
      <span aria-hidden className={cn('size-7 shrink-0 rounded-control border border-border', swatch)} />
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
        lead="The product's character, not style preferences. Everything else on this page is one of these applied to a surface."
      >
        <ol className="space-y-2">
          {[...LAWS, DENSITY_LAW].map((law) => (
            <li key={law.n}>
              <Card padding="dense" className="flex gap-3">
                <span className="text-ui font-semibold tabular-nums text-accent">{law.n}</span>
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">{law.title}</p>
                  <p className="mt-0.5 text-body text-ink-muted">{law.body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="Density"
        lead="Law 9 is the one most recently broken, so it gets the worked example. Chrome is overhead paid so content can be read. These are the sizes that make the ratio come out right."
      >
        <Card padding="standard" className="space-y-4">
          <div className="grid gap-(--field-gap) sm:grid-cols-2">
            <div>
              <Label htmlFor="ui-demo-title">A label is a caption</Label>
              <Input id="ui-demo-title" placeholder="Quieter than the value it names" readOnly />
            </div>
            <div>
              <Label htmlFor="ui-demo-select">Controls share one height</Label>
              <Select id="ui-demo-select" defaultValue="a">
                <option value="a">All of them read --control-h</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="ui-demo-note">A text box starts at what it holds</Label>
            <Textarea
              id="ui-demo-note"
              placeholder="Type into this. It grows; it does not start ninety-six pixels tall."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="md">Primary</Button>
            <Button size="md" variant="secondary">
              Secondary
            </Button>
            <Button size="md" variant="ghost">
              Ghost
            </Button>
            <p className="text-small text-ink-muted">
              A medium button is exactly as tall as the input beside it, at every density.
            </p>
          </div>
        </Card>
        <Banner tone="info">
          The density dial in the top bar moves all of this together. Comfortable is the default and
          is what snug used to be; the dial only ever takes away.
        </Banner>
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
              <li key={cls} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 card-pad-x row-pad">
                <span className={`${cls} min-w-40 text-ink`}>{cls}</span>
                <span className="text-small tabular-nums text-ink-ghost">{px}</span>
                <span className="text-small text-ink-muted">{note}</span>
              </li>
            ))}
          </ul>
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
