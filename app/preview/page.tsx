import { notFound } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import Link from 'next/link';
import { SURFACES } from './surfaces';

/**
 * The surface gallery: the app's own components, on the app's own ground.
 *
 * Off unless `UI_PREVIEW=1` is set at build time. That is the whole security
 * story and it is deliberately a build-time constant rather than a runtime
 * check, so the route is not merely refused in production, it does not exist:
 * nothing here reads a session or a database, and there is nothing behind it
 * to reach. It is public in `proxy.ts` for the same reason -- a screenshot
 * harness cannot sign in, and a 404 needs no protecting.
 *
 * `?s=<id>` renders one surface alone, which is what the harness shoots. With
 * no query it lists them, which is what a person opens.
 */
/* Dynamic, not static. `force-static` prerenders this at build time with no
 * query string, so every `?s=` shot came back as the index -- four files
 * written, all of them the wrong picture. A route that reads searchParams
 * cannot be prerendered. */
export const dynamic = 'force-dynamic';

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; w?: string }>;
}) {
  // Signed in, or the harness. It used to be UI_PREVIEW alone, which meant the
  // gallery could not be reached from a deployment at all -- so the only person
  // who could look at these surfaces was whoever was running the screenshot
  // script, which is exactly backwards for a thing whose whole purpose is
  // someone else looking at them. Nothing here reads a session or a database;
  // the sign-in is there so it need not be public, not because it guards
  // anything. See app/dev/surfaces, which frames these.
  if (process.env.UI_PREVIEW !== '1' && !(await getUser())) notFound();

  const { s } = await searchParams;
  const surface = SURFACES.find((entry) => entry.id === s);

  if (s && !surface) notFound();

  if (surface) {
    return (
      <div data-workspace={surface.module} className="bg-page min-h-screen">
        {/* The width the thing is actually read at. A surface that only looks
          * crowded at 390px and only looks empty at 1280px has been judged at
          * neither, which is how a form nobody would draw on a phone gets
          * drawn on a phone. */}
        <div
          className={`mx-auto px-4 py-6 ${surface.width === 'narrow' ? 'max-w-2xl' : 'max-w-4xl'}`}
        >
          {surface.render()}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-page min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-title text-page-ink">Surfaces</h1>
          <p className="mt-1 text-body text-page-ink-muted">
            The real components, with typed fixtures. {SURFACES.length} surfaces.
          </p>
        </div>
        <ul className="divide-y divide-page-border">
          {SURFACES.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/preview?s=${entry.id}`}
                className="flex items-baseline justify-between gap-3 py-2 text-body text-page-ink hover:text-accent"
              >
                {entry.label}
                <span className="text-small text-page-ink-ghost">{entry.module}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
