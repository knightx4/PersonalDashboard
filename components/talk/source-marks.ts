/**
 * The numbers that tie an answer to its sources on the Dash tab of Chat (plan
 * #2748.12). Every row Dash read in a chat is numbered once in Used in this
 * chat (lib/talk/chat-trail.ts chatReadRows, cited rows first, in the order
 * cited), and the same number marks the answer that cites the row.
 *
 * The answer does not say which words rest on which row, so the mark goes
 * right after the first place the answer names the row: its title, or the
 * title up to its first comma ("Catan lot, eBay" is named as "Catan lot").
 * A row the words never name is marked at the end of the last paragraph. No
 * React here: the remark plugin is a function over the markdown tree, so it
 * is tested on its own.
 */

/** One cited row as the answer marks it. */
export type SourceMark = { n: number; title: string; href: string };

/** The chip's look, shared by the mark in the answer and the number in Used. */
export const SOURCE_NUMBER =
  'inline-grid h-[18px] min-w-[18px] place-items-center rounded-control bg-accent-tint px-1 font-mono text-micro font-medium leading-none text-accent tabular';

/**
 * The mark in an answer: a link to the row it stands for, drawn inline so it
 * reads as part of the sentence, with the chip inside. `press-area` gives it
 * the 44px press target on a phone (the phone check counts the chip's own
 * 18px as too small), reaching a little over the lines either side.
 */
const MARK_LINK = 'group/mark press-area no-underline!';
const MARK_CHIP = `${SOURCE_NUMBER} mx-px align-[2px] group-hover/mark:ring-1 group-hover/mark:ring-accent`;

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

/** The ways an answer may name a row, longest first. */
export function namesFor(title: string): string[] {
  const whole = title.replace(/\s+/g, ' ').trim();
  const head = whole.split(',')[0].trim();
  return [...new Set([whole, head])].filter((name) => name.length >= 3);
}

/**
 * Where a row's mark goes in one run of text: the offset just after the
 * first place the run names it, or null when it does not. Exported for the
 * test.
 */
export function namedAt(text: string, title: string): number | null {
  const said = text.toLowerCase();
  for (const name of namesFor(title)) {
    const at = said.indexOf(name.toLowerCase());
    if (at !== -1) return at + name.length;
  }
  return null;
}

function markNode(mark: SourceMark): Node {
  return {
    type: 'sourceMark',
    children: [
      {
        type: 'sourceMarkChip',
        children: [{ type: 'text', value: String(mark.n) }],
        data: { hName: 'span', hProperties: { className: MARK_CHIP.split(' ') } },
      },
    ],
    data: {
      hName: 'a',
      hProperties: {
        href: mark.href,
        className: MARK_LINK.split(' '),
        ariaLabel: `Source ${mark.n}: ${mark.title}`,
        title: `${mark.n}. ${mark.title}`,
      },
    },
  };
}

type Run = { parent: Node; node: Node };

/** Every text node outside links, code and marks, in reading order, with its parent. */
function runs(node: Node, out: Run[] = []): Run[] {
  for (const child of node.children ?? []) {
    if (child.type === 'text' && typeof child.value === 'string') out.push({ parent: node, node: child });
    else if (!['link', 'linkReference', 'inlineCode', 'code', 'sourceMark'].includes(child.type)) runs(child, out);
  }
  return out;
}

/** Every paragraph in the answer, in reading order, lists' items included. */
function paragraphs(node: Node, out: Node[] = []): Node[] {
  if (node.type === 'paragraph') out.push(node);
  else for (const child of node.children ?? []) paragraphs(child, out);
  return out;
}

/** The remark plugin: marks an answer's cited rows with their numbers. */
export function sourceMarks(marks: readonly SourceMark[]) {
  return () => (tree: Node) => {
    if (marks.length === 0) return;
    const unplaced: SourceMark[] = [];
    for (const mark of [...marks].sort((a, b) => a.n - b.n)) {
      const hit = runs(tree).find((run) => namedAt(run.node.value ?? '', mark.title) !== null);
      if (!hit) {
        unplaced.push(mark);
        continue;
      }
      const value = hit.node.value ?? '';
      const at = namedAt(value, mark.title) ?? value.length;
      const siblings = hit.parent.children ?? [];
      siblings.splice(
        siblings.indexOf(hit.node),
        1,
        { type: 'text', value: value.slice(0, at) },
        markNode(mark),
        { type: 'text', value: value.slice(at) },
      );
    }
    const last = paragraphs(tree).at(-1);
    if (last) for (const mark of unplaced) (last.children ??= []).push(markNode(mark));
  };
}
