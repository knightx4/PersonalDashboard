import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { draftExpiry, draftTitle, type DraftKind } from '@/lib/drafts/find';
import { gmailComposeUrl } from '@/lib/jobs/followup/compose';
import { addDays, todayIn } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Follow-ups and return requests Dash has written, from
 * core.drafted_messages (plan #1129).
 *
 * The morning run writes them (lib/drafts/run.ts); this shows each one from
 * the day it was written, with a link that opens Gmail's compose window with
 * the recipient, subject and text in place. That link is the one tap #1128
 * settled on: the app keeps read-only access to the mailbox, and sending is
 * the second tap, in Gmail.
 *
 * Done marks it sent, "Not this one" dismisses it, and "Later" moves it to
 * tomorrow with three more days to run. A draft nobody touches stops
 * showing three days after it appeared: `expires_at` is compared with the
 * clock here, so nothing has to run for it to go.
 */

type Row = {
  id: string;
  kind: DraftKind;
  about_id: string;
  about_label: string;
  to_address: string | null;
  from_inbox: string | null;
  subject: string;
  body: string;
  reason: string | null;
  show_on: string;
};

export const draftsSource: AgendaSource = {
  id: 'drafts',
  label: 'Follow-ups and return requests',
  module: 'todo',
  description:
    'A follow-up on an application that has gone quiet, or a return request before the window closes, written by Dash and ready to send from Gmail.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const clients = ctx.clients ?? sessionClients;
    const core = await clients.core();

    const { data, error } = await core
      .from('drafted_messages')
      .select(
        'id, kind, about_id, about_label, to_address, from_inbox, subject, body, reason, show_on',
      )
      .eq('user_id', ctx.userId)
      .is('done_at', null)
      .is('dismissed_at', null)
      .gt('expires_at', ctx.now.toISOString())
      .lte('show_on', ctx.to)
      .order('show_on', { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Row[];

    // The role page is where a follow-up leads, and the draft knows only the
    // application, so the roles are read in one query for all of them.
    const applicationIds = rows
      .filter((row) => row.kind === 'follow_up')
      .map((row) => row.about_id);
    const roleOf = new Map<string, string>();
    if (applicationIds.length > 0) {
      const jobs = await clients.jobs();
      const { data: apps } = await jobs
        .from('applications')
        .select('id, role_id')
        .eq('user_id', ctx.userId)
        .in('id', applicationIds);
      for (const app of (apps ?? []) as { id: string; role_id: string | null }[]) {
        if (app.role_id) roleOf.set(app.id, app.role_id);
      }
    }

    return rows.map((row) => {
      const roleId = row.kind === 'follow_up' ? roleOf.get(row.about_id) : null;
      const href =
        row.kind === 'return_request'
          ? `/shopping/orders/${row.about_id}`
          : roleId
            ? `/jobs/roles/${roleId}`
            : '/jobs';

      return {
        key: `drafts:${row.id}`,
        source: 'drafts',
        ref: `core.drafted_messages:${row.id}`,
        title: draftTitle(row.kind, row.about_label),
        day: row.show_on,
        at: null,
        link: { href, label: row.kind === 'return_request' ? 'Open the order' : 'Open the role' },
        action: {
          href: gmailComposeUrl({
            emailAddress: row.from_inbox,
            to: row.to_address,
            subject: row.subject,
            body: row.body,
          }),
          label: 'Send in Gmail',
        },
        detail: row.reason,
        completable: true,
      };
    });
  },

  async complete(ctx, key) {
    const core = await (ctx.clients ?? sessionClients).core();
    await core
      .from('drafted_messages')
      .update({ done_at: new Date().toISOString() })
      .eq('id', idOf(key))
      .eq('user_id', ctx.userId);
  },

  async defer(ctx, key) {
    const tomorrow = addDays(todayIn(ctx.timezone, ctx.now), 1);
    const core = await (ctx.clients ?? sessionClients).core();
    await core
      .from('drafted_messages')
      .update({
        show_on: tomorrow,
        expires_at: draftExpiry(new Date(ctx.now.getTime() + 24 * 60 * 60 * 1000)),
      })
      .eq('id', idOf(key))
      .eq('user_id', ctx.userId);
  },

  async dismiss(ctx, key) {
    const core = await (ctx.clients ?? sessionClients).core();
    await core
      .from('drafted_messages')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', idOf(key))
      .eq('user_id', ctx.userId);
  },
};

function idOf(key: string): string {
  return key.slice('drafts:'.length);
}
