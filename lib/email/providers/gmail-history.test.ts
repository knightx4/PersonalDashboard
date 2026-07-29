import { describe, expect, it } from 'vitest';
import {
  GmailHistoryExpiredError,
  isGmailHistoryExpiredError,
  messageIdsFromHistory,
} from './gmail-history';

describe('messageIdsFromHistory', () => {
  it('collects unique messagesAdded ids', () => {
    expect(
      messageIdsFromHistory([
        {
          messagesAdded: [
            { message: { id: 'a', labelIds: ['INBOX'] } },
            { message: { id: 'b', labelIds: ['INBOX'] } },
          ],
        },
        {
          messagesAdded: [{ message: { id: 'a', labelIds: ['UNREAD'] } }],
        },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('skips draft/chat/trash', () => {
    expect(
      messageIdsFromHistory([
        {
          messagesAdded: [
            { message: { id: 'draft', labelIds: ['DRAFT'] } },
            { message: { id: 'ok', labelIds: ['INBOX'] } },
            { message: { id: 'chat', labelIds: ['CHAT'] } },
          ],
        },
      ]),
    ).toEqual(['ok']);
  });

  it('returns empty for missing history', () => {
    expect(messageIdsFromHistory(undefined)).toEqual([]);
  });
});

describe('GmailHistoryExpiredError', () => {
  it('is detectable via the type guard', () => {
    const err = new GmailHistoryExpiredError();
    expect(isGmailHistoryExpiredError(err)).toBe(true);
    expect(isGmailHistoryExpiredError(new Error('nope'))).toBe(false);
    expect(err.status).toBe(404);
  });
});
