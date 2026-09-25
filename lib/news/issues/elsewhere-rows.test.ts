import { describe, expect, it } from 'vitest';
import { elsewhereFrom } from './elsewhere-rows';

describe('elsewhereFrom', () => {
  const issues = [
    { id: 'a1', senderId: 'axios', receivedAt: '2026-09-24T10:00:00Z', from: 'Axios PM' },
    { id: 'a2', senderId: 'axios', receivedAt: '2026-09-24T18:00:00Z', from: 'Axios PM' },
    { id: 'n1', senderId: 'npr', receivedAt: '2026-09-24T12:00:00Z', from: 'NPR' },
    { id: 'm1', senderId: 'me', receivedAt: '2026-09-23T12:00:00Z', from: 'Mine' },
  ];

  it('names each other newsletter once, newest first, and never this one', () => {
    const result = elsewhereFrom({
      ownSenderId: 'me',
      own: [
        { storyIndex: 0, groupId: 'g' },
        { storyIndex: 1, groupId: 'lonely' },
      ],
      others: [
        { issueId: 'a1', groupId: 'g' },
        { issueId: 'a2', groupId: 'g' },
        { issueId: 'n1', groupId: 'g' },
        { issueId: 'm1', groupId: 'g' },
        { issueId: 'gone', groupId: 'g' },
      ],
      issues,
    });
    expect(result).toEqual({
      0: [
        { issueId: 'a2', from: 'Axios PM' },
        { issueId: 'n1', from: 'NPR' },
      ],
    });
  });
});
