import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { Pick, Sample } from './channel-judge';

/**
 * Keeping a found channel's good samples in Videos (plan #1197). The database
 * is held in memory and the transcript cut is a spy, so what is checked is
 * what reaches watch_list and catalogue_items.
 */

const cutStoredTranscript = vi.fn<(learn: unknown, videoId: string) => Promise<number>>(async () => 4);
vi.mock('./transcripts', () => ({ cutStoredTranscript }));

const { keepGoodSamples, samplesToKeep } = await import('./keep-samples');

type Row = Record<string, unknown>;

function fakeLearn(tables: Record<string, Row[]>) {
  let nextId = 0;
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let upsert: { rows: Row[]; onConflict: string; ignore: boolean } | null = null;
    const run = () => {
      const rows = (tables[table] ??= []);
      if (upsert) {
        const keys = upsert.onConflict.split(',');
        const written: Row[] = [];
        for (const row of upsert.rows) {
          const found = rows.find((existing) => keys.every((key) => existing[key] === row[key]));
          if (found && upsert.ignore) continue;
          if (found) Object.assign(found, row);
          else rows.push({ id: `${table}-${++nextId}`, ...row });
          written.push(found ?? rows[rows.length - 1]);
        }
        return { data: written, error: null };
      }
      return { data: rows.filter((row) => filters.every((filter) => filter(row))), error: null };
    };
    const builder = {
      select: () => builder,
      order: () => builder,
      or: () => builder,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, list: unknown[]) => (filters.push((row) => list.includes(row[column])), builder),
      upsert: (rows: Row[], options: { onConflict: string; ignoreDuplicates?: boolean }) => (
        (upsert = { rows, onConflict: options.onConflict, ignore: options.ignoreDuplicates ?? false }), builder
      ),
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  return { from } as unknown as LearnSupabaseClient;
}

const USER = 'user-1';
const SUBJECT = 'subject-1';
const CHANNEL = { youtube_channel_id: `UC${'a'.repeat(22)}`, title: 'Channel A' };

function sample(id: string, verdict: Sample['verdict']): Sample {
  return {
    video_id: id,
    title: `Video ${id}`,
    verdict,
    line: `Why ${id}.`,
    judged_from: 'transcript',
    best_start_seconds: 60,
    best_end_seconds: 300,
    stretches: [{ startSeconds: 60, endSeconds: 300, point: 'The core idea.' }],
  };
}

const pick = (id: string): Pick => ({ video_id: id, title: `Video ${id}`, duration_seconds: 900, description: 'About it.' });

describe('samplesToKeep', () => {
  it('keeps watch and card, and leaves skip on the channel row', () => {
    const kept = samplesToKeep([sample('a0000000001', 'watch'), sample('a0000000002', 'skip'), sample('a0000000003', 'card')]);
    expect(kept.map((s) => s.verdict)).toEqual(['watch', 'card']);
  });
});

describe('keepGoodSamples', () => {
  it('lists watch and card samples under the subject, reusing catalogue rows and leaving your list alone', async () => {
    const tables: Record<string, Row[]> = {
      catalogue_providers: [{ id: 'list-provider', slug: 'youtube-list', youtube_channel_id: null }],
      catalogue_items: [{ id: 'item-known', kind: 'video', external_id: 'a0000000003', provider_id: 'other' }],
      watch_list: [{ id: 'mine', user_id: USER, video_id: 'a0000000004', came_from: 'playlist', verdict: 'skip', verdict_by: 'you' }],
    };
    const samples = [
      sample('a0000000001', 'watch'),
      sample('a0000000002', 'skip'),
      sample('a0000000003', 'card'),
      sample('a0000000004', 'card'),
    ];
    const kept = await keepGoodSamples(fakeLearn(tables), {
      userId: USER,
      subjectId: SUBJECT,
      channel: CHANNEL,
      picks: samples.map((s) => pick(s.video_id)),
      samples,
      now: new Date('2026-09-29T12:00:00Z'),
    });

    expect(kept).toBe(2);
    // A new video is stored under the list provider with the channel as author.
    const stored = tables.catalogue_items.find((row) => row.external_id === 'a0000000001');
    expect(stored).toMatchObject({ provider_id: 'list-provider', kind: 'video', author: 'Channel A', duration_seconds: 900 });
    expect(tables.catalogue_items.some((row) => row.external_id === 'a0000000002')).toBe(false);

    const byVideo = new Map(tables.watch_list.map((row) => [row.video_id, row]));
    expect(byVideo.get('a0000000001')).toMatchObject({
      came_from: 'channel search',
      subject_id: SUBJECT,
      item_id: stored!.id,
      verdict: 'watch',
      judge_verdict: 'watch',
      verdict_by: 'judge',
      why: 'Why a0000000001.',
      best_start_seconds: 60,
      best_end_seconds: 300,
      judged_from: 'transcript',
    });
    expect(byVideo.get('a0000000003')).toMatchObject({ item_id: 'item-known', verdict: 'card', subject_id: SUBJECT });
    expect(byVideo.get('a0000000003')!.stretches).toHaveLength(1);
    expect(byVideo.has('a0000000002')).toBe(false);
    // Already on your list: what you decided stands.
    expect(byVideo.get('a0000000004')).toMatchObject({ came_from: 'playlist', verdict: 'skip', verdict_by: 'you' });

    expect(cutStoredTranscript.mock.calls.map(([, id]) => id)).toEqual(['a0000000001', 'a0000000003', 'a0000000004']);
  });

  it('does nothing when every sample was skipped', async () => {
    cutStoredTranscript.mockClear();
    const tables: Record<string, Row[]> = { watch_list: [] };
    const kept = await keepGoodSamples(fakeLearn(tables), {
      userId: USER,
      subjectId: SUBJECT,
      channel: CHANNEL,
      picks: [],
      samples: [sample('a0000000009', 'skip')],
    });
    expect(kept).toBe(0);
    expect(tables.watch_list).toHaveLength(0);
    expect(cutStoredTranscript).not.toHaveBeenCalled();
  });
});
