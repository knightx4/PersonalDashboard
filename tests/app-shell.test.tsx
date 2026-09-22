/**
 * The shell's bottom bar, on a phone.
 *
 * One rule, and it is the one that broke: the bar is hung on the switcher, not
 * on the sections. Home and the account page have no sections -- they are not
 * workspaces -- and while the bar waited for one, those were the two pages with
 * no bottom navigation at all, which are also the two where you are most likely
 * to be going somewhere else.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NavSection } from '@/components/shell/app-shell';
import type { ModuleId } from '@/lib/modules';
import { SYSTEM_THEME } from '@/lib/theme';

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { AppShell } = await import('@/components/shell/app-shell');

function render(sections: NavSection[], settingsHref?: string) {
  return renderToStaticMarkup(
    <AppShell
      account="11111111-1111-4111-8111-111111111111"
      module={null}
      sections={sections}
      settingsHref={settingsHref}
      displayName="Sam"
      email="sam@example.com"
      theme={SYSTEM_THEME}
    >
      <p>The page</p>
    </AppShell>,
  );
}

/** The bar itself, told from the sidebar above it by where it is pinned. */
function bar(html: string): string {
  const at = html.indexOf('fixed inset-x-0 bottom-0');
  expect(at).toBeGreaterThan(-1);
  // From the opening tag, not from the class: the label is an attribute before
  // it, and slicing at the class would cut off the thing being asserted.
  return html.slice(html.lastIndexOf('<nav', at));
}

describe('the bottom bar', () => {
  it('carries the switcher on a page with no sections at all', () => {
    const html = render([]);
    expect(bar(html)).toContain('>Switch<');
    // And the landmark is named for what is in it, not for what is not: the
    // sidebar's own list of sections is the one called "Sections".
    expect(bar(html)).toContain('aria-label="Workspace"');
    expect(bar(html)).not.toContain('aria-label="Sections"');
  });

  it("keeps the switcher in the middle of a workspace's sections", () => {
    const html = render(
      [
        { href: '/todo', label: 'Agenda', exact: true },
        { href: '/todo/calendar', label: 'Calendar' },
        { href: '/todo/all', label: 'All' },
      ],
      '/todo/settings',
    );
    // Two sections, the switcher, then the rest -- dead centre of the five
    // slots once More is counted.
    const order = [...bar(html).matchAll(/>(Agenda|Calendar|All|Switch|More)</g)].map((m) => m[1]);
    expect(order).toEqual(['Agenda', 'Calendar', 'Switch', 'All', 'More']);
  });

  it('leaves room under the page for it, whether or not there are sections', () => {
    expect(render([])).toContain('pb-24');
    expect(render([{ href: '/todo', label: 'Agenda' }])).toContain('pb-24');
  });
});

/**
 * The way into capture.
 *
 * One of them, in the header beside the theme picker, at every width. There
 * was a second below `sm` -- an accent circle floating over the foot of every
 * page -- and it read as the app insisting rather than offering, so it went.
 * Nothing is pinned over the page now, and the header control is no longer
 * hidden on a phone.
 */
describe('capture', () => {
  it('offers a way in from the header, with its shortcut on it', () => {
    const html = render([]);
    expect(html).toContain('title="Capture something (⌥C)"');
    expect(html).toContain('>⌥C<');
  });

  it('pins nothing over the page', () => {
    expect(render([])).not.toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom))]');
  });

  it('is present on a page with no workspace at all', () => {
    // The panel mounts with the shell, not with a module, so "from anywhere"
    // includes home and the account page.
    expect(render([]).match(/>Capture something</g)?.length).toBe(1);
  });
});

/**
 * The workspace summary.
 *
 * It used to be drawn in the middle of the top bar from sm up, and on its own
 * line under the bar below sm. From lg up it now reads on the status line at
 * the foot of the page instead, which leaves the middle of the bar for the
 * search bar. Below lg nothing about it changed.
 */
describe('the workspace summary', () => {
  const brief = { text: 'Two things overdue', href: '/todo', tone: 'caution' as const };

  function withBrief(over: Partial<typeof brief> = {}) {
    return renderToStaticMarkup(
      <AppShell
        account="11111111-1111-4111-8111-111111111111"
        module="todo"
        sections={[]}
        displayName="Sam"
        email="sam@example.com"
        theme={SYSTEM_THEME}
        brief={{ ...brief, ...over }}
      >
        <p>The page</p>
      </AppShell>,
    );
  }

  /** The top bar, from its own tag to its close. */
  function header(html: string): string {
    const at = html.indexOf('<header');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</header>', at));
  }

  /** The status line: the strip pinned to the foot, up to the tab bar below it. */
  function foot(html: string): string {
    const at = html.indexOf('z-status');
    expect(at).toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf('<div', at), html.indexOf('<nav', at));
  }

  it('reads at the foot of the page', () => {
    expect(foot(withBrief())).toContain('Two things overdue');
  });

  it('leaves the middle of the top bar from lg up', () => {
    // The copy in the bar is still there for a tablet; lg is where it stops.
    const middle = header(withBrief());
    expect(middle).toContain('Two things overdue');
    expect(middle).toContain('sm:flex lg:hidden');
  });

  it('keeps its own line under the bar below sm', () => {
    expect(withBrief()).toContain('bg-page px-4 py-1.5 text-center text-small sm:hidden');
  });

  /** The summary's own tag on the status line, when it has one. */
  function summaryLink(html: string): string {
    const line = foot(html);
    const at = line.indexOf('<a ');
    if (at === -1) return '';
    return line.slice(at, line.indexOf('>', at));
  }

  it('can still be clicked when it links somewhere', () => {
    // The line as a whole takes no clicks, so a summary that links has to say
    // so for itself.
    const link = summaryLink(withBrief());
    expect(link).toContain('href="/todo"');
    expect(link).toContain('pointer-events-auto');
  });

  it('draws the line with nothing else on it', () => {
    // No activity, no CI reading: the summary alone is reason enough for the
    // line to exist.
    const html = withBrief();
    expect(html).toContain('z-status');
    // And the activity icon stays with the activity notes rather than sitting
    // in front of the summary.
    expect(foot(html)).not.toContain('lucide-activity');
  });

  it('gives a long summary and long notes half the line each', () => {
    expect(foot(withBrief())).toContain('max-w-1/2');
  });

  it('hands the middle of the bar to the search bar from lg up', () => {
    // The spacer is what puts the account controls in the corner wherever
    // nothing else in the bar grows. From lg up the search bar grows, so the
    // spacer stands down rather than splitting the middle with it.
    expect(header(withBrief())).toContain('min-w-0 flex-1 sm:hidden lg:hidden');
    expect(header(withBrief())).not.toContain('min-w-0 flex-1 sm:hidden lg:block');
  });

  it('says a summary that links nowhere without a link', () => {
    const html = withBrief({ text: 'Nothing to do', href: undefined });
    expect(foot(html)).toContain('Nothing to do');
    expect(summaryLink(html)).toBe('');
  });
});

