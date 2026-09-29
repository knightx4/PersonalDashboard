import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { ChannelRow, ListChannelResult } from './library';

/**
 * Following and passing found channels once judged (plan #1198), and
 * unfollowing them. The database is held in memory and the library's
 * writes are spies, so what is checked is what reaches subject_channels and
 * what the library is asked to do.
 */

const { settleJudgedChannels, unfollowSubjectChannel } = await import('./follow-channel');

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let update: Row | null = null;
    let single = false;
    const run = () => {
      const rows = (tables[table] ??= []).filter((row) => filters.every((filter) => filter(row)));
      if (update) {
        for (const row of rows) Object.assign(row, update);
        return { data: null, error: null };
      }
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      update: (fields: Row) => ((update = fields), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), builder),
      not: (column: string, _op: 'is', value: null) => (filters.push((row) => (row[column] ?? null) !== value), builder),
      maybeSingle: () => ((single = true), builder),
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  return { from } as unknown as LearnSupabaseClient;
}

const USER = 'user-1';
const SUBJECT = 'subject-1';
const NOW = new Date('2026-09-29T10:00:00Z');
const channelId = (letter: string) => `UC${letter.repeat(22)}`;

function channelRow(id: string, letter: string, verdict: 'follow' | 'pass' | null, decided: string | null = null): Row {
  return {
    id,
    user_id: USER,
    subject_id: SUBJECT,
    youtube_channel_id: channelId(letter),
    title: `Channel ${letter.toUpperCase()}`,
    verdict,
    decided,
    decided_at: decided ? NOW.toISOString() : null,
  };
}

const listing: ListChannelResult = {
  newVideos: 12,
  queued: 0,
  playlistsWalked: 1,
  playlistsSkipped: 0,
  playlistsNotReached: 0,
  error: null,
};

function fakeLibrary(refuse: string[] = []) {
  const provider = (raw: string): ChannelRow => ({
    id: `prov-${raw}`,
    slug: `slug-${raw.slice(2, 5)}`,
    name: raw,
    youtube_channel_id: raw,
    youtube_handle: null,
    youtube_uploads_playlist_id: `UU${raw.slice(2)}`,
    youtube_listed_at: null,
    auto_transcribe: false,
  });
  return {
    add: vi.fn(async (_learn: unknown, raw: string) =>
      refuse.includes(raw)
        ? ({ ok: false, error: 'YouTube did not answer: quota' } as const)
        : ({ ok: true, channel: provider(raw), created: true } as const),
    ),
    list: vi.fn(async () => listing),
    remove: vi.fn<(learn: unknown, providerId: string) => Promise<void>>(async () => {}),
  };
}

describe('settleJudgedChannels', () => {
  it('follows a channel judged follow, lists it, and marks a pass passed', async () => {
    const tables = {
      subject_channels: [channelRow('a', 'a', 'follow'), channelRow('b', 'b', 'pass'), channelRow('c', 'c', null)],
    };
    const library = fakeLibrary();
    const result = await settleJudgedChannels(fakeLearn(tables), { userId: USER, subjectId: SUBJECT, now: () => NOW, library });

    expect(library.add).toHaveBeenCalledTimes(1);
    expect(library.add.mock.calls[0][1]).toBe(channelId('a'));
    expect(library.list).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ followed: [{ id: 'a', listing }], passed: 1, failed: [] });
    expect(tables.subject_channels.map((row) => row.decided)).toEqual(['followed', 'passed', null]);
    expect(tables.subject_channels[0].decided_at).toBe(NOW.toISOString());
  });

  it('leaves a channel YouTube would not add undecided, for the next run', async () => {
    const tables = { subject_channels: [channelRow('a', 'a', 'follow')] };
    const library = fakeLibrary([channelId('a')]);
    const result = await settleJudgedChannels(fakeLearn(tables), { userId: USER, subjectId: SUBJECT, now: () => NOW, library });

    expect(result.failed).toHaveLength(1);
    expect(tables.subject_channels[0]).toMatchObject({ decided: null, decided_at: null });

    const again = await settleJudgedChannels(fakeLearn(tables), { userId: USER, subjectId: SUBJECT, now: () => NOW, library: fakeLibrary() });
    expect(again.followed).toHaveLength(1);
    expect(tables.subject_channels[0].decided).toBe('followed');
  });

  it('adds without listing when the run is nearly out of time', async () => {
    const tables = { subject_channels: [channelRow('a', 'a', 'follow')] };
    const library = fakeLibrary();
    const result = await settleJudgedChannels(fakeLearn(tables), {
      userId: USER,
      subjectId: SUBJECT,
      deadline: Date.now() + 10_000,
      now: () => NOW,
      library,
    });
    expect(library.add).toHaveBeenCalledTimes(1);
    expect(library.list).not.toHaveBeenCalled();
    expect(result.followed[0].listing).toBeNull();
    expect(tables.subject_channels[0].decided).toBe('followed');
  });

  it('touches nothing already decided or belonging to somebody else', async () => {
    const tables = {
      subject_channels: [channelRow('a', 'a', 'follow', 'unfollowed'), { ...channelRow('b', 'b', 'follow'), user_id: 'someone-else' }],
    };
    const library = fakeLibrary();
    const result = await settleJudgedChannels(fakeLearn(tables), { userId: USER, subjectId: SUBJECT, now: () => NOW, library });
    expect(library.add).not.toHaveBeenCalled();
    expect(result).toEqual({ followed: [], passed: 0, failed: [] });
  });
});

describe('unfollowSubjectChannel', () => {
  it('takes the channel out of the library and marks the row unfollowed', async () => {
    const tables = {
      subject_channels: [channelRow('a', 'a', 'follow', 'followed')],
      catalogue_providers: [{ id: 'prov-a', youtube_channel_id: channelId('a') }],
    };
    const library = fakeLibrary();
    const result = await unfollowSubjectChannel(fakeLearn(tables), { userId: USER, channelRowId: 'a', now: () => NOW, library });

    expect(result).toEqual({ ok: true, title: 'Channel A', library: 'removed' });
    expect(library.remove.mock.calls[0][1]).toBe('prov-a');
    expect(tables.subject_channels[0].decided).toBe('unfollowed');
  });

  it('keeps the channel in the library while another subject follows it', async () => {
    const tables = {
      subject_channels: [channelRow('a', 'a', 'follow', 'followed'), { ...channelRow('a2', 'a', 'follow', 'followed'), subject_id: 'subject-2' }],
      catalogue_providers: [{ id: 'prov-a', youtube_channel_id: channelId('a') }],
    };
    const library = fakeLibrary();
    const result = await unfollowSubjectChannel(fakeLearn(tables), { userId: USER, channelRowId: 'a', now: () => NOW, library });

    expect(result).toMatchObject({ ok: true, library: 'kept' });
    expect(library.remove).not.toHaveBeenCalled();
  });

  it('refuses a channel that is not followed, or not yours', async () => {
    const tables = { subject_channels: [channelRow('b', 'b', 'pass', 'passed')] };
    const library = fakeLibrary();
    expect(await unfollowSubjectChannel(fakeLearn(tables), { userId: USER, channelRowId: 'b', library })).toMatchObject({ ok: false });
    expect(await unfollowSubjectChannel(fakeLearn(tables), { userId: 'someone-else', channelRowId: 'b', library })).toMatchObject({
      ok: false,
    });
    expect(tables.subject_channels[0].decided).toBe('passed');
    expect(library.remove).not.toHaveBeenCalled();
  });
});
