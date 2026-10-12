/**
 * The "Add a file" picker (plan #1712), as a form draws it before and after
 * files are chosen.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/auth/client', () => ({ createClient: () => ({}) }));

import { AddFile, filesFromPaste } from '@/components/attachments/add-file';
import type { UploadedAttachment } from '@/lib/attachments/rules';

const USER = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';

function shot(n: number): UploadedAttachment {
  return {
    path: `${USER}/0b9d3c1e-5a4f-4e7b-9c2d-8f6a1b3e5d7${n}-shot.png`,
    name: `Screenshot ${n}.png`,
    contentType: 'image/png',
    size: 250_000,
  };
}

describe('AddFile', () => {
  it('offers the button with nothing chosen and writes an empty list', () => {
    const html = renderToStaticMarkup(<AddFile value={[]} onChange={() => {}} name="files" />);
    expect(html).toContain('Add a file');
    expect(html).toContain('name="files" value="[]"');
    expect(html).not.toContain('Files to add');
  });

  it('shows each chosen file with its size and a way to take it off', () => {
    const files = [shot(1), shot(2)];
    const html = renderToStaticMarkup(<AddFile value={files} onChange={() => {}} name="files" />);
    expect(html).toContain('Screenshot 1.png');
    expect(html).toContain('244 KB');
    expect(html).toContain('aria-label="Remove Screenshot 2.png"');
    expect(html).toContain(`value="${JSON.stringify(files).replace(/"/g, '&quot;')}"`);
  });

  it('holds the button once an item has five files', () => {
    const html = renderToStaticMarkup(
      <AddFile value={[1, 2, 3, 4, 5].map(shot)} onChange={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Add a file/);
  });
});

/** A paste's clipboard, as much of DataTransfer as filesFromPaste reads. */
function clipboard(files: File[], text = ''): DataTransfer {
  return { files, getData: (type: string) => (type === 'text/plain' ? text : '') } as unknown as DataTransfer;
}

describe('filesFromPaste', () => {
  it('numbers each copied picture on from the files already added', () => {
    const files = filesFromPaste(
      clipboard([new File(['a'], 'image.png', { type: 'image/png' }), new File(['b'], '', { type: 'image/jpeg' })]),
      2,
    );
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ['Pasted image 3.png', 'image/png'],
      ['Pasted image 4.jpg', 'image/jpeg'],
    ]);
  });

  it('keeps the name of a file copied with one of its own', () => {
    const report = new File(['c'], 'Report.pdf', { type: 'application/pdf' });
    expect(filesFromPaste(clipboard([report]), 0)).toEqual([report]);
  });

  it('leaves a paste that carries text to the box, and finds nothing in a text-only paste', () => {
    const picture = new File(['a'], 'image.png', { type: 'image/png' });
    expect(filesFromPaste(clipboard([picture], 'A paragraph with a picture'), 0)).toEqual([]);
    expect(filesFromPaste(clipboard([], 'Just words'), 0)).toEqual([]);
  });
});
