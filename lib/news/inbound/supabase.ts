import 'server-only';

import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { NewsStore } from './store';

/** Postgres' unique violation, which is how a repeat delivery announces itself. */
const UNIQUE_VIOLATION = '23505';

/**
 * The store, over the news schema.
 *
 * Every query names the account explicitly. This client is the service role,
 * so nothing else will: the policies that make "your newsletters are yours"
 * true for a page do not apply here.
 */
export function newsStore(client: NewsSupabaseClient): NewsStore {
  return {
    async accountFor(localPart) {
      const { data, error } = await client
        .from('addresses')
        .select('user_id')
        .eq('local_part', localPart)
        .maybeSingle();
      if (error) throw new Error(`news: reading the address failed (${error.message})`);
      return (data?.user_id as string | undefined) ?? null;
    },

    async senderFor(userId, email, name) {
      const existing = await client
        .from('senders')
        .select('id')
        .eq('user_id', userId)
        .eq('email', email)
        .maybeSingle();
      if (existing.error) {
        throw new Error(`news: reading the sender failed (${existing.error.message})`);
      }
      if (existing.data) return existing.data.id as string;

      const created = await client
        .from('senders')
        .insert({ user_id: userId, email, name })
        .select('id')
        .single();
      if (!created.error) return created.data.id as string;

      // Two messages from one newsletter can arrive together, and the loser of
      // that race reads the row the winner wrote rather than failing the
      // delivery.
      if (created.error.code !== UNIQUE_VIOLATION) {
        throw new Error(`news: storing the sender failed (${created.error.message})`);
      }
      const retried = await client
        .from('senders')
        .select('id')
        .eq('user_id', userId)
        .eq('email', email)
        .single();
      if (retried.error) {
        throw new Error(`news: reading the sender failed (${retried.error.message})`);
      }
      return retried.data.id as string;
    },

    async storeIssue({ userId, senderId, message }) {
      const { error } = await client.from('issues').insert({
        user_id: userId,
        sender_id: senderId,
        message_id: message.messageId,
        subject: message.subject,
        text_body: message.textBody,
        html_body: message.htmlBody,
        unsubscribe_url: message.unsubscribeUrl,
        unsubscribe_email: message.unsubscribeEmail,
      });
      if (!error) return 'stored';
      // issues_user_message_key. The service retries anything it did not get a
      // 200 for, and the second attempt lands on the row the first one wrote.
      if (error.code === UNIQUE_VIOLATION) return 'repeat';
      throw new Error(`news: storing the issue failed (${error.message})`);
    },
  };
}
