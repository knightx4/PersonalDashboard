/**
 * The rules plan #2966.1 added to scripts/check-ui.ts, for the laws the design
 * critic cited most often in its fixes (laws 15, 18, 14, 1 and 16). Each gets
 * a line it must report and a line it must leave alone, so a rule cannot
 * quietly stop firing or start reporting correct code.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { scanSource } from '@/scripts/check-ui';
import { SectionHeading, SectionLabel } from '@/components/ui/section-heading';
import { CardSection } from '@/components/ui/card';

/** The rule ids `scanSource` reports for a snippet of a component file. */
function rulesFor(source: string, file = 'app/example/view.tsx'): string[] {
  return scanSource(file, source).map((hit) => hit.rule.id);
}

describe('law 15: a heading is not explained underneath', () => {
  it('reports a CardSection hint, wherever in the tag it is passed', () => {
    const source = ['<CardSection', '  title="Sources"', '  hint="Where orders are read from."', '>', '  {rows}', '</CardSection>'].join('\n');
    expect(rulesFor(source)).toContain('heading-hint');
    expect(rulesFor('<CardSection title="Sources">{rows}</CardSection>')).not.toContain('heading-hint');
  });

  it('reports a muted sentence directly under a heading', () => {
    const source = [
      '<SectionHeading title="Where you are now" />',
      '<p className="text-small text-ink-muted">The places you have studied, and how well you know each one.</p>',
    ].join('\n');
    expect(rulesFor(source)).toContain('heading-explained');
  });

  it('leaves a subline of values, a failure said in place, and a plain paragraph', () => {
    const subline = ['<h2 className="text-ui">{video.title}</h2>', '<p className="text-small text-ink-muted">{meta.join(" · ")}</p>'];
    const failure = ['<h2 className="text-ui">Metrics</h2>', '<p role="alert" className="text-small text-ink-muted">Your metrics could not be read just now.</p>'];
    const content = ['<h2 className="text-ui">Summary</h2>', '<p className="text-body text-ink">The interview went well and they asked about pricing.</p>'];
    for (const lines of [subline, failure, content]) expect(rulesFor(lines.join('\n'))).not.toContain('heading-explained');
  });

  it('reports a caption that says what the control under it says', () => {
    const button = ['<p className="text-small">Choose files</p>', '<Button type="button">Choose files</Button>'].join('\n');
    const search = ['<span>Find a note by name.</span>', '<Input placeholder="Find a note by name" />'].join('\n');
    expect(rulesFor(button)).toContain('caption-repeats-control');
    expect(rulesFor(search)).toContain('caption-repeats-control');
    expect(rulesFor('<Field label="Name" placeholder="Name" />')).toContain('caption-repeats-control');
    const different = ['<p className="text-small">Attach the slides</p>', '<Button type="button">Choose files</Button>'].join('\n');
    expect(rulesFor(different)).not.toContain('caption-repeats-control');
  });
});

describe('law 18: text sits on the left edge', () => {
  it('reports a centred paragraph or heading and leaves a centred mark', () => {
    expect(rulesFor('<p className="mt-2 text-center text-body">Pick up where you left off.</p>')).toContain('centred-reading-text');
    expect(rulesFor('<h2 className="text-center text-title">Welcome</h2>')).toContain('centred-reading-text');
    expect(rulesFor('<div className="flex justify-center text-center"><DashMark size="lg" /></div>')).not.toContain(
      'centred-reading-text',
    );
  });
});

describe('law 14: a compose box is a button until pressed', () => {
  it('reports a raw textarea standing open beside a list, and not one behind a condition', () => {
    const open = ['function Notes() {', '  return (', '    <div>', '      {notes.map((n) => <p key={n.id}>{n.body}</p>)}', '      <textarea name="body" />', '    </div>', '  );', '}'];
    const gated = [...open.slice(0, 4), '      {adding && (', '        <textarea name="body" />', '      )}', ...open.slice(5)];
    expect(rulesFor(open.join('\n'))).toContain('composer-always-open');
    expect(rulesFor(gated.join('\n'))).not.toContain('composer-always-open');
  });
});

describe('law 1: an empty section is not drawn', () => {
  it('reports a section left saying it is empty, as text or as its empty prop', () => {
    expect(rulesFor('<p className="text-ui text-ink-muted">Nothing logged yet.</p>')).toContain('empty-section-line');
    expect(rulesFor('<NoteList notes={notes} empty="Nothing prepped yet." />')).toContain('empty-section-line');
  });

  it('leaves the empty state of a wholly empty page, and a sentence that is not an empty line', () => {
    expect(rulesFor('<EmptyState title="Nothing saved yet" />')).not.toContain('empty-section-line');
    expect(rulesFor('<p className="text-ui">No reply came, so Dash wrote again on Monday.</p>')).not.toContain(
      'empty-section-line',
    );
  });

  it('hides a zero count beside a heading, so the shared heading cannot show one', () => {
    expect(renderToStaticMarkup(<SectionHeading title="Stages" count={0} />)).not.toContain('>0<');
    expect(renderToStaticMarkup(<SectionHeading title="Stages" count={3} />)).toContain('>3<');
    expect(renderToStaticMarkup(<SectionLabel count="0">Waiting</SectionLabel>)).not.toContain('>0<');
    const folded = renderToStaticMarkup(
      <CardSection title="Files" meta={0} fold="files">
        <p>rows</p>
      </CardSection>,
    );
    expect(folded).not.toContain('>0<');
  });
});

describe('law 16: a press that costs money says so', () => {
  it('reports a DashAction with no price and a Dash mark inside a hand-built button', () => {
    expect(rulesFor('<DashAction type="submit">Start this errand</DashAction>')).toContain('dash-press-unpriced');
    const byHand = ['<Button type="submit" size="sm">', '  <DashMark size="2xs" decorative />', '  Ask', '</Button>'].join('\n');
    expect(rulesFor(byHand)).toContain('dash-press-unpriced');
  });

  it('leaves a DashAction priced any of the four ways, or through a spread', () => {
    for (const price of ['paid="summarise"', 'estimate={estimate}', 'costText="$0.01 a post"', 'routine="goals"', '{...press}']) {
      expect(rulesFor(`<DashAction\n  type="submit"\n  ${price}\n>\n  Summarise\n</DashAction>`)).not.toContain(
        'dash-press-unpriced',
      );
    }
  });
});

describe('the valve', () => {
  it('excuses a line that says why it is right', () => {
    expect(rulesFor('<p className="text-center text-body">Signed out.</p> {/* ui-ok: the sign-in card is a mark */}')).toEqual([]);
  });
});
