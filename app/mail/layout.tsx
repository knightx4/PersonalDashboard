import { shellFor } from '@/lib/shell/shell-for';

/**
 * An email read inside the dashboard, in the account's chrome: mail belongs to
 * no one workspace. The shell lives here rather than in the page so that the
 * loading, error and not-found files draw inside it too (plan #1923).
 */
export default async function MailLayout({ children }: { children: React.ReactNode }) {
  return shellFor({ module: null, children });
}
