import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { docxText } from '@/lib/goals/docx';

/**
 * The files sent with the newest question, as Dash reads them (plan #1716,
 * feature #1711). A picture goes to the model as an image block and a PDF as
 * a document block, in the shape lib/goals/extract-model.ts already sends.
 * A Word, text or CSV file goes as its text. Earlier questions' files are
 * not sent again: the history names them (bodyWithFileNames in
 * lib/talk/talk.ts).
 *
 * A file that cannot be read is still named to Dash, with the reason, so the
 * answer can say so rather than act as though nothing was sent: an old .doc
 * (only .docx has a text reader here), a picture that cannot be opened or
 * made small enough, a PDF over its page limit, or files past what one request can carry.
 */

type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type DashFile =
  | { name: string; kind: 'image'; mediaType: ImageType; data: string }
  | { name: string; kind: 'pdf'; data: string }
  | { name: string; kind: 'text'; text: string }
  | { name: string; kind: 'unread'; why: string };

/** A picture over this is shrunk to a smaller copy when Dash reads it; the stored original is untouched. */
export const IMAGE_MAX_BYTES = 3_750_000;

/** The model reads a PDF of up to 100 pages. */
export const PDF_MAX_PAGES = 100;

/**
 * The most file bytes one question sends. A request is refused over 32 MB,
 * and base64 adds a third, so 20 MB of files leaves room for the rest.
 */
export const SEND_MAX_BYTES = 20 * 1024 * 1024;

/** A text file longer than this is cut, which is about 25,000 tokens. */
export const TEXT_MAX_CHARS = 100_000;

const IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * How many pages a PDF says it has, by counting its page objects, or null
 * when it keeps them where this cannot see (a compressed object stream).
 */
export function pdfPageCount(bytes: Uint8Array): number | null {
  const text = new TextDecoder('latin1').decode(bytes);
  const count = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return count > 0 ? count : null;
}

function cut(text: string): string {
  return text.length > TEXT_MAX_CHARS ? `${text.slice(0, TEXT_MAX_CHARS)}\n[cut here: the file goes on]` : text;
}

/**
 * The sizes tried, in order, on a picture over IMAGE_MAX_BYTES: the longest
 * side and the JPEG quality. 2000 px is more than the model looks at, and
 * 1568 px is the size it scales larger pictures down to anyway.
 */
const SHRINK_STEPS: readonly { side: number; quality: number }[] = [
  { side: 2000, quality: 85 },
  { side: 2000, quality: 70 },
  { side: 1568, quality: 70 },
  { side: 1568, quality: 50 },
];

/**
 * A smaller JPEG copy of a picture too large to send, or the reason there is
 * none. Only the copy sent to the model changes; the stored file is never
 * rewritten. A transparent PNG is flattened onto white, and a GIF gives its
 * first frame.
 */
async function shrinkImage(bytes: Uint8Array): Promise<{ data: Buffer } | { why: string }> {
  try {
    for (const { side, quality } of SHRINK_STEPS) {
      const data = await sharp(bytes)
        .rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality })
        .toBuffer();
      if (data.length <= IMAGE_MAX_BYTES) return { data };
    }
  } catch {
    return { why: 'the picture could not be opened' };
  }
  return { why: 'the picture could not be shrunk enough to read' };
}

/** One stored file, as Dash will read it. */
export async function readFile(name: string, contentType: string, bytes: Uint8Array): Promise<DashFile> {
  if (IMAGE_TYPES.has(contentType)) {
    if (bytes.length > IMAGE_MAX_BYTES) {
      const shrunk = await shrinkImage(bytes);
      if ('why' in shrunk) return { name, kind: 'unread', why: shrunk.why };
      return { name, kind: 'image', mediaType: 'image/jpeg', data: shrunk.data.toString('base64') };
    }
    return { name, kind: 'image', mediaType: contentType as ImageType, data: Buffer.from(bytes).toString('base64') };
  }
  if (contentType === 'application/pdf') {
    const pages = pdfPageCount(bytes);
    if (pages !== null && pages > PDF_MAX_PAGES) {
      return { name, kind: 'unread', why: `it has ${pages} pages and Dash reads up to ${PDF_MAX_PAGES}` };
    }
    return { name, kind: 'pdf', data: Buffer.from(bytes).toString('base64') };
  }
  if (contentType === DOCX) {
    const text = docxText(bytes);
    if (text === null) return { name, kind: 'unread', why: 'it could not be opened as a Word document' };
    return { name, kind: 'text', text: cut(text) };
  }
  if (contentType === 'text/plain' || contentType === 'text/csv') {
    return { name, kind: 'text', text: cut(new TextDecoder().decode(bytes)) };
  }
  if (contentType === 'application/msword') {
    return { name, kind: 'unread', why: 'an old .doc file cannot be read; saved as .docx or PDF it can' };
  }
  return { name, kind: 'unread', why: 'Dash cannot read this kind of file' };
}

/** The bytes a file costs the request: base64 is a third larger than the file. */
function sentBytes(file: DashFile): number {
  if (file.kind === 'image' || file.kind === 'pdf') return file.data.length;
  if (file.kind === 'text') return file.text.length;
  return 0;
}

/**
 * Keeps files in the order sent until the request would be too large; the
 * rest are named as unread.
 */
export function withinRequest(files: readonly DashFile[]): DashFile[] {
  let total = 0;
  const limit = Math.ceil((SEND_MAX_BYTES * 4) / 3);
  return files.map((file) => {
    const size = sentBytes(file);
    if (size === 0) return file;
    if (total + size > limit) {
      return { name: file.name, kind: 'unread', why: 'the files sent with this question are too large to read all at once' };
    }
    total += size;
    return file;
  });
}

/** The blocks that go before the question's words, in the order the files were sent. */
export function fileBlocks(files: readonly DashFile[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const unread: string[] = [];
  for (const file of files) {
    if (file.kind === 'image') {
      blocks.push({ type: 'text', text: `(Sent with this: ${file.name})` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
    } else if (file.kind === 'pdf') {
      blocks.push({
        type: 'document',
        title: file.name,
        source: { type: 'base64', media_type: 'application/pdf', data: file.data },
      });
    } else if (file.kind === 'text') {
      blocks.push({ type: 'text', text: `<file name="${file.name}">\n${file.text}\n</file>` });
    } else {
      unread.push(`${file.name} (${file.why})`);
    }
  }
  if (unread.length > 0) {
    blocks.push({ type: 'text', text: `(Also sent with this, but not readable: ${unread.join('; ')})` });
  }
  return blocks;
}
