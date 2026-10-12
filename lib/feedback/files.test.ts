import { describe, expect, it } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { FeedbackRow } from '@/lib/feedback/load';
import { noteFilesBrief, noteRef, withNoteFiles } from './files';

const NOTE = '0f1e2d3c-4b5a-4968-8776-655443322110';

function row(id: string): FeedbackRow {
  return {
    id,
    kind: 'bug',
    body: 'The plan page scrolls sideways',
    pagePath: '/dev/plan',
    status: 'open',
    priority: 2,
    resolutionNote: null,
    commitSha: null,
    createdAt: '2026-10-09T09:00:00Z',
    completedAt: null,
    thread: [],
  };
}

/** A core client whose attachments read answers with these rows. */
function client(rows: unknown[] | Error): CoreSupabaseClient {
  const query = {
    select: () => query,
    in: () => query,
    order: async () =>
      rows instanceof Error ? { data: null, error: rows } : { data: rows, error: null },
  };
  return { from: () => query } as unknown as CoreSupabaseClient;
}

describe('noteRef', () => {
  it('names the note the way core.attachments records it', () => {
    expect(noteRef(NOTE)).toBe(`public.feedback_items:${NOTE}`);
  });
});

describe('withNoteFiles', () => {
  it('puts each note’s files on it and an empty list on the rest', async () => {
    const rows = [row(NOTE), row('11111111-2222-4333-8444-555555555555')];
    await withNoteFiles(
      client([
        {
          id: 'a1',
          ref: noteRef(NOTE),
          path: 'u/p.png',
          name: 'p.png',
          content_type: 'image/png',
          size_bytes: 10,
          created_at: '2026-10-09T09:00:00Z',
        },
      ]),
      rows,
    );
    expect(rows[0].attachments?.map((file) => [file.name, file.href])).toEqual([
      ['p.png', '/attachments/a1'],
    ]);
    expect(rows[1].attachments).toEqual([]);
  });

  it('leaves the notes as they were when the read fails', async () => {
    const rows = [row(NOTE)];
    await withNoteFiles(client(new Error('down')), rows);
    expect(rows[0].attachments).toBeUndefined();
  });
});

describe('noteFilesBrief', () => {
  it('says nothing when no note has files', () => {
    expect(noteFilesBrief([])).toBeNull();
  });

  it('lists each file under its note with its link', () => {
    const brief = noteFilesBrief([
      { noteId: NOTE, name: 'p.png', contentType: 'image/png', url: 'https://x/sign/p' },
    ]);
    expect(brief).toContain('12 hours');
    expect(brief).toContain('- note 0f1e2d3c: p.png (image/png) https://x/sign/p');
  });
});
