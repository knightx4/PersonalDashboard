/**
 * A note's embedded files, rendered (plan #1302).
 *
 * One fixture note embeds each case the note page has to tell apart: an
 * image, a sized image, a PDF, a recording, a file that is not in the vault,
 * one over 50 MB, one not copied yet and one of a type the sync never keeps.
 * The note goes through the same two passes as on the page: the Obsidian
 * rewrite, then the renderer with the vault's attachment rows.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteBody } from '@/components/vault/note-body';
import {
  buildAttachmentIndex,
  readSize,
  resolveAttachment,
  type AttachmentEntry,
} from '@/lib/vault/markdown/attachments';
import { buildLinkIndex, toStandardMarkdown } from '@/lib/vault/markdown/obsidian';
import { noteHref } from '@/lib/vault/paths';

const USER = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';

function entry(
  id: string,
  path: string,
  mimeType: AttachmentEntry['mimeType'],
  copied = true,
  sizeBytes = 1_000,
): AttachmentEntry {
  return { id, path, sizeBytes, mimeType, storagePath: copied ? `${USER}/c/${id}` : null };
}

const ROWS: AttachmentEntry[] = [
  entry('a1', 'Attachments/Beach day.png', 'image/png'),
  entry('a2', 'Attachments/floor-plan.jpg', 'image/jpeg'),
  entry('a3', 'Money/lease.pdf', 'application/pdf'),
  entry('a4', 'Audio/voice memo.m4a', 'audio/mp4'),
  entry('a5', 'Scans/tax-return.pdf', 'application/pdf', false, 60_000_000),
  entry('a6', 'Attachments/receipt.webp', 'image/webp', false),
];

const FIXTURE = [
  '# Moving flat',
  '',
  '![[Beach day.png]]',
  '',
  '![[floor-plan.jpg|300]]',
  '',
  'The lease: ![[lease.pdf]]',
  '',
  '![[voice memo.m4a]]',
  '',
  '![[gone.png]]',
  '',
  '![[tax-return.pdf]]',
  '',
  '![[receipt.webp]]',
  '',
  '![[sketch.svg]]',
  '',
  '![a chart](https://example.com/chart.png)',
].join('\n');

function render(source: string, notePath = 'Home/Moving flat.md'): string {
  const markdown = toStandardMarkdown(source, { index: buildLinkIndex([]), hrefFor: noteHref });
  return renderToStaticMarkup(
    <NoteBody markdown={markdown} notePath={notePath} attachments={buildAttachmentIndex(ROWS)} />,
  );
}

describe('the fixture note', () => {
  const html = render(FIXTURE);

  it('shows an image from its signed-link route', () => {
    expect(html).toMatch(/<img src="\/vault\/attachment\/a1" alt="Beach day.png" loading="lazy"/);
  });

  it("draws a sized image at Obsidian's width", () => {
    expect(html).toMatch(/<img src="\/vault\/attachment\/a2" alt="floor-plan.jpg"[^>]* width="300"/);
    // The size is a size, not part of what a screen reader hears.
    expect(html).not.toContain('floor-plan.jpg|300');
  });

  it('opens a PDF in the browser from a link', () => {
    expect(html).toMatch(/<a href="\/vault\/attachment\/a3" target="_blank"[^>]*>.*lease\.pdf<\/a>/);
  });

  it('plays a recording in place', () => {
    expect(html).toContain('<audio controls="" preload="none" src="/vault/attachment/a4"');
  });

  it('says which file is missing, too large, waiting, or never kept', () => {
    expect(html).toContain('gone.png: not in the vault');
    expect(html).toContain('tax-return.pdf: over 50 MB, so not kept');
    expect(html).toContain('receipt.webp: not copied from the vault yet');
    expect(html).toContain('sketch.svg: this type of file is not kept');
    expect(html).not.toContain('attachment not synced');
  });

  it('never links a file it has no copy of', () => {
    expect(html).not.toContain('/vault/attachment/a5');
    expect(html).not.toContain('/vault/attachment/a6');
  });

  it('still keeps an image on another host as a label', () => {
    expect(html).toContain('(image: a chart)');
    expect(html).not.toContain('example.com');
  });
});

describe('markdown embeds', () => {
  it('resolves a relative path with its spaces encoded, and a size in the alt', () => {
    const html = render('![beach|200](../Attachments/Beach%20day.png)', 'Home/Moving flat.md');
    expect(html).toMatch(/<img src="\/vault\/attachment\/a1" alt="beach"[^>]* width="200"/);
  });

  it('resolves a path from the vault root', () => {
    expect(render('![](Money/lease.pdf)')).toContain('href="/vault/attachment/a3"');
  });
});

describe('resolveAttachment', () => {
  const index = buildAttachmentIndex([
    entry('deep', 'Archive/2019/photo.png', 'image/png'),
    entry('near', 'Photos/photo.png', 'image/png'),
    entry('local', 'Trips/img/photo.png', 'image/png'),
  ]);

  it('takes the shortest path for a bare filename, as links do', () => {
    expect(resolveAttachment('photo.png', 'Inbox.md', index)?.id).toBe('near');
  });

  it("prefers the file beside the note for a relative path", () => {
    expect(resolveAttachment('./img/photo.png', 'Trips/Rome.md', index)?.id).toBe('local');
  });

  it('matches regardless of case', () => {
    expect(resolveAttachment('PHOTOS/Photo.PNG', 'Inbox.md', index)?.id).toBe('near');
  });

  it('does not climb out of the vault', () => {
    expect(resolveAttachment('../../x/photo.png', 'Inbox.md', index)?.id).toBe('near');
  });
});

describe('readSize', () => {
  it('reads a width, and a width by height', () => {
    expect(readSize('plan|300')).toEqual({ alt: 'plan', width: 300, height: null });
    expect(readSize('plan|300x200')).toEqual({ alt: 'plan', width: 300, height: 200 });
  });

  it('leaves an alt with a pipe but no size alone', () => {
    expect(readSize('this|that')).toEqual({ alt: 'this|that', width: null, height: null });
  });
});
