import type Anthropic from '@anthropic-ai/sdk';
import { ATTACHMENT_MAX_BYTES, attachmentContentType, type AttachmentContentType } from '@/lib/attachments/rules';

/**
 * The files a bot's code makes while it answers (plan #3050.3.1).
 *
 * A bot on People may run code on Anthropic's side (the code execution
 * tool), and a picture or a PDF its code writes comes back as a file id in
 * the code's result. Those files live in Anthropic's file store, not ours:
 * this reads each through the Files API so the reply can keep it in
 * core.attachments against its bubble, the store the person's own files use
 * (lib/you/chat-message-files.ts keepMadeFiles).
 *
 * Four files a reply at most, each within the attachments bucket's 20 MB and
 * of a type it takes. A file that cannot be kept is named with the reason,
 * and the reply says so in a text of its own (madeFilesNote).
 *
 * No database here; the Anthropic client is handed in, so the tests stub it.
 */

/** The code execution tool, offered beside web search. */
export function dashCodeExecution(): Anthropic.ToolUnion {
  return { type: 'code_execution_20260521', name: 'code_execution' } as unknown as Anthropic.ToolUnion;
}

/** The most files one reply keeps; core.attachments takes five to a row. */
export const MAX_MADE_FILES = 4;

type Block = { type: string; content?: unknown };

/**
 * Every file id the code in one response wrote, in order, once each. Reads
 * the bash results of `code_execution_20260521` and the older
 * `code_execution_tool_result`; a run that failed returns an error object
 * and adds nothing.
 */
export function madeFileIds(content: readonly Block[]): string[] {
  const ids: string[] = [];
  for (const block of content) {
    if (block.type !== 'bash_code_execution_tool_result' && block.type !== 'code_execution_tool_result') continue;
    const result = block.content as { content?: unknown } | null | undefined;
    if (!result || !Array.isArray(result.content)) continue;
    for (const out of result.content as { type?: unknown; file_id?: unknown }[]) {
      const kind = out?.type;
      if ((kind === 'bash_code_execution_output' || kind === 'code_execution_output') && typeof out.file_id === 'string') {
        if (!ids.includes(out.file_id)) ids.push(out.file_id);
      }
    }
  }
  return ids;
}

/** A file the code made, read and ready to keep. */
export type MadeFile = { name: string; contentType: AttachmentContentType; bytes: Uint8Array };

/** A file that could not be kept, and why, in words for the person. */
export type UnkeptFile = { name: string; why: string };

/** The names a stored type is kept under, when the code named a file without an extension. */
const BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

/** The file's name as kept: its own last path part, with an extension the store takes where its type gives one. */
export function madeFileName(filename: unknown, mime: unknown): string {
  const raw = typeof filename === 'string' ? filename.split(/[\\/]/).pop()?.trim() ?? '' : '';
  const name = raw.slice(0, 200) || 'file';
  if (attachmentContentType(name)) return name;
  const ext = typeof mime === 'string' ? BY_MIME[mime] : undefined;
  return ext ? `${name}.${ext}` : name;
}

/** The Files API's metadata of a file, as much of it as is read here. */
type FileMeta = { filename?: unknown; mime_type?: unknown; size_bytes?: unknown };

const FILES_BETA = { 'anthropic-beta': 'files-api-2025-04-14' };

/**
 * Reads the files a reply's code made, at most MAX_MADE_FILES: each one's
 * name, type and size, then its bytes. One that is too large, of a type the
 * store does not take, or that cannot be read is returned as unkept with the
 * reason; the rest are returned to keep. Files past the limit are unkept too.
 */
export async function fetchMadeFiles(
  client: Pick<Anthropic, 'get'>,
  ids: readonly string[],
): Promise<{ files: MadeFile[]; unkept: UnkeptFile[] }> {
  const files: MadeFile[] = [];
  const unkept: UnkeptFile[] = [];
  for (const [index, id] of ids.entries()) {
    let name = 'One file';
    try {
      const meta = (await client.get(`/v1/files/${encodeURIComponent(id)}`, { headers: FILES_BETA })) as FileMeta;
      name = madeFileName(meta.filename, meta.mime_type);
      if (index >= MAX_MADE_FILES) {
        unkept.push({ name, why: `a reply keeps ${MAX_MADE_FILES} files at most` });
        continue;
      }
      const contentType = attachmentContentType(name);
      if (!contentType) {
        unkept.push({ name, why: 'that kind of file cannot be kept here; images, PDFs, Word, text and CSV can' });
        continue;
      }
      const size = typeof meta.size_bytes === 'number' ? meta.size_bytes : 0;
      if (size > ATTACHMENT_MAX_BYTES) {
        unkept.push({ name, why: 'it is over 20 MB' });
        continue;
      }
      const response = (await client.get(`/v1/files/${encodeURIComponent(id)}/content`, {
        headers: FILES_BETA,
        __binaryResponse: true,
      })) as unknown as Response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
        unkept.push({ name, why: 'it is over 20 MB' });
        continue;
      }
      files.push({ name, contentType, bytes });
    } catch (error) {
      console.error('a file a bot made could not be read', id, error);
      unkept.push({ name, why: 'it could not be fetched from where the code ran' });
    }
  }
  return { files, unkept };
}

/** The text a reply gets for the files it made that could not be kept, or null when every one was. */
export function madeFilesNote(unkept: readonly UnkeptFile[]): string | null {
  if (unkept.length === 0) return null;
  const lines = unkept.map((file) => `${file.name} could not be saved: ${file.why}.`);
  const opening = unkept.length === 1 ? 'Sorry, a file did not come through.' : 'Sorry, some files did not come through.';
  return `${opening} ${lines.join(' ')}`;
}
