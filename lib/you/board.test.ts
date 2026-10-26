import { describe, expect, it } from 'vitest';
import {
  meetingState,
  meetingTitle,
  nextMeetingDay,
  parseMinutes,
  plainText,
  progress,
  scorecardFrom,
  type BoardMark,
  type BoardMeeting,
} from '@/lib/you/board';

/** The Board tab's reading of the minutes and the person's marks (plan #2540.3). */

const meeting = (over: Partial<BoardMeeting> = {}): BoardMeeting => ({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'weekly',
  decision: null,
  status: 'ready',
  heldOn: '2026-10-25',
  error: null,
  runUrl: null,
  requestedAt: '2026-10-25T17:41:00Z',
  startedAt: '2026-10-25T17:42:00Z',
  finishedAt: '2026-10-25T18:20:00Z',
  ...over,
});

const mark = (kind: BoardMark['kind'], item: string, value: string): BoardMark => ({
  kind,
  item,
  value,
  note: null,
  todoId: null,
  markedAt: '2026-10-26T09:00:00Z',
});

describe('parseMinutes', () => {
  it('keeps what is well formed and drops what is not', () => {
    const minutes = parseMinutes({
      since: ' First meeting. ',
      disagreements: [
        {
          key: 'd1',
          point: 'Send or change first?',
          positions: [
            {
              seat: 'hiring_manager',
              text: 'Send.',
              receipts: [{ label: 'note', link: '/vault/n/a.md' }, { label: '' }],
            },
            { seat: 'landlord', text: 'Not a seat.' },
            { seat: 'skeptic', stance: 'against the board', text: 'Wait.' },
          ],
        },
        { key: 'Not A Key', point: 'Kept, but not votable', positions: [] },
        { point: '' },
      ],
      dream: { text: 'Music.', thread: 'One hour.', receipts: [] },
      question: 'Which?',
      resolutions: [
        { key: 'r1', what: 'Do it', day: '2026-10-26', seats: ['cfo', 'nobody'] },
        { key: 'r2', what: 'Undated', day: 'Monday' },
      ],
      graded: [
        { seat: 'mentor', text: 'Still at 0', grade: "can't tell" },
        { seat: 'cfo', text: 'Row says ignored', grade: 'hit', fact: 'It did.' },
        { seat: 'cfo', text: 'No grade', grade: 'maybe' },
      ],
      memos: [
        {
          seat: 'dreamer',
          memo: 'Make it.',
          rebuttal: { to: null, stance: 'against all', text: 'No.' },
        },
      ],
    });
    expect(minutes.since).toBe('First meeting.');
    expect(minutes.disagreements).toHaveLength(2);
    expect(minutes.disagreements[0].positions.map((p) => p.seat)).toEqual([
      'hiring_manager',
      'skeptic',
    ]);
    expect(minutes.disagreements[0].positions[0].receipts).toEqual([
      { label: 'note', link: '/vault/n/a.md' },
    ]);
    expect(minutes.disagreements[0].positions[1].stance).toBe('against the board');
    expect(minutes.disagreements[1].key).toBeNull();
    expect(minutes.resolutions[0]).toEqual({
      key: 'r1',
      what: 'Do it',
      day: '2026-10-26',
      seats: ['cfo'],
    });
    expect(minutes.resolutions[1].day).toBeNull();
    expect(minutes.graded.map((g) => g.grade)).toEqual(['cant_tell', 'hit']);
    expect(minutes.memos[0].rebuttal).toEqual({ to: null, stance: 'against all', text: 'No.' });
    expect(minutes.scorecard).toEqual([]);
  });

  it('reads anything that is not an object as empty minutes', () => {
    const minutes = parseMinutes(null);
    expect(minutes.disagreements).toEqual([]);
    expect(minutes.dream).toBeNull();
    expect(minutes.question).toBeNull();
  });
});

