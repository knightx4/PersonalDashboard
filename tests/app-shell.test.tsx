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

  it('keeps the account controls in the corner from lg up', () => {
    // The brief was the flexible middle of the bar; from lg up it is gone and
    // the spacer has to take that job back.
    expect(header(withBrief())).toContain('min-w-0 flex-1 sm:hidden lg:block');
  });

  it('says a summary that links nowhere without a link', () => {
    const html = withBrief({ text: 'Nothing to do', href: undefined });
    expect(foot(html)).toContain('Nothing to do');
    expect(summaryLink(html)).toBe('');
  });
});
