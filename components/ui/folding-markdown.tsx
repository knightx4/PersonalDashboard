import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/cn';

export { splitSections } from '@/components/ui/markdown';

/**
 * A note written in markdown, where every heading folds what sits under it.
 *
 * Long notes on a round or a company are read a section at a time: the prep
 * for tomorrow, the history of the business, the questions to ask. Rendered
 * flat they are a wall; with each heading a fold, the closed note reads as its
 * own outline and opens where you need it.
 *
 * The rendering is the shared one in components/ui/markdown.tsx with `fold`
 * on; this keeps the name the pages already import.
 */
export function FoldingMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  return <Markdown markdown={markdown} fold className={cn('jobs-prose', className)} />;
}
