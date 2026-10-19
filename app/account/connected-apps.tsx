'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { Disclosure } from '@/components/ui/disclosure';
import { formatClock } from '@/lib/core/when';
import type { ConnectedApp, ConnectedAppCall } from '@/lib/connector/apps';
import { removeConnectedApp } from './connected-apps-actions';

/**
 * The apps allowed to read the dashboard through its connector, and what each
 * one read (plan #1258). The data is loaded on the server
 * (lib/connector/apps.ts); this renders it and holds the Remove button.
 */
export function ConnectedAppsSection({
  apps,
  connectorAddress,
  timezone,
  failed,
}: {
  apps: ConnectedApp[];
  /** Where a Claude app connects: this deployment's /api/mcp. */
  connectorAddress: string;
  timezone: string;
  /** The grants or the calls could not be read; what the page could not show. */
  failed: string | null;
}) {
  const when = (at: string) =>
    formatClock(at, { day: 'numeric', month: 'short', timeZone: timezone });

  return (
    <section>
      <h3 className="text-ui font-semibold text-ink">Connected apps</h3>
      <p className="mt-0.5 text-ui text-ink-muted">
        The newest 100 calls are listed, including those from apps you have since removed.
      </p>

      {failed && (
        <p role="alert" className="mt-3 text-ui text-danger">
          {failed}
        </p>
      )}

      {apps.length === 0 ? (
        <div className="mt-4 border-y border-border">
          <p className="row-pad text-small leading-snug text-ink-muted">
            No apps are connected. To read your dashboard from Claude, open Settings in claude.ai,
            then Connectors, choose Add custom connector, and give it{' '}
            <span className="[overflow-wrap:anywhere] text-ink">{connectorAddress}</span>.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {apps.map((app) => (
            <AppRow key={app.clientId} app={app} when={when} />
          ))}
        </ul>
      )}

      {/* Any agent that signs in over OAuth connects the same way (note
          eb9ab8a5): the consent page lets a code go back to a loopback
          address (lib/connector/redirect.ts), so nothing is pasted. */}
      <p className="mt-3 text-small leading-snug text-ink-muted">
        Another agent, such as Hermes or a command-line tool, connects the same way: add{' '}
        <span className="[overflow-wrap:anywhere] text-ink">{connectorAddress}</span> to it as an
        MCP server over HTTP. The first time it calls, it opens a page here in your browser; sign in
        and choose Allow, and it keeps the token itself. An agent that can only take a pasted token,
        with no browser sign-in, cannot connect.
      </p>
    </section>
  );
}

function AppRow({ app, when }: { app: ConnectedApp; when: (at: string) => string }) {
  const count = app.calls.length;
  const calls = count === 1 ? '1 call' : `${count} calls`;
  return (
    <li className="row-pad">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-ui font-medium text-ink">{app.name}</span>
          <span className="block text-small text-ink-muted">
            {app.grantedAt ? `Allowed ${when(app.grantedAt)}` : 'Removed'} · {calls}
          </span>
        </span>
        {app.grantedAt && (
          <ConfirmStep
            variant="secondary"
            prompt={`${app.name} stops being able to read your dashboard at once. To use it again, connect it again from the app.`}
            confirmLabel="Yes, remove"
            pendingLabel="Removing…"
            action={removeConnectedApp}
            fields={{ clientId: app.clientId }}
          >
            Remove
          </ConfirmStep>
        )}
      </div>

      {count > 0 && (
        <Disclosure
          className="mt-2"
          title="Calls"
          meta={`${calls}, the latest ${when(app.calls[0].at)}`}
        >
          <ul className="divide-y divide-border">
            {app.calls.map((call) => (
              <CallRow key={call.id} call={call} when={when} />
            ))}
          </ul>
        </Disclosure>
      )}
    </li>
  );
}

function CallRow({ call, when }: { call: ConnectedAppCall; when: (at: string) => string }) {
  const count = call.reads.length;
  const result =
    call.outcome === 'limited'
      ? 'Refused: too many calls'
      : call.outcome === 'error'
        ? `Failed: ${call.error ?? 'no reason given'}`
        : count === 0
          ? 'Found nothing'
          : count === 1
            ? 'Read 1 row'
            : `Read ${count} rows`;

  return (
    <li className="py-2">
      <span className="block text-ui text-ink">
        {call.label}
        {call.asked ? ` ${call.asked}` : ''}
      </span>
      <span className="block text-small text-ink-muted">
        {when(call.at)} · {result}
      </span>
      {count > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-small">
          {call.reads.map((read) => (
            <li key={`${read.table}:${read.ref}`} className="min-w-0">
              {read.href ? (
                <Link href={read.href} className={linkVariants({ tone: 'inline' })}>
                  {read.title}
                </Link>
              ) : (
                <span className="text-ink-muted">{read.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