/**
 * The search bar in the top bar.
 *
 * From lg up every page carries it, narrowed by its chip to the workspace the
 * page is in. Below lg the bar is not drawn at all and the command box is the
 * way into search, which is what #704 settled: 1024 is where the column
 * appears and where there is room for a field beside the page title.
 *
 * Effects never run here, so what these assert is the markup the server sends
 * and the classes that decide where it shows. Typing, the list and the chip's
 * press are covered where they can be: tests/search-opening-list.test.tsx.
 */
describe('the search bar in the top bar', () => {
  function shell(module: ModuleId | null) {
    return renderToStaticMarkup(
      <AppShell
        account="11111111-1111-4111-8111-111111111111"
        module={module}
        sections={[]}
        displayName="Sam"
        email="sam@example.com"
        theme={SYSTEM_THEME}
      >
        <p>The page</p>
      </AppShell>,
    );
  }

  /** The top bar, from its own tag to its close. */
  function header(html: string): string {
    const at = html.indexOf('<header');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</header>', at));
  }

  it('puts a field in the bar on a page inside a workspace', () => {
    expect(header(shell('todo'))).toContain('aria-label="Search"');
  });

  it('draws it only from lg up', () => {
    // `hidden` up to lg is also what keeps the field out of the tab order on a
    // phone: a field nobody can see is a field nobody should be able to reach.
    expect(header(shell('todo'))).toContain('hidden min-w-0 flex-1 lg:mx-auto lg:block');
  });

  it('names the workspace on its chip', () => {
    expect(header(shell('todo'))).toContain('>Todo<');
    expect(header(shell('todo'))).toContain('Searching Todo. Choose what to search');
  });

  it('stops short of the width of the bar', () => {
    // Note ca910aa3: it grew into every pixel between the brief and the
    // account icons, which is a field the width of a desk for a few words.
    expect(header(shell('todo'))).toContain('lg:max-w-md');
  });

  it('searches everything, with no chip, outside a workspace', () => {
    const bar = header(shell(null));
    expect(bar).toContain('aria-label="Search"');
    expect(bar).not.toContain('Choose what to search');
    expect(bar).not.toContain('>Todo<');
  });
});

/**
 * The magnifier in the top row.
 *
 * Below lg there is no field in the bar, so search is a button beside the
 * account icons and it opens the box the shortcut opens (#701, #702, #704).
 * That the press opens the box needs a browser; what is asserted here is that
 * the button is drawn, where it is drawn and the width it stops at.
 */
describe('the search button on a phone', () => {
  function shell(module: ModuleId | null) {
    return renderToStaticMarkup(
      <AppShell
        account="11111111-1111-4111-8111-111111111111"
        module={module}
        sections={[]}
        displayName="Sam"
        email="sam@example.com"
        theme={SYSTEM_THEME}
      >
        <p>The page</p>
      </AppShell>,
    );
  }

  /** The top bar, from its own tag to its close. */
  function header(html: string): string {
    const at = html.indexOf('<header');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</header>', at));
  }

  it('draws a search button in the top row', () => {
    expect(header(shell('todo'))).toContain('title="Search"');
  });

  it('draws it below lg only, where the bar has no field', () => {
    const bar = header(shell('todo'));
    const at = bar.indexOf('title="Search"');
    // The button's own classes, read from the tag the title sits in.
    const tag = bar.slice(bar.lastIndexOf('<button', at), bar.indexOf('>', at));
    expect(tag).toContain('lg:hidden');
  });

  it('puts it with the account icons rather than in the middle of the bar', () => {
    const bar = header(shell('todo'));
    expect(bar.indexOf('title="Search"')).toBeGreaterThan(bar.indexOf('aria-label="Search"'));
    expect(bar.indexOf('title="Search"')).toBeLessThan(bar.indexOf('Capture something'));
  });

  it('draws it outside a workspace too', () => {
    expect(header(shell(null))).toContain('title="Search"');
  });
});
