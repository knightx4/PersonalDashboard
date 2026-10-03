import type { SchemaClient } from '@/lib/ask/db';
import type { TalkCitation } from '@/lib/talk/talk';
import type { ConnectorOutcome } from './calls';

/**
 * The Connected apps section on the account page (plan #1258): each app the
 * person has allowed, and every call a connected app made with what it read.
 *
 * Two sources. The grants come from Supabase's OAuth server
 * (`auth.oauth.listGrants()`), and are the only place an app's name lives: a
 * connector token carries its client_id and nothing else, so
 * core.connector_calls.client_name is null in practice. The calls come from
 * core.connector_calls. An app whose grant has since been removed keeps its
 * calls, listed under its client_id, since what it read is still history.
 */

/** How many calls the section shows, across every app. */
export const CONNECTED_APP_CALLS = 100;

/** One grant as the section needs it; the subset of supabase-js's OAuthGrant it reads. */
export type GrantInput = {
  client: { id: string; name?: string | null };
  granted_at: string;
};

/** One row of core.connector_calls as the section reads it. */
export type ConnectorCallInput = {
  id: string;
  client_id: string;
  client_name: string | null;
  tool: string;
  input: unknown;
  reads: unknown;
  outcome: ConnectorOutcome;
  error: string | null;
  created_at: string;
};

export type ConnectedAppCall = {
  id: string;
  /** The lookup in words: "Searched", "Opened a row". */
  label: string;
  /** What it asked for, when the input says it plainly: a search's words, a date range. */
  asked: string | null;
  outcome: ConnectorOutcome;
  error: string | null;
  at: string;
  reads: TalkCitation[];
};

export type ConnectedApp = {
  clientId: string;
  name: string;
  /** When access was allowed, or null when the grant is gone and only its calls remain. */
  grantedAt: string | null;
  calls: ConnectedAppCall[];
};

const TOOL_LABELS: Record<string, string> = {
  search: 'Searched',
  open_row: 'Opened a row',
  spend_by_merchant: 'Read spending by merchant',
  job_applications: 'Read job applications',
  todos: 'Read todos',
  goal_status: 'Read goals',
  vault_notes: 'Read vault notes',
  note_positions: "Read a note's neighbours and positions",
  courses: 'Read courses',
  read_dev_row: 'Read a Dev row',
  find_dev_text: 'Searched Dev text',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** What a call asked for, in a few words, from the fields the lookups share. */
export function askedFor(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const fields = input as Record<string, unknown>;
  const parts: string[] = [];
  const query = text(fields.query);
  if (query) parts.push(`“${query}”`);
  const merchant = text(fields.merchant);
  if (merchant) parts.push(merchant);
  const from = text(fields.from);
  const to = text(fields.to);
  if (from && to) parts.push(`${from} to ${to}`);
  else if (from) parts.push(`from ${from}`);
  else if (to) parts.push(`to ${to}`);
  return parts.length ? parts.join(', ') : null;
}

/** The reads column, kept to well-formed citations with an address inside the app. */
export function readsOf(value: unknown): TalkCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { table, ref, title, href } = item as Record<string, unknown>;
    if (typeof table !== 'string' || typeof ref !== 'string') return [];
    const link =
      typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') ? href : '';
    return [{ table, ref, title: typeof title === 'string' && title ? title : ref, href: link }];
  });
}

/**
 * The apps to list: every granted app, newest grant first, then any app that
 * has calls but no grant any more, newest call first. Each app's calls are
 * newest first.
 */
export function connectedApps(grants: GrantInput[], calls: ConnectorCallInput[]): ConnectedApp[] {
  const byClient = new Map<string, ConnectedApp>();

  const granted = [...grants].sort((a, b) => b.granted_at.localeCompare(a.granted_at));
  for (const grant of granted) {
    if (byClient.has(grant.client.id)) continue;
    byClient.set(grant.client.id, {
      clientId: grant.client.id,
      name: text(grant.client.name) ?? 'An unnamed app',
      grantedAt: grant.granted_at,
      calls: [],
    });
  }

  const newestFirst = [...calls].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const call of newestFirst) {
    let app = byClient.get(call.client_id);
    if (!app) {
      app = {
        clientId: call.client_id,
        name: text(call.client_name) ?? 'A removed app',
        grantedAt: null,
        calls: [],
      };
      byClient.set(call.client_id, app);
    }
    app.calls.push({
      id: call.id,
      label: toolLabel(call.tool),
      asked: askedFor(call.input),
      outcome: call.outcome,
      error: call.error,
      at: call.created_at,
      reads: readsOf(call.reads),
    });
  }

  return [...byClient.values()];
}

/** The newest calls a person's connected apps made, across all of them. */
export async function loadConnectorCalls(
  core: SchemaClient,
  userId: string,
  limit: number = CONNECTED_APP_CALLS,
): Promise<ConnectorCallInput[]> {
  const { data, error } = await core
    .from('connector_calls')
    .select('id, client_id, client_name, tool, input, reads, outcome, error, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read the connector calls: ${error.message}`);
  return (data ?? []) as ConnectorCallInput[];
}
