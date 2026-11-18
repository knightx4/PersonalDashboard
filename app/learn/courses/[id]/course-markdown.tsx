import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { Markdown } from '@/components/ui/markdown';
import { remarkObsidianMath } from '@/lib/vault/markdown/math';

import 'katex/dist/katex.min.css';

// As the vault's notes set it (components/vault/note-body.tsx): nothing a
// formula names is trusted, and one that will not parse is shown as written.
const KATEX = {
  trust: false,
  throwOnError: false,
  strict: 'ignore',
  errorColor: 'var(--c-danger)',
} as const;

/**
 * A course's own text. A course marked as written with maths (`Digest.maths`)
 * has `$x$` and `$$…$$` set by KaTeX on the server, the way the vault's notes
 * are, so a matrix reads as a matrix. Other courses keep plain markdown,
 * because theirs is full of dollar amounts that are not formulas.
 */
export function CourseMarkdown({
  markdown,
  className,
  maths,
}: {
  markdown: string;
  className?: string;
  maths: boolean;
}) {
  if (!maths) return <Markdown markdown={markdown} className={className} />;
  return (
    <Markdown
      markdown={markdown}
      className={className}
      remarkPlugins={[remarkMath, remarkObsidianMath]}
      rehypePlugins={[[rehypeKatex, KATEX]]}
    />
  );
}
