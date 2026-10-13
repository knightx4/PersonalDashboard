import { shellFor } from '@/lib/shell/shell-for';

/**
 * Shell for the You workspace (plan #1991): what is true about you.
 *
 * Personality first, because it is the tab with something in it from day one
 * once it moves over from Learn. Insights comes last: it is where Dash writes
 * what it notices, and it reads the other three.
 */
export default async function YouLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'you',
    sections: [
      { href: '/you/personality', label: 'Personality', icon: 'personality' },
      { href: '/you/places', label: 'Places', icon: 'places' },
      { href: '/you/work', label: 'Work & school', icon: 'workSchool', exact: true },
      { href: '/you/insights', label: 'Insights', icon: 'insights', exact: true },
    ],
    children,
  });
}
