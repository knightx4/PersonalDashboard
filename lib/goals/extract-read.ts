/**
 * One read of pasted text or a document into a form (plan #955): work out
 * what the input is, put it in a shape the model can take, ask, and turn the
 * answer into the rows the form starts from.
 *
 * The model call is passed in, so this is tested with it stubbed; the real
 * one is askExtractModel in lib/goals/extract-model.ts.
 */

import type { CollectionField, CollectionShape } from '@/lib/goals/collections';
import { docxText } from '@/lib/goals/docx';
import {
  DOCUMENT_MAX_BYTES,
  PASTE_MAX,
  documentKind,
  readAnswer,
  type ReadAnswer,
} from '@/lib/goals/extract';
import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';

export type ReadInput = { text: string } | { name: string; bytes: Uint8Array };

/**
 * asOf is the date the document gives its figures as of, or null when it
 * gives none. suggestions are the fields it has and the form lacks, and
 * cautions the labels in it that do not mean what they say (plan #986).
 */
export type ReadResult = ({ ok: true } & ReadAnswer) | { ok: false; error: string };

export async function readIntoForm(
  collection: { name: string; shape: CollectionShape; fields: CollectionField[] },
  input: ReadInput,
  ask: (source: ExtractSource) => Promise<ExtractResult>,
): Promise<ReadResult> {
  const source = toSource(input);
  if (!source.ok) return source;
  const answer = await ask(source.source);
  if (!answer.ok) return answer;
  const read = readAnswer(collection.fields, collection.shape, answer.input);
  if (read.rows.length === 0) {
    return { ok: false, error: `Nothing in that fits the ${collection.name} form.` };
  }
  return { ok: true, ...read };
}

function toSource(input: ReadInput): { ok: true; source: ExtractSource } | { ok: false; error: string } {
  if ('text' in input) {
    const text = input.text.trim().slice(0, PASTE_MAX);
    if (!text) return { ok: false, error: 'Paste some text first.' };
    return { ok: true, source: { kind: 'text', text } };
  }

  const kind = documentKind(input.name);
  if (!kind) {
    return { ok: false, error: 'That kind of file cannot be read. Use a PDF, an image, a Word file or text.' };
  }
  if (input.bytes.length === 0) return { ok: false, error: 'That file is empty.' };
  if (input.bytes.length > DOCUMENT_MAX_BYTES) return { ok: false, error: 'That file is over 20 MB.' };

  switch (kind.kind) {
    case 'pdf':
      return { ok: true, source: { kind: 'pdf', data: base64(input.bytes) } };
    case 'image':
      return { ok: true, source: { kind: 'image', data: base64(input.bytes), mediaType: kind.mediaType } };
    case 'docx': {
      const text = docxText(input.bytes);
      if (text === null) return { ok: false, error: 'That Word file could not be opened.' };
      if (!text) return { ok: false, error: 'That Word file has no text in it.' };
      return { ok: true, source: { kind: 'text', text: text.slice(0, PASTE_MAX) } };
    }
    case 'text': {
      const text = new TextDecoder().decode(input.bytes).trim().slice(0, PASTE_MAX);
      if (!text) return { ok: false, error: 'That file has no text in it.' };
      return { ok: true, source: { kind: 'text', text } };
    }
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}
