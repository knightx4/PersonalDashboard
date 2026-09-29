import { Fragment } from 'react';
import { linkParts } from '@/lib/goals/result-links';

/**
 * Text written as plain text, with every link in it clickable (notes 91885079
 * and 28d33a48). What Dash writes on a step carries markdown links, which a
 * plain paragraph showed as brackets and a raw address.
 */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((part, index) =>
        'href' in part ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
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
