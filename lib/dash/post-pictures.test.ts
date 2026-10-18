import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AskContext } from '@/lib/ask/db';
import type { ModuleId } from '@/lib/modules';
import { listPostPictures, pictureOf, postPicturesLookup } from './post-pictures';
import { executeAskTool } from '@/lib/ask/tools';

const ALL: ModuleId[] = ['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'you', 'dev'];

function ctx(owner: boolean, enabledModules: ModuleId[] = ALL): AskContext {
  return {
    userId: 'me',
    today: '2026-10-18',
    enabledModules,
    db: async () => ({ rpc: async () => ({ data: owner, error: null }) }) as never,
    searchSources: [],
    now: Date.parse('2026-10-18T12:00:00Z'),
  };
}

async function folder(files: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'post-pictures-'));
  for (const f of files) await writeFile(path.join(dir, f), 'x');
  return dir;
}

describe('pictureOf', () => {
  it('reads the day, surface and workspace from the file name', () => {
    expect(pictureOf('2026-10-09-vault-note.png')).toEqual({
      file: '2026-10-09-vault-note.png',
      path: '/posts/2026-10-09-vault-note.png',
      date: '2026-10-09',
      surface: 'vault-note',
      workspace: 'vault',
      label: 'Vault: note',
    });
    expect(pictureOf('2026-10-02-dev-plan-tree.png')?.label).toBe('Dev: plan tree');
  });

  it('keeps a surface that starts with no workspace, without one', () => {
    const p = pictureOf('2026-10-09-ask-sheet.png');
    expect(p?.workspace).toBeNull();
    expect(p?.label).toBe('Ask sheet');
  });

  it('refuses a file that is not named as a picture', () => {
    expect(pictureOf('notes.txt')).toBeNull();
    expect(pictureOf('2026-10-09-vault-note.jpg')).toBeNull();
    expect(pictureOf('vault-note.png')).toBeNull();
    expect(pictureOf('2026-10-09-../x.png')).toBeNull();
  });
});

describe('listPostPictures', () => {
  it('lists the files on disk, newest day first, and skips what is not a picture', async () => {
    const dir = await folder([
      '2026-10-09-vault-note.png',
      '2026-10-15-goals-page-steps.png',
      '2026-10-15-dev-plan-tree.png',
      '.gitkeep',
      'readme.md',
    ]);
    const list = await listPostPictures(dir);
    expect(list.map((p) => p.file)).toEqual([
      '2026-10-15-dev-plan-tree.png',
      '2026-10-15-goals-page-steps.png',
      '2026-10-09-vault-note.png',
    ]);
  });

  it('is empty for a folder that does not exist', async () => {
    expect(await listPostPictures(path.join(tmpdir(), 'no-such-post-pictures'))).toEqual([]);
  });

  it('lists every picture committed under public/posts/', async () => {
    const real = (await readdir(path.join(process.cwd(), 'public/posts'))).filter((f) => f.endsWith('.png'));
    const list = await listPostPictures();
    expect(list.length).toBe(real.length);
    expect(list.find((p) => p.surface === 'home-page')).toMatchObject({ workspace: null, label: 'Home page' });
  });
});

describe('postPicturesLookup', () => {
  it("returns each picture as a linked row with its labels, for the owner", async () => {
    const dir = await folder(['2026-10-09-vault-note.png', '2026-10-12-jobs-today.png']);
    const result = await postPicturesLookup(ctx(true), {}, dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => [r.ref, r.title, r.href])).toEqual([
      ['/posts/2026-10-12-jobs-today.png', 'Job search: today', '/posts/2026-10-12-jobs-today.png'],
      ['/posts/2026-10-09-vault-note.png', 'Vault: note', '/posts/2026-10-09-vault-note.png'],
    ]);
    expect(result.rows[0].detail).toMatchObject({ workspace: 'jobs', surface: 'jobs-today', date: '2026-10-12' });
  });

  it('keeps one workspace when asked', async () => {
    const dir = await folder(['2026-10-09-vault-note.png', '2026-10-12-jobs-today.png']);
    const result = await postPicturesLookup(ctx(true), { workspace: 'vault' }, dir);
    expect(result.ok && result.rows.map((r) => r.detail?.surface)).toEqual(['vault-note']);
    const none = await postPicturesLookup(ctx(true), { workspace: 'news' }, dir);
    expect(none).toMatchObject({ ok: true, rows: [] });
  });

  it('is refused for someone who is not the owner, and with Dev off', async () => {
    const dir = await folder(['2026-10-09-vault-note.png']);
    expect((await postPicturesLookup(ctx(false), {}, dir)).ok).toBe(false);
    expect((await postPicturesLookup(ctx(true, ['vault']), {}, dir)).ok).toBe(false);
  });

  it('runs as the post_pictures tool Dash is given', async () => {
    const result = await executeAskTool('post_pictures', { workspace: 'vault' }, ctx(true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.href).toMatch(/^\/posts\/.+\.png$/);
      expect(row.detail?.workspace).toBe('vault');
    }
  });
});
