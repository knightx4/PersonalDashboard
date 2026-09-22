/**
 * The search bar at rest.
 *
 * What is worth pinning here is the state the bar is in before anybody touches
 * it, because that is the state it is in on every page load: a field, a chip
 * naming the workspace, no list, and no request. The keys and the chip's
 * effect on the list need a browser, which these tests do not have; what they
 * can hold is that the bar draws the workspace it was given, draws no chip
 * where there is no workspace to narrow to, and asks the hook for nothing
 * until the field has the cursor.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NavSection } from '@/components/shell/app-shell';
import type { ModuleId } from '@/lib/modules';
import { SYSTEM_THEME } from '@/lib/theme';

vi.mock('next/navigation', () => ({
  usePathname: () => '/jobs/today',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

/** Every row the hook can offer comes from a fetch, so a bar that asks fails loudly. */
const fetched = vi.fn(() => Promise.reject(new Error('the bar fetched before it was focused')));
vi.stubGlobal('fetch', fetched);

const { SearchBar } = await import('@/components/shell/search-bar');
const { CaptureProvider } = await import('@/components/shell/capture');

const sections: NavSection[] = [
  { href: '/jobs/today', label: 'This week' },
  { href: '/jobs/pipeline', label: 'Pipeline' },
];

function render(module: ModuleId | null): string {
  return renderToStaticMarkup(
    <CaptureProvider>
      <SearchBar
        account="11111111-1111-4111-8111-111111111111"
        module={module}
        sections={sections}
        theme={SYSTEM_THEME}
      />
    </CaptureProvider>,
  );
}

describe('the chip', () => {
  it('names the workspace the bar is standing in', () => {
    const html = render('jobs');
    expect(html).toContain('Job search');
    expect(html).toContain('Search Everything instead');
  });

  it('is absent outside a workspace, where there is nothing to narrow to', () => {
    const html = render(null);
    expect(html).not.toContain('Searching');
    expect(html).not.toContain('<button');
  });
});

describe('the bar at rest', () => {
  it('shows no list until the field has the cursor', () => {
    // The rows are drawn in a floating panel, so the panel's own class is the
    // thing to look for rather than any one row.
    expect(render('jobs')).not.toContain('popover-panel');
  });

  it('fetches nothing', () => {
    render('jobs');
    expect(fetched).not.toHaveBeenCalled();
  });
});
