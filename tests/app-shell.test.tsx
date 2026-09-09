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

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { AppShell } = await import('@/components/shell/app-shell');

function render(sections: NavSection[], settingsHref?: string) {
  return renderToStaticMarkup(
    <AppShell
      module={null}
      sections={sections}
      settingsHref={settingsHref}
      displayName="Sam"
      email="sam@example.com"
      theme={null}
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
