import { shellFor } from '@/lib/shell/shell-for';

/**
 * The weekly review (plan #1233), in the account's chrome like the home page
 * it hangs off: the review reads every workspace, so it wears none of theirs.
 */
export default async function WeekLayout({ children }: { children: React.ReactNode }) {
  return shellFor({ module: null, children });
}
