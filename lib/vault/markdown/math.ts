import type { Nodes, Parent, RootContent } from 'mdast';
import type { VFile } from 'vfile';

/**
 * Prices, handed back from the maths.
 *
 * remark-math reads `$…$` as an inline formula wherever it finds a pair, so
 * "it went for $20 and the next one for $30" becomes one expression reading
 * "20andthenextonefor". Obsidian, which is what these notes were written in,
 * does not: its closing delimiter has to sit against the character before it,
 * which is what tells a formula apart from two amounts in a sentence.
 *
 * So the vault reads them Obsidian's way. This runs after remark-math and
 * turns any span whose closing `$` was preceded by a space back into the text
 * it was written as. Doing it here rather than before the parse is what keeps
 * the delimiters honest: a `$` inside code, a link or a table cell has
 * already been settled by the time this sees the tree.
 */
export function remarkObsidianMath() {
  return (tree: Nodes, file: VFile) => {
    const source = String(file);

    const visit = (node: Nodes) => {
      const parent = node as Parent;
      if (!Array.isArray(parent.children)) return;

      parent.children = parent.children.map((child) => plainAgain(child, source));
      for (const child of parent.children) visit(child as Nodes);
    };

    visit(tree);
  };
}

/**
 * The node as written, when its closing `$` had a space in front of it.
 *
 * Only the inline kind: `$$…$$` on its own line is unambiguous, and nobody
 * writes a price with two dollar signs.
 */
function plainAgain(node: RootContent, source: string): RootContent {
  if (node.type !== 'inlineMath') return node;

  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return node;

  // Past the closing '$' to the character it closed against.
  const against = source[end - 2];
  if (against === undefined || !/\s/.test(against)) return node;

  return { type: 'text', value: source.slice(start, end), position: node.position };
}
