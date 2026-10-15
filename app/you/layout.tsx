import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor } from '@/lib/shell/tabs';

/**
 * Shell for the You workspace (plan #1991): what is true about you.
 *
 * Personality first, because it is the tab with something in it from day one
 * once it moves over from Learn. Details follows it (plan #2124.2): the
 * plain facts a form asks for. Insights comes last: it is where Dash writes
 * what it notices, and it reads the others.
 */
export default async function YouLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'you',
    sections: ({ owner }) => tabsFor('you', owner),
    children,
  });
}
