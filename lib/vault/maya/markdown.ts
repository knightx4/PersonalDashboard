import { basenameOf } from '@/lib/vault/paths';
import type { MayaPoint, MayaSynthesis } from './verify';

/**
 * A thread with Maya as Markdown to paste into Obsidian (plan #1287).
 *
 * The vault stays read-only: this only builds the text the thread page puts
 * on the clipboard. Every note the thread cites becomes a [[wikilink]] by its
 * filename, which is how Obsidian names a note, so the pasted note joins the
 * graph. A cited note that has left the vault is linked by the title Maya
 * quoted it under, which Obsidian shows as a link to a note not yet made.
 *
 * Pure and free of server imports, because the page builds it in the browser
 * from the summary as it stands after the latest reply.
 */

export type ThreadMarkdownInput = {
  question: string;
  summary: string | null;
  /** Vault path of the note the thread is on, or null when it has left the vault. */
  notePath: string | null;
  points: readonly MayaPoint[];
  synthesis: MayaSynthesis | null;
  /** Vault path for each cited note id still in the vault. */
  paths: Readonly<Record<string, string>>;
};

/** Obsidian's link to a note by its vault path. */
export function wikilink(vaultPath: string): string {
  return `[[${basenameOf(vaultPath)}]]`;
}

export function threadMarkdown(input: ThreadMarkdownInput): string {
  const blocks: string[] = [`# ${oneLine(input.question)}`];

  blocks.push(
    input.notePath ? `A thread with Maya on ${wikilink(input.notePath)}.` : 'A thread with Maya.',
  );

  if (input.summary?.trim()) {
    blocks.push('## Where you have got to', input.summary.trim());
  }

  if (input.points.length > 0) {
    blocks.push('## Maya’s thought');
    for (const point of input.points) blocks.push(...pointBlocks(point, input.paths));
  }

  if (input.synthesis) {
    const [left, right] = input.synthesis.positionNames;
    blocks.push(
      `### Reconciling “${oneLine(left)}” and “${oneLine(right)}”`,
      input.synthesis.resolution.trim(),
    );
  }

  return `${blocks.join('\n\n')}\n`;
}

function pointBlocks(point: MayaPoint, paths: Readonly<Record<string, string>>): string[] {
  const blocks = [`### ${point.rank}. ${oneLine(point.claim)}`, point.argument.trim()];

  for (const note of point.notes) {
    const path = paths[note.noteId];
    const link = path ? wikilink(path) : `[[${linkName(note.title)}]]`;
    blocks.push(`${quoted(note.quote)}\n\n${link}: ${note.point.trim()}`);
  }

  if (point.sources.length > 0) {
    const lines = point.sources.map((source) => {
      const line = `- ${oneLine(source.author)}, *${oneLine(source.work)}* (paraphrased): ${oneLine(source.gist)}`;
      return source.exactText ? `${line}\n${indent(quoted(source.exactText))}` : line;
    });
    blocks.push(lines.join('\n'));
  }

  return blocks;
}

/** A Markdown blockquote, every line of it marked. */
function quoted(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `> ${line.trim()}` : '>'))
    .join('\n');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/** Headings and list items hold one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A title made safe to link by: Obsidian reads | # ^ [ ] inside a link as syntax. */
function linkName(title: string): string {
  return oneLine(title.replace(/[|#^[\]]/g, ' '));
}
