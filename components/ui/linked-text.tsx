import { Fragment } from 'react';
import { RefLink } from '@/components/ui/ref-link';
import { planRefHref, refTarget, splitOnRefs, type RefReading } from '@/lib/comments/refs';
import { planKey, previewKeyFromHref } from '@/lib/core/ref-preview';
import { isAppPath, linkParts } from '@/lib/goals/result-links';

const LINK = 'break-words text-accent underline underline-offset-2';

/**
 * Text written as plain text, with every link in it clickable (notes 91885079
 * and 28d33a48). What Dash writes on a step carries markdown links, which a
 * plain paragraph showed as brackets and a raw address.
 *
 * A step written by its outline, `#1490.11`, is a link to that step too, and
 * so is every link to a row's page: each previews the row on hover or hold
 * (plan #1931.4). `refs="all"` reads a bare `#1084` as a step as well, for
 * text on the plan's own pages, where a number is a step; elsewhere a `#3` is
 * a list number far more often, and only the dotted kind is read.
 *
 * Every block of plain text the app prints with its line breaks kept goes
 * through this (or through RefText, which calls it), and `npm run check:ui`
 * reports one that does not as `unlinked-text`.
 */
export function LinkedText({ text, refs = 'outlines' }: { text: string; refs?: RefReading | false }) {
  return (
    <>
      {linkParts(text).map((part, index) => {
        if (!('href' in part)) {
          return <Fragment key={index}>{refs ? <StepRefs text={part.text} reading={refs} /> : part.text}</Fragment>;
        }
        const key = previewKeyFromHref(part.href);
        if (key) {
          return (
            <RefLink key={index} href={part.href} previewKey={key} className={LINK}>
              {part.text}
            </RefLink>
          );
        }
        return (
          <a
            key={index}
            href={part.href}
            // A path inside the app opens where you are; a site opens apart.
            {...(isAppPath(part.href) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            className={LINK}
          >
            {part.text}
          </a>
        );
      })}
    </>
  );
}

/** The words of one run of text, with its step references as ref links. */
function StepRefs({ text, reading }: { text: string; reading: RefReading }) {
  const parts = splitOnRefs(text, undefined, reading);
  return (
    <>
      {parts.map((part, index) => {
        const target = refTarget(part);
        return target === null ? (
          <Fragment key={index}>{part.text}</Fragment>
        ) : (
          <RefLink key={index} href={planRefHref(target)} previewKey={planKey(target)} className={LINK}>
            {part.text}
          </RefLink>
        );
      })}
    </>
  );
}

/** Whether the text holds anything LinkedText would draw as a link. */
export function hasLinks(text: string): boolean {
  return linkParts(text).some(
    (part) => 'href' in part || splitOnRefs(part.text, undefined, 'outlines').some((ref) => refTarget(ref) !== null),
  );
}
