import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

/**
 * What a signed-in account sees where a part of the app is not theirs.
 *
 * It stands on the page ground rather than inside a workspace shell, because
 * the shell is the thing being refused: rendering the Dev sidebar around "you
 * may not read this" would offer seven links that all say the same thing
 * again.
 *
 * Three rules it keeps, and they are the reason this is a component rather
 * than a paragraph written twice:
 *
 *   * It says the account is wrong, not that the page is broken or missing. A
 *     404 here would be a small lie -- the page exists, it belongs to somebody
 *     else -- and someone who hit it by following a link deserves to know
 *     which of those happened.
 *   * It shows nothing from behind the wall. No count, no title, no "there are
 *     4 open bugs". The caller renders this *instead of* loading, never
 *     beside it.
 *   * There is a way out. A refusal with no onward link is a dead end, and the
 *     rest of the app is still theirs.
 */
export function NoPermission({
  what = 'this part of the app',
}: {
  /** Completes "___ belongs to another account." Keep it a noun phrase. */
  what?: string;
}) {
  return (
    <div className="bg-page flex min-h-screen items-center justify-center px-6 py-16">
      <Card padding="standard" className="max-w-lg text-center">
        <Lock className="mx-auto size-6 text-ink-ghost" strokeWidth={1.75} aria-hidden />
        <h1 className="font-display mt-3 text-title tracking-tight text-ink">
          You do not have permission to see this.
        </h1>
        <p className="mt-2 text-body text-ink-muted">
          {what} belongs to another account. Nothing has gone wrong, and the rest of the app is
          still yours.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/home" className={buttonVariants({ variant: 'secondary' })}>
            Go to Home
          </Link>
        </div>
      </Card>
    </div>
  );
}
