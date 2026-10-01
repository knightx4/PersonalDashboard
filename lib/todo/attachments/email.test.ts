import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/todo/auth/server', () => ({ createTodoClient: vi.fn() }));
vi.mock('@/lib/todo/attachments/store', () => ({ linkAttachment: vi.fn() }));
vi.mock('@/lib/email/providers/gmail', () => ({}));

const { chooseFiles } = await import('./email');

const file = (over: Partial<Parameters<typeof chooseFiles>[0][number]>) => ({
  filename: 'x.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 50_000,
  attachmentId: 'att',
  inlineData: null,
  ...over,
});

describe('chooseFiles', () => {
  it('keeps a ticket PDF and drops logos, empty files and kinds that cannot be stored', () => {
    const { keep, skipped } = chooseFiles([
      file({ filename: 'Madeon tickets.pdf' }),
      file({ filename: 'logo.png', mimeType: 'image/png', sizeBytes: 2_000 }),
      file({ filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 400_000 }),
      file({ filename: 'empty.pdf', sizeBytes: 0 }),
      file({ filename: 'tracker.html', mimeType: 'text/html' }),
      file({ filename: 'huge.pdf', sizeBytes: 30_000_000 }),
    ]);
    expect(keep.map((f) => f.name)).toEqual(['Madeon tickets.pdf', 'photo.jpg']);
    expect(skipped).toBe(4);
  });

  it('keeps at most ten', () => {
    const many = Array.from({ length: 14 }, (_, i) => file({ filename: `t${i}.pdf` }));
    expect(chooseFiles(many).keep).toHaveLength(10);
  });
});
