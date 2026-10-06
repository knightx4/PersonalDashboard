import { Fragment } from 'react';
import { isAppPath, linkParts } from '@/lib/goals/result-links';

/**
 * Text written as plain text, with every link in it clickable (notes 91885079
 * and 28d33a48). What Dash writes on a step carries markdown links, which a
 * plain paragraph showed as brackets and a raw address.
 *
 * Every block of plain text the app prints with its line breaks kept goes
 * through this (or through RefText, which calls it), and `npm run check:ui`
 * reports one that does not as `unlinked-text`.
 */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((part, index) =>
        'href' in part ? (
          <a
            key={index}
            href={part.href}
            // A path inside the app opens where you are; a site opens apart.
            {...(isAppPath(part.href) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            className="break-words text-accent underline underline-offset-2"
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Whether the text holds anything LinkedText would draw as a link. */
export function hasLinks(text: string): boolean {
  return linkParts(text).some((part) => 'href' in part);
}
