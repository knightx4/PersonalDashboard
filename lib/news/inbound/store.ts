import type { InboundMessage } from '@/lib/news/providers/types';

/**
 * The three writes taking delivery makes, named so the rules above them can be
 * tested without a database.
 *
 * Kept as a port rather than reaching for the client directly because the
 * interesting part of delivery is the decisions -- an address nobody owns is
 * dropped, a sender is created once, the same message twice is one issue --
 * and those are worth a test each. lib/news/inbound/supabase.ts is the real
 * implementation and lib/news/inbound/deliver.test.ts uses a fake.
 */
export type NewsStore = {
  /** The account that owns an address, or null when nobody does. */
  accountFor(localPart: string): Promise<string | null>;
  /** The sender's id, creating the row the first time that address writes. */
  senderFor(userId: string, email: string, name: string | null): Promise<string>;
  /**
   * The new issue's id, or `repeat` when this account already holds that
   * message id.
   */
  storeIssue(issue: {
    userId: string;
    senderId: string;
    message: InboundMessage;
  }): Promise<{ issueId: string } | 'repeat'>;
};