describe('scorecardFrom', () => {
  it('counts hits and misses for every seat across meetings, ignoring the ungraded', () => {
    const scores = scorecardFrom([
      [
        { seat: 'cfo', text: 'a', grade: 'hit', fact: null },
        { seat: 'mentor', text: 'b', grade: 'miss', fact: null },
      ],
      [
        { seat: 'cfo', text: 'c', grade: 'hit', fact: null },
        { seat: 'skeptic', text: 'd', grade: 'cant_tell', fact: null },
        { seat: 'dreamer', text: 'e', grade: 'pending', fact: null },
      ],
    ]);
    expect(scores).toEqual([
      { seat: 'hiring_manager', hits: 0, misses: 0 },
      { seat: 'mentor', hits: 0, misses: 1 },
      { seat: 'skeptic', hits: 0, misses: 0 },
      { seat: 'cfo', hits: 2, misses: 0 },
      { seat: 'dreamer', hits: 0, misses: 0 },
    ]);
  });
});

describe('progress', () => {
  it('counts the votes, the answer and the resolutions done', () => {
    const minutes = parseMinutes({
      disagreements: [
        { key: 'd1', point: 'One', positions: [] },
        { key: 'd2', point: 'Two', positions: [] },
      ],
      resolutions: [
        { key: 'r1', what: 'A' },
        { key: 'r2', what: 'B' },
      ],
    });
    expect(
      progress(minutes, [
        mark('vote', 'd1', 'cfo'),
        mark('resolution', 'r1', 'done'),
        mark('resolution', 'r2', 'open'),
      ]),
    ).toEqual({ disagreements: 2, voted: 1, resolutions: 2, done: 1, answered: false });
    expect(progress(minutes, [mark('answer', 'question', 'Both')]).answered).toBe(true);
  });
});

describe('meetingState', () => {
  const now = Date.parse('2026-10-25T18:00:00Z');
  it('shows a queued or running meeting as running, from when it started', () => {
    expect(meetingState(meeting({ status: 'running' }), now)).toEqual({
      kind: 'running',
      since: '2026-10-25T17:42:00Z',
    });
    expect(meetingState(meeting({ status: 'queued', startedAt: null }), now)).toEqual({
      kind: 'running',
      since: '2026-10-25T17:41:00Z',
    });
  });
  it('shows one open past three hours as failed', () => {
    const state = meetingState(meeting({ status: 'running' }), now + 4 * 60 * 60 * 1000);
    expect(state.kind).toBe('failed');
  });
  it('carries a failed meeting’s error and when it was asked for', () => {
    expect(meetingState(meeting({ status: 'failed', error: 'Overloaded.' }), now)).toEqual({
      kind: 'failed',
      error: 'Overloaded.',
      asked: '2026-10-25T17:41:00Z',
    });
  });
});

describe('meetingTitle and plainText', () => {
  it('names a weekly meeting by its day and a called one by its decision', () => {
    expect(meetingTitle(meeting())).toBe('Board meeting 25 Oct 2026');
    expect(meetingTitle(meeting({ kind: 'called', decision: 'Take the Mercor contract?' }))).toBe(
      'Take the Mercor contract?',
    );
    expect(meetingTitle(meeting({ heldOn: null, status: 'queued' }))).toBe('Board meeting');
  });
  it('takes the links and emphasis out of a resolution for a todo title', () => {
    expect(plainText('Publish [AI Systems Series 1](/vault/n/a.md) by **Tuesday**.')).toBe(
      'Publish AI Systems Series 1 by Tuesday.',
    );
  });
});

describe('nextMeetingDay', () => {
  it('is today on a Sunday before 6:41pm in their zone, else the coming Sunday', () => {
    // Sunday 25 Oct 2026, 17:00 in London (BST ends that morning, so UTC+0).
    expect(nextMeetingDay('Europe/London', Date.parse('2026-10-25T17:00:00Z'))).toBe('2026-10-25');
    expect(nextMeetingDay('Europe/London', Date.parse('2026-10-25T19:00:00Z'))).toBe('2026-11-01');
    // Monday 26 Oct.
    expect(nextMeetingDay('Europe/London', Date.parse('2026-10-26T09:00:00Z'))).toBe('2026-11-01');
    // Still Saturday evening in Los Angeles when it is Sunday in UTC.
    expect(nextMeetingDay('America/Los_Angeles', Date.parse('2026-10-25T03:00:00Z'))).toBe(
      '2026-10-25',
    );
    expect(nextMeetingDay('Not/AZone', Date.parse('2026-10-26T09:00:00Z'))).toBe('2026-11-01');
  });
});
