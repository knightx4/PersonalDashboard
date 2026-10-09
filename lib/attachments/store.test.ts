import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { attachmentPath, type UploadedAttachment } from './rules';
import { listAttachments, recordAttachments, removeAttachmentsFor } from './store';

const USER = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';

type Row = Record<string, unknown>;

/**
 * Enough of supabase-js for the store: core.attachments in memory, filtered
 * by eq and in, and the bucket as a list of paths.
 */
function fakeClient() {
  const rows: Row[] = [];
  const bucket: string[] = [];
  let next = 0;

  function query(op: 'select' | 'insert' | 'delete', payload?: Row[]) {
    const filters: Array<(row: Row) => boolean> = [];
    const run = () => {
      if (op === 'insert') {
        const made = (payload ?? []).map((row) => ({
          id: `id-${++next}`,
          created_at: new Date(2026, 9, 9, 0, 0, next).toISOString(),
          ...row,
        }));
        rows.push(...made);
        return { data: made, error: null };
      }
      const hit = rows.filter((row) => filters.every((f) => f(row)));
      if (op === 'delete') {
        for (const row of hit) rows.splice(rows.indexOf(row), 1);
      }
      return { data: hit, error: null };
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      order: () => chain,
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => resolve(run()),
    };
    return chain;
  }

  const client = {
    from: () => ({
      select: () => query('select'),
      insert: (payload: Row[]) => query('insert', payload),
      delete: () => query('delete'),
    }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          for (const path of paths) bucket.splice(bucket.indexOf(path), 1);
          return { error: null };
        },
      }),
    },
  } as unknown as CoreSupabaseClient;

  return { client, rows, bucket };
}

function uploaded(id: string, name: string): UploadedAttachment {
  return {
    path: attachmentPath(USER, `0b9d3c1e-5a4f-4e7b-9c2d-8f6a1b3e5d7${id}`, name),
    name,
    contentType: 'image/png',
    size: 100,
  };
}

describe('the attachments store', () => {
  it('records files against a row and reads them back by its ref', async () => {
    const { client } = fakeClient();
    const shot = uploaded('1', 'shot.png');
    const made = await recordAttachments(client, USER, 'public.feedback_items:f1', [shot]);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: 'shot.png', ref: 'public.feedback_items:f1' });
    expect(made[0].href).toBe(`/attachments/${made[0].id}`);

    const byRef = await listAttachments(client, ['public.feedback_items:f1', 'todo.tasks:t1']);
    expect(byRef.get('public.feedback_items:f1')?.map((a) => a.path)).toEqual([shot.path]);
    expect(byRef.has('todo.tasks:t1')).toBe(false);
  });

  it('records a file against a row once', async () => {
    const { client, rows } = fakeClient();
    const shot = uploaded('1', 'shot.png');
    await recordAttachments(client, USER, 'todo.tasks:t1', [shot]);
    expect(await recordAttachments(client, USER, 'todo.tasks:t1', [shot])).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('refuses something that is not a ref, and a sixth file', async () => {
    const { client } = fakeClient();
    await expect(recordAttachments(client, USER, 'tasks', [uploaded('1', 'a.png')])).rejects.toThrow(
      /Not a row ref/,
    );
    const six = ['1', '2', '3', '4', '5', '6'].map((i) => uploaded(i, `${i}.png`));
    await expect(recordAttachments(client, USER, 'todo.tasks:t1', six)).rejects.toThrow(/five|5/);
  });

  it('keeps a file two rows share until the second row goes', async () => {
    const { client, bucket } = fakeClient();
    const letter = uploaded('1', 'letter.png');
    bucket.push(letter.path);
    await recordAttachments(client, USER, 'todo.tasks:t1', [letter]);
    await recordAttachments(client, USER, 'goals.items:g1', [letter]);

    expect(await removeAttachmentsFor(client, 'todo.tasks:t1')).toEqual([]);
    expect(bucket).toEqual([letter.path]);

    expect(await removeAttachmentsFor(client, 'goals.items:g1')).toEqual([letter.path]);
    expect(bucket).toEqual([]);
  });
});
