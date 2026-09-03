import Link from 'next/link';
import { requireUser } from '@/lib/auth/server';
import { MODULES, type ModuleId } from '@/lib/modules';
import { WorkspaceNav } from '@/components/shell/workspace-nav';
import { ModuleMark } from '@/components/ui/module-mark';
import { Card } from '@/components/ui/card';
import { Banner } from '@/components/ui/banner';
import { describeCount, loadModuleCounts } from '@/lib/modules/counts';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { BUCKET_LABELS } from '@/lib/todo/tasks/model';

export const metadata = { title: 'Home' };

/**
 * The front door to the account, not to either module.
 *
 * One account now does several unrelated things, and none should have to
 * stand in for another's landing page. This is where onboarding and a
 * signed-in visit to `/` both end up; each tile goes straight into that
 * module rather than by way of another menu.
 *
 * The tiles come from lib/modules.ts, the same list the workspace switcher
 * uses, so a module added there appears here too -- with a count if one is
 * written below, and its description if not. The vault was added to the
 * switcher and missed here, which is the bug this arrangement removes.
 *
 * Above the tiles: the two or three things that actually need today. That is
 * the one question none of the modules can answer on its own, and it is what
 * this page was missing -- it showed counts, which is news about the account
 * rather than anything to do. A front door showing forty rows would be a list,
 * and /todo is already the list.
 *
 * A module switched off under Account is not listed. That is what the switch
 * means, and a tile for a hidden module would make it a lie.
 */
export default async function HomePage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);

  const [counts, agenda] = await Promise.all([
    loadModuleCounts(user.id),
    // The agenda reads three schemas; a failure in any of them must cost this
    // page a section, not the whole front door.
    loadAgenda(user.id).catch(() => null),
  ]);

  // Overdue and today only, capped. Everything else is a page away.
  const due = (agenda?.piles ?? [])
    .filter((pile) => pile.bucket === 'overdue' || pile.bucket === 'today')
    .flatMap((pile) => pile.entries.map((entry) => ({ bucket: pile.bucket, entry })))
    .slice(0, 4);

  const enabled = MODULES.filter((module) => moduleEnabled(settings, module.id));

  return (
    <div className="min-h-full">
      <WorkspaceNav
        module={null}
        sections={[]}
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
      />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl tracking-tight text-ink">Home</h1>

        {agenda === null && (
          <Banner tone="bad" className="mt-5">
            The agenda could not be read just now, so anything due today is missing from this page.
          </Banner>
        )}

        {/* Nothing at all when there is nothing at all -- no "0 things due",
            no empty card. A quiet day should look quiet, and a front door that
            insists on saying something is one people stop reading. */}
        {due.length > 0 && (
          <Card padding="standard" className="mt-6">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-ui font-semibold text-ink">Today</h2>
              <Link
                href="/todo"
                className="text-small font-medium text-accent underline underline-offset-2"
              >
                The agenda
              </Link>
            </div>

            <ul className="mt-2 divide-y divide-border">
              {due.map(({ bucket, entry }) => (
                <li key={entry.key} className="flex items-baseline gap-2 py-1.5">
                  {bucket === 'overdue' && (
                    <span className="shrink-0 text-micro font-medium text-danger">
                      {BUCKET_LABELS.overdue}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">
                    {entry.task?.title ?? entry.item?.title}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {enabled.map((module) => (
            <ModuleCard
              key={module.id}
              href={module.home}
              module={module.id}
              title={module.label}
              stat={describeCount(counts[module.id]) || module.description}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * The same mark the switcher and Account use -- module glyph on the module's
 * own hue. Three lists of these is two too many.
 */
function ModuleCard({
  href,
  module,
  title,
  stat,
}: {
  href: string;
  module: ModuleId;
  title: string;
  stat: string;
}) {
  return (
    <Link
      href={href}
      className="lift flex items-center gap-4 rounded-card border border-border bg-surface p-5"
    >
      <ModuleMark module={module} size="lg" />
      <span>
        <span className="block text-lead font-semibold text-ink">{title}</span>
        <span className="tabular block text-ui text-ink-muted">{stat}</span>
      </span>
    </Link>
  );
}
