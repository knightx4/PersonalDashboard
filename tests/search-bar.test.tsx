/**
 * The ways into search, and where they land (plan #1363).
 *
 * The field in the top bar is a button drawn as a field: a press opens the
 * search box over the page, and nothing drops under the field. ⌘K opens the
 * same box at any width. Every opening starts on everything you own, so the
 * box opened inside a workspace says "Everything" on its chip.
 *
 * These tests have no browser, so the click is the button's own handler called
 * directly and the shortcut is the test the shell's listener runs on each key.
 */
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NavSection } from '@/components/shell/app-shell';
import { SYSTEM_THEME } from '@/lib/theme';

vi.mock('next/navigation', () => ({
  usePathname: () => '/jobs/today',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

/** Every row the box can offer comes from a fetch, and a static render makes none. */
const fetched = vi.fn(() => Promise.reject(new Error('fetched during a static render')));
vi.stubGlobal('fetch', fetched);

const { SearchBar, isSearchShortcut } = await import('@/components/shell/search-bar');
const { CommandPalette } = await import('@/components/shell/command-palette');
const { CaptureProvider } = await import('@/components/shell/capture');

const sections: NavSection[] = [
  { href: '/jobs/today', label: 'This week' },
  { href: '/jobs/pipeline', label: 'Pipeline' },
];

/** The first element of a type in a tree the component returned. */
function find(node: ReactNode, type: string): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (node.type === type) return node;
  const children = node.props.children as ReactNode;
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return null;
}

describe('the field in the top bar', () => {
  it('opens the search box on a click', () => {
    const onOpen = vi.fn();
    const button = find(SearchBar({ onOpen }), 'button');
    expect(button).not.toBeNull();
    (button!.props.onClick as () => void)();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is a button that opens a dialog, with nothing to type into and no list under it', () => {
    const html = renderToStaticMarkup(<SearchBar onOpen={() => {}} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('popover-panel');
    expect(fetched).not.toHaveBeenCalled();
  });

  it('says ⌘K beside it, hidden until a modifier is held like every other hint', () => {
    const html = renderToStaticMarkup(<SearchBar onOpen={() => {}} />);
    expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(html).toMatch(/<kbd[^>]*class="keyhint [^"]*"[^>]*>⌘K<\/kbd>/);
  });
});

describe('the shortcut', () => {
  it('is ⌘K, or Ctrl+K off a Mac', () => {
    expect(isSearchShortcut({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSearchShortcut({ key: 'K', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSearchShortcut({ key: 'k', metaKey: false, ctrlKey: true })).toBe(true);
  });

  it('is not a plain k, or another key with the modifier', () => {
    expect(isSearchShortcut({ key: 'k', metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSearchShortcut({ key: 'j', metaKey: true, ctrlKey: false })).toBe(false);
  });
});

describe('the box it opens', () => {
  it('starts on Everything inside a workspace', () => {
    const html = renderToStaticMarkup(
      <CaptureProvider>
        <CommandPalette
          account="11111111-1111-4111-8111-111111111111"
          module="jobs"
          sections={sections}
          theme={SYSTEM_THEME}
          open
          onOpenChange={() => {}}
        />
      </CaptureProvider>,
    );
    expect(html).toContain('Searching Everything. Choose what to search');
  });
});
