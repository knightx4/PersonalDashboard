/**
 * The "Add a file" picker (plan #1712), as a form draws it before and after
 * files are chosen.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/auth/client', () => ({ createClient: () => ({}) }));

import { AddFile } from '@/components/attachments/add-file';
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
