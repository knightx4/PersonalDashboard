import type { ReactNode } from 'react';
import { CardSection } from '@/components/ui/card';

/**
 * One of Home's rail sections, folded under a line that carries its count
 * (plan #1937.8, law 10). Open from laptop width, where the rail stands
 * beside the main column and has the room; shut on a phone, where the rail
 * falls under the briefs and the Inbox count and would otherwise push the
 * page to thousands of pixels. A fold left the other way is kept in this
 * browser, and a link to the section's id (a watch push opens /home#watching)
 * opens it whatever its default (FoldDetails).
 */
export function HomeFold({
  id,
  title,
  count,
  action,
  children,
}: {
  /** The section's anchor, and the key its fold is kept under. */
  id: string;
  title: string;
  /** What is inside, on the closed line: "5", "3 changes". */
  count: ReactNode;
  /** A link opposite the title, outside the summary so it does not fold. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CardSection
      id={id}
      title={title}
      meta={count}
      // The link takes the summary's height, so it sits on the title's line.
      action={action && <span className="flex min-h-8 items-center">{action}</span>}
      padding="standard"
      className="scroll-mt-bar"
      fold={`home.fold.${id}`}
      defaultOpen="wide"
    >
      {children}
    </CardSection>
  );
}
