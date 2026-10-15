import { HOME_SECTIONS } from '@/lib/home/sections';
import { shellFor } from '@/lib/shell/shell-for';

/**
 * The weekly review (plan #1233), in the account's chrome like the home page
 * it hangs off: the review reads every workspace, so it wears none of theirs.
 */
export default async function WeekLayout({ children }: { children: React.ReactNode }) {
  // Home's two rooms in the column and dock, with Now lit (plan #1937.7).
  return shellFor({ module: null, sections: HOME_SECTIONS, children });
}
