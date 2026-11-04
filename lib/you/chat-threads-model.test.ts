import { describe, expect, it } from 'vitest';
import {
  filterRecipients,
  isTyping,
  MENTOR_PALETTE,
  mentorColour,
  mergeMessages,
  personInitials,
  previewOf,
  receiptOf,
  searchTextOf,
  seatAreaOf,
  sortPeople,
  threadBlocks,
  threadDetail,
  threadMessageOf,
  threadTime,
  recipientsOf,
  withChats,
  type PersonRow,
  type ThreadMessage,
} from './chat-threads-model';

const NOW = Date.parse('2026-11-03T09:00:00Z');
const ZONE = 'Europe/London';

function msg(id: string, role: 'person' | 'advisor', createdAt: string, extra: Partial<ThreadMessage> = {}): ThreadMessage {
  return { id, chatId: 'c', role, kind: 'reply', text: id, receipts: [], createdAt, deliveredAt: null, readAt: null, ...extra };
}

function row(fields: Partial<PersonRow>): PersonRow {
  return {
    id: 'a',
    key: 'a',
    name: 'A',
    about: '',
    colour: '#4a5fd0',
    canTalk: true,
    chatId: null,
    last: null,
    unread: false,
    typingUntil: null,
    lastReadAt: null,
    ...fields,
  };
}

/** WCAG contrast of white on a #rrggbb colour. */
function contrastWithWhite(hex: string): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05);
}

