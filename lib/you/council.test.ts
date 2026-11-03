import { describe, expect, it } from 'vitest';
import {
  ADVICE_GAP_MS,
  ADVICE_STALE_AFTER_MS,
  adviceBrief,
  cleanMessage,
  decideAdviceRun,
  EPISODE_QUIET_MS,
  episodeDue,
  newestByAdvisor,
  noteOf,
  receiptsOf,
  replyBrief,
  replyState,
  REPLY_STALE_AFTER_MS,
  STALE_REPLY_ERROR,
  todoTitleFromNote,
  unreadNotes,
  UNREAD_MAX,
  type CouncilNote,
} from './council';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function note(over: Partial<CouncilNote>): CouncilNote {
  return {
    id: 'n',
    advisorId: 'a',
    text: 'Say one thing.',
    receipts: [],
    createdAt: ago(0),
    readAt: null,
    reaction: null,
    reactionNote: null,
    taskId: null,
    ...over,
  };
}

describe('when the daily round runs', () => {
  const quiet = { now: NOW, latest: null, unread: 0, writtenToday: 0, free: 16 };

  it('runs on a first day', () => {
    expect(decideAdviceRun(quiet)).toEqual({ start: true });
  });

  it('does not pile notes up while six are unread', () => {
    expect(decideAdviceRun({ ...quiet, unread: UNREAD_MAX })).toEqual({
      start: false,
      skipped: '6 council notes are unread',
    });
    expect(decideAdviceRun({ ...quiet, unread: UNREAD_MAX - 1 })).toEqual({ start: true });
  });

  it('stops at three a day', () => {
    expect(decideAdviceRun({ ...quiet, writtenToday: 3 }).start).toBe(false);
  });

  it('waits while every mentor has an unread note', () => {
    expect(decideAdviceRun({ ...quiet, free: 0 }).start).toBe(false);
  });

  it('runs once a day, and never two at once', () => {
    expect(decideAdviceRun({ ...quiet, latest: { status: 'ready', requestedAt: ago(ADVICE_GAP_MS - 60_000) } }).start).toBe(false);
    expect(decideAdviceRun({ ...quiet, latest: { status: 'ready', requestedAt: ago(ADVICE_GAP_MS + 60_000) } }).start).toBe(true);
    expect(decideAdviceRun({ ...quiet, latest: { status: 'running', requestedAt: ago(60_000) } })).toEqual({
      start: false,
      skipped: 'a council round is already queued or running',
    });
  });

  it('takes over from a round that stopped long ago', () => {
    const latest = { status: 'running', requestedAt: ago(Math.max(ADVICE_STALE_AFTER_MS, ADVICE_GAP_MS) + 60_000) };
    expect(decideAdviceRun({ ...quiet, latest })).toEqual({ start: true });
  });
});

describe('the overnight memory pass', () => {
  const quiet = { now: NOW, latest: null, unread: 0, writtenToday: 0, free: 16 };

  it('runs while the note caps are full when a conversation is due a summary', () => {
    expect(decideAdviceRun({ ...quiet, unread: UNREAD_MAX, episodesDue: 1 })).toEqual({ start: true });
    expect(decideAdviceRun({ ...quiet, writtenToday: 3, free: 0, episodesDue: 2 })).toEqual({ start: true });
    expect(decideAdviceRun({ ...quiet, unread: UNREAD_MAX, episodesDue: 0 }).start).toBe(false);
  });

  it('still runs once a day, and never two at once', () => {
    const latest = { status: 'running', requestedAt: ago(60_000) };
    expect(decideAdviceRun({ ...quiet, latest, episodesDue: 3 }).start).toBe(false);
    const recent = { status: 'ready', requestedAt: ago(ADVICE_GAP_MS - 60_000) };
    expect(decideAdviceRun({ ...quiet, latest: recent, episodesDue: 3 }).start).toBe(false);
  });

  it('summarises a conversation once three quiet hours have closed it', () => {
    expect(episodeDue({ endedAt: ago(EPISODE_QUIET_MS - 60_000), summarisedAt: null }, NOW)).toBe(false);
    expect(episodeDue({ endedAt: ago(EPISODE_QUIET_MS + 60_000), summarisedAt: null }, NOW)).toBe(true);
  });

  it('summarises again only a conversation that grew after its summary', () => {
    const endedAt = ago(EPISODE_QUIET_MS + 60 * 60_000);
    expect(episodeDue({ endedAt, summarisedAt: ago(60_000) }, NOW)).toBe(false);
    expect(episodeDue({ endedAt, summarisedAt: ago(EPISODE_QUIET_MS + 2 * 60 * 60_000) }, NOW)).toBe(true);
  });
});

