import 'server-only';

import {
  loadAccountSettings,
  moduleEnabled,
  type AccountSettings,
} from '@/lib/core/account/settings';
import { recordSpend } from '@/lib/core/spend/record';
import type { CoreOperation } from '@/lib/core/spend/operations';
import {
  closingReturns,
  OPEN_STATUSES,
  quietApplications,
  type DraftKind,
  type ReturnItemFacts,
} from '@/lib/drafts/find';
import { DRAFT_MODEL, writeDraft } from '@/lib/drafts/model';
import type { DraftPorts } from '@/lib/drafts/run';
import { addressFromThread, type MessageRow } from '@/lib/drafts/write';
import type { AgendaClients } from '@/lib/todo/agenda/clients';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';

/**
 * The drafts run's reads and writes (plan #1129), on the service-role
 * clients the morning brief already made (inngest/core/day-brief.ts). Every
 * query names the person, by user_id or by ids read from their own rows.
 */

const OPERATION: CoreOperation = 'write-draft';

type Row = Record<string, unknown>;

function one(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

export function draftPorts(clients: AgendaClients): DraftPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const accounts = new Map<string, Promise<AccountSettings>>();
  const account = async (userId: string) => {
    if (!accounts.has(userId)) {
      accounts.set(
        userId,
        clients.core().then((core) => loadAccountSettings(userId, core)),
      );
    }
    return accounts.get(userId)!;
  };

  return {
    async kinds(userId) {
      const [settings, agenda] = await Promise.all([
        account(userId),
        clients.todo().then((todo) => loadAgendaSettings(userId, todo)),
      ]);
      // Nobody would see a draft with the agenda source off, so none is paid for.
      if (!moduleEnabled(settings, 'todo') || !agenda.enabledSources.includes('drafts')) return [];
      const kinds: DraftKind[] = [];
      if (moduleEnabled(settings, 'jobs')) kinds.push('follow_up');
      if (moduleEnabled(settings, 'shopping')) kinds.push('return_request');
      return kinds;
    },

    async followUps(userId, now) {
      const jobs = await clients.jobs();
      const { data, error } = await jobs
        .from('applications')
        .select(
          'id, status, submitted_at, first_human_response_at, roles ( title, company_id, companies ( name ) )',
        )
        .eq('user_id', userId)
        .limit(5000);
      if (error) throw new Error(`Reading the applications failed: ${error.message}`);

      const applications = ((data ?? []) as Row[]).map((row) => {
        const role = one(row.roles);
        const company = one(role?.companies);
        return {
          id: row.id as string,
          status: row.status as string,
          companyId: (role?.company_id as string) ?? null,
          companyName: (company?.name as string) ?? 'the company',
          roleTitle: (role?.title as string) ?? null,
          submittedAt: (row.submitted_at as string) ?? null,
          firstHumanResponseAt: (row.first_human_response_at as string) ?? null,
        };
      });

      const open = new Set<string>(OPEN_STATUSES);
      const openIds = applications.filter((app) => open.has(app.status)).map((app) => app.id);
      if (openIds.length === 0) return [];

      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const [events, interviews] = await Promise.all([
        jobs
          .from('application_events')
          .select('application_id, kind, occurred_at')
          .eq('user_id', userId)
          .in('application_id', openIds),
        jobs
          .from('interviews')
          .select('application_id')
          .eq('user_id', userId)
          .in('application_id', openIds)
          .gte('scheduled_at', since),
      ]);
      if (events.error)
        throw new Error(`Reading the application events failed: ${events.error.message}`);
      if (interviews.error)
        throw new Error(`Reading the interviews failed: ${interviews.error.message}`);

      return quietApplications({
        applications,
        events: ((events.data ?? []) as Row[]).map((row) => ({
          applicationId: row.application_id as string,
          kind: row.kind as string,
          occurredAt: row.occurred_at as string,
        })),
        upcomingInterviews: new Set(
          ((interviews.data ?? []) as Row[]).map((row) => row.application_id as string),
        ),
        now,
      });
    },

    async returns(userId, today) {
      const shopping = await clients.shopping();
      const { data, error } = await shopping
        .from('inventory_items')
        .select(
          'name, variant, cost_cents, order_items!inner ( orders!inner ( id, status, return_deadline, external_order_number, order_date, deleted_at, merchants ( name ) ) )',
        )
        .eq('user_id', userId)
        .eq('status', 'owned')
        .eq('return_planned', true)
        .limit(500);
      if (error) throw new Error(`Reading the items to return failed: ${error.message}`);

      const items: ReturnItemFacts[] = [];
      for (const row of (data ?? []) as Row[]) {
        const order = one(one(row.order_items)?.orders);
        if (!order) continue;
        items.push({
          orderId: order.id as string,
          orderStatus: order.status as string,
          deletedAt: (order.deleted_at as string) ?? null,
          returnDeadline: (order.return_deadline as string) ?? null,
          merchantName: (one(order.merchants)?.name as string) ?? null,
          externalOrderNumber: (order.external_order_number as string) ?? null,
          orderDate: (order.order_date as string) ?? null,
          itemName: row.name as string,
          variant: (row.variant as string) ?? null,
          costCents: (row.cost_cents as number) ?? null,
        });
      }
      return closingReturns(items, today);
    },

    async drafted(userId, aboutIds) {
      if (aboutIds.length === 0) return new Set();
      const core = await clients.core();
      const { data, error } = await core
        .from('drafted_messages')
        .select('kind, about_id, basis')
        .eq('user_id', userId)
        .in('about_id', aboutIds);
      if (error) throw new Error(`Reading the drafts failed: ${error.message}`);
      return new Set(
        ((data ?? []) as Row[]).map(
          (row) => `${row.kind as string}:${row.about_id as string}:${row.basis as string}`,
        ),
      );
    },

    async writtenToday(userId, today) {
      const core = await clients.core();
      const { data, error } = await core
        .from('drafted_messages')
        .select('kind')
        .eq('user_id', userId)
        .eq('show_on', today);
      if (error) throw new Error(`Counting today's drafts failed: ${error.message}`);
      const counts: Record<DraftKind, number> = { follow_up: 0, return_request: 0 };
      for (const row of (data ?? []) as Row[]) {
        const kind = row.kind as DraftKind;
        if (kind in counts) counts[kind] += 1;
      }
      return counts;
    },

    async addressing(userId, candidate) {
      if (candidate.kind === 'follow_up') {
        const jobs = await clients.jobs();
        const [messages, events] = await Promise.all([
          jobs
            .from('inbox_messages')
            .select('from_address, reply_to_address, email_address, subject, received_at')
            .eq('user_id', userId)
            .eq('resulting_application_id', candidate.aboutId)
            .order('received_at', { ascending: false })
            .limit(8),
          jobs
            .from('application_events')
            .select('kind, summary, occurred_at')
            .eq('user_id', userId)
            .eq('application_id', candidate.aboutId)
            .not('kind', 'in', '(note,status_override)')
            .order('occurred_at', { ascending: false })
            .limit(8),
        ]);
        const found = addressFromThread((messages.data ?? []) as MessageRow[]);
        return {
          toAddress: found.toAddress,
          fromInbox: found.fromInbox,
          context: {
            thread: found.thread,
            recipientName: found.recipientName,
            events: ((events.data ?? []) as Row[]).map((row) => ({
              at: row.occurred_at as string,
              kind: row.kind as string,
              summary: (row.summary as string) ?? null,
            })),
          },
        };
      }

      const shopping = await clients.shopping();
      const { data } = await shopping
        .from('inbox_messages')
        .select('from_address, reply_to_address, email_address, subject, received_at')
        .eq('user_id', userId)
        .eq('resulting_order_id', candidate.aboutId)
        .order('received_at', { ascending: false })
        .limit(8);
      const found = addressFromThread((data ?? []) as MessageRow[]);
      return {
        toAddress: found.toAddress,
        fromInbox: found.fromInbox,
        context: { thread: found.thread, recipientName: found.recipientName, events: [] },
      };
    },

    async senderName(userId) {
      return (await account(userId)).displayName?.trim() || null;
    },

    async write(context, onSpend) {
      // Without a key the plain draft is stored instead.
      if (!apiKey) return null;
      return { model: DRAFT_MODEL, draft: await writeDraft(context, { apiKey, onSpend }) };
    },

    async ledger(userId, report) {
      await recordSpend(await clients.core(), userId, {
        module: 'core',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async save(row) {
      const core = await clients.core();
      const { data, error } = await core
        .from('drafted_messages')
        .upsert(row, { onConflict: 'user_id,kind,about_id,basis', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`Saving a draft failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