describe('the People tab model', () => {
  it('reads a Realtime row and drops one that is not a message', () => {
    expect(threadMessageOf({ id: 'x', chat_id: 'c', role: 'advisor', kind: 'text_first', text: ' hi ', created_at: '2026-11-03T08:00:00Z' })).toMatchObject({
      role: 'advisor',
      kind: 'text_first',
      text: 'hi',
      deliveredAt: null,
    });
    expect(threadMessageOf({ id: 'x', text: '', created_at: '2026-11-03T08:00:00Z' })).toBeNull();
  });

  it('merges by id, oldest first, keeping the copy whose receipts are further on', () => {
    const read = msg('b', 'person', '2026-11-03T08:01:00Z', { readAt: '2026-11-03T08:02:00Z' });
    const sent = msg('b', 'person', '2026-11-03T08:01:01Z');
    const merged = mergeMessages([read, msg('a', 'advisor', '2026-11-03T08:00:00Z')], [sent, msg('c', 'advisor', '2026-11-03T08:03:00Z')]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1].readAt).not.toBeNull();
  });

  it('is typing only before typing_until', () => {
    expect(isTyping('2026-11-03T09:00:05Z', NOW)).toBe(true);
    expect(isTyping('2026-11-03T08:59:55Z', NOW)).toBe(false);
    expect(isTyping(null, NOW)).toBe(false);
  });

  it('keeps a mentor in one colour, their own when set, and every fallback carries white initials', () => {
    expect(mentorColour('cfo', null)).toBe(mentorColour('cfo', null));
    expect(mentorColour('cfo', '#123456')).toBe('#123456');
    expect(MENTOR_PALETTE).toContain(mentorColour('cfo', 'red'));
    for (const c of MENTOR_PALETTE) expect(contrastWithWhite(c)).toBeGreaterThanOrEqual(4.5);
  });

  it('writes initials without a leading The', () => {
    expect(personInitials('The CFO')).toBe('C');
    expect(personInitials('Benjamin Franklin')).toBe('BF');
    expect(personInitials('Dr Alexandrina Featherstonehaugh-Wetherby')).toBe('DA');
  });

  it('sorts newest thread first, then by name', () => {
    const sorted = sortPeople([
      row({ id: '1', name: 'Zed' }),
      row({ id: '2', name: 'Old', last: { text: 'x', role: 'advisor', at: '2026-10-01T00:00:00Z' } }),
      row({ id: '3', name: 'Amy' }),
      row({ id: '4', name: 'New', last: { text: 'x', role: 'person', at: '2026-11-01T00:00:00Z' } }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(['New', 'Old', 'Amy', 'Zed']);
  });

  it('previews typing, then the last line, then why there is nothing', () => {
    expect(previewOf(row({ typingUntil: '2026-11-03T09:00:05Z', last: { text: 'x', role: 'advisor', at: '' } }), NOW)).toBe('typing…');
    expect(previewOf(row({ last: { text: 'hi', role: 'person', at: '' } }), NOW)).toBe('You: hi');
    expect(previewOf(row({}), NOW)).toBe('Say hello');
    expect(previewOf(row({ canTalk: false }), NOW)).toBe('Not ready to talk yet');
  });

  it('times a thread as a texting app does: the clock, Yesterday, the weekday, the date', () => {
    expect(threadTime('2026-11-03T07:12:00Z', { timeZone: ZONE, now: NOW })).toMatch(/^7:12\sAM$/u);
    expect(threadTime('2026-11-03T00:05:00Z', { timeZone: ZONE, now: NOW })).toMatch(/^12:05\sAM$/u);
    expect(threadTime('2026-11-02T07:12:00Z', { timeZone: ZONE, now: NOW })).toBe('Yesterday');
    expect(threadTime('2026-11-01T07:12:00Z', { timeZone: ZONE, now: NOW })).toBe('Sun');
    expect(threadTime('2026-10-27T07:12:00Z', { timeZone: ZONE, now: NOW })).toBe('Oct 27');
    expect(threadTime('2025-10-29T07:12:00Z', { timeZone: ZONE, now: NOW })).toBe('Oct 29, 2025');
  });

  it('names a mentor’s area in a word or two and says how soon they answer', () => {
    expect(seatAreaOf({ key: 'cfo', kind: 'seat', focus: 'Six to twelve months: spending' })).toBe('Money');
    expect(seatAreaOf({ key: 'franklin', kind: 'guest', focus: 'Practical habits, thrift, hard work.' })).toBe('Habits');
    expect(seatAreaOf({ key: 'x', kind: 'guest', focus: null })).toBe('');
    expect(threadDetail({ about: 'Money', canTalk: true })).toBe('Money · usually replies right away');
    expect(threadDetail({ about: '', canTalk: false })).toBe('Not ready to talk yet');
  });

  it('cuts a search to the box', () => {
    expect(searchTextOf('  two   words ')).toBe('two words');
    expect(searchTextOf('')).toBeNull();
    expect(searchTextOf(['x'])).toBeNull();
    expect(searchTextOf('x'.repeat(500))?.length).toBe(200);
  });

  it('labels days and groups a sender while they are under ten minutes apart', () => {
    const blocks = threadBlocks(
      [
        msg('a', 'person', '2026-11-02T10:00:00Z'),
        msg('b', 'advisor', '2026-11-02T10:00:10Z'),
        msg('c', 'advisor', '2026-11-02T10:01:00Z'),
        msg('d', 'advisor', '2026-11-02T10:30:00Z'),
        msg('e', 'advisor', '2026-11-03T08:00:00Z'),
      ],
      { timeZone: ZONE, now: NOW },
    );
    expect(blocks.map((b) => (b.kind === 'day' ? b.label : b.messages.map((m) => m.id).join('')))).toEqual([
      'Yesterday',
      'a',
      'bc',
      'd',
      'Today',
      'e',
    ]);
  });

  it('says Sent, Delivered, then Read under your last message, and nothing once they have answered', () => {
    expect(receiptOf([msg('a', 'person', '2026-11-03T08:00:00Z')])).toEqual({ id: 'a', label: 'Sent' });
    expect(receiptOf([msg('a', 'person', '2026-11-03T08:00:00Z', { deliveredAt: 'x' })])?.label).toBe('Delivered');
    expect(receiptOf([msg('a', 'person', '2026-11-03T08:00:00Z', { deliveredAt: 'x', readAt: 'y' })])?.label).toBe('Read');
    expect(receiptOf([msg('a', 'person', '2026-11-03T08:00:00Z'), msg('b', 'advisor', '2026-11-03T08:01:00Z')])).toBeNull();
  });
});

describe('the Messages list and New message (plan #2879.2)', () => {
  const rows = [
    row({ id: '1', name: 'Zed', chatId: 'c1' }),
    row({ id: '2', name: 'Ada', chatId: null }),
    row({ id: '3', name: 'Bea', chatId: null, canTalk: false }),
    row({ id: '4', name: 'Cal', chatId: 'c4' }),
  ];

  it('lists only the people with a chat, in the order given', () => {
    expect(withChats(rows).map((r) => r.name)).toEqual(['Zed', 'Cal']);
  });

  it('keeps the open thread in the list even before it has a chat', () => {
    const keyed = rows.map((r, i) => ({ ...r, key: `k${i}` }));
    expect(withChats(keyed, 'k2').map((r) => r.name)).toEqual(['Zed', 'Bea', 'Cal']);
  });

  it('offers everyone A to Z, those not ready to talk last', () => {
    expect(recipientsOf(rows).map((r) => r.name)).toEqual(['Ada', 'Cal', 'Zed', 'Bea']);
  });

  it('narrows to names holding what is typed, ignoring case and the spaces round it', () => {
    expect(filterRecipients(rows, '  a ').map((r) => r.name)).toEqual(['Ada', 'Bea', 'Cal']);
    expect(filterRecipients(rows, 'ZE').map((r) => r.name)).toEqual(['Zed']);
    expect(filterRecipients(rows, '')).toHaveLength(4);
  });
});