describe("a mentor's reply", () => {
  const chat = { id: 'c', replyStatus: 'waiting' as const, replyRequestedAt: ago(60_000), replyError: null };

  it('is waiting while it is being written', () => {
    expect(replyState(chat, NOW)).toEqual({ kind: 'waiting' });
  });

  it('reads as failed once it has been waiting too long, so the person can send again', () => {
    expect(replyState({ ...chat, replyRequestedAt: ago(REPLY_STALE_AFTER_MS + 1) }, NOW)).toEqual({
      kind: 'failed',
      error: STALE_REPLY_ERROR,
    });
  });

  it('says why it failed', () => {
    expect(replyState({ ...chat, replyStatus: 'failed', replyError: 'No routine.' }, NOW)).toEqual({
      kind: 'failed',
      error: 'No routine.',
    });
    expect(replyState(null, NOW)).toEqual({ kind: 'idle' });
  });
});

describe('notes', () => {
  it('keeps only receipts that open in the app or on an https page', () => {
    expect(
      receiptsOf([
        { label: 'Brex', link: '/jobs/roles/1' },
        { label: 'Source', link: 'https://example.com' },
        { label: 'Bad', link: 'javascript:alert(1)' },
        { label: '', link: '/x' },
        'nope',
      ]),
    ).toEqual([
      { label: 'Brex', link: '/jobs/roles/1' },
      { label: 'Source', link: 'https://example.com' },
    ]);
  });

  it('drops a row without text and reads an unknown reaction as none', () => {
    expect(noteOf({ id: 'n', advisor_id: 'a', text: '  ' })).toBeNull();
    expect(noteOf({ id: 'n', advisor_id: 'a', text: 'Hi.', reaction: 'loved' })?.reaction).toBeNull();
  });

  it("finds each mentor's newest note, and the unread oldest first", () => {
    const notes = [
      note({ id: '3', advisorId: 'a', createdAt: ago(1_000) }),
      note({ id: '2', advisorId: 'b', createdAt: ago(2_000), readAt: ago(0) }),
      note({ id: '1', advisorId: 'a', createdAt: ago(3_000) }),
    ];
    expect(newestByAdvisor(notes).get('a')?.id).toBe('3');
    expect(unreadNotes(notes).map((n) => n.id)).toEqual(['1', '3']);
  });

  it("titles a todo with the note's first sentence", () => {
    expect(todoTitleFromNote('Send the Brex email today. It has waited a week.')).toBe('Send the Brex email today.');
    expect(todoTitleFromNote('x'.repeat(300))).toHaveLength(200);
  });
});

describe('the briefs the board routine is fired with', () => {
  it('names the council skill, the run and the person', () => {
    expect(adviceBrief({ runId: 'r', userId: 'u' })).toBe(
      'Follow .claude/skills/board/council.md\nCouncil advice r\nuser_id u',
    );
    expect(replyBrief({ runId: 'r', chatId: 'c', userId: 'u' })).toBe(
      'Follow .claude/skills/board/council.md\nCouncil reply r\nchat c\nuser_id u',
    );
  });
});

describe('a message', () => {
  it('must say something, and not too much', () => {
    expect(cleanMessage('  ')).toEqual({ ok: false, error: 'Write something first.' });
    expect(cleanMessage(' hello ')).toEqual({ ok: true, text: 'hello' });
    expect(cleanMessage('x'.repeat(4001)).ok).toBe(false);
  });
});
