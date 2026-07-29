/**
 * Pure helpers for Gmail users.history.list responses.
 * Kept free of fetch/server imports so unit tests stay lightweight.
 */

export type GmailHistoryRecord = {
  id?: string;
  messagesAdded?: Array<{ message?: { id?: string; threadId?: string; labelIds?: string[] } }>;
  messagesDeleted?: Array<{ message?: { id?: string } }>;
  labelsAdded?: Array<{ message?: { id?: string } }>;
  labelsRemoved?: Array<{ message?: { id?: string } }>;
};

export type GmailHistoryListResponse = {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
};

/** Collect unique message ids from messagesAdded entries (new mail). */
export function messageIdsFromHistory(history: GmailHistoryRecord[] | undefined): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const record of history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      const id = added.message?.id;
      if (!id || seen.has(id)) continue;
      // Skip drafts / chats / trash if Gmail labeled them that way.
      const labels = added.message?.labelIds ?? [];
      if (labels.includes('DRAFT') || labels.includes('CHAT') || labels.includes('TRASH')) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export class GmailHistoryExpiredError extends Error {
  readonly status = 404;

  constructor(message = 'Gmail history cursor expired — run a fresh sync.') {
    super(message);
    this.name = 'GmailHistoryExpiredError';
  }
}

export function isGmailHistoryExpiredError(err: unknown): err is GmailHistoryExpiredError {
  return err instanceof GmailHistoryExpiredError;
}
