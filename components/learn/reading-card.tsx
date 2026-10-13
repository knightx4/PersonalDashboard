import Link from '@/components/ui/link';
import { AlertTriangle, BadgeCheck, CircleDashed, CircleSlash, Check } from 'lucide-react';
import type { ReadingRow, SourceAccess } from '@/lib/learn/tracks/load';
import { formatMoney } from '@/lib/money';
import { Tooltip } from '@/components/ui/tooltip';
import { Chip } from '@/components/ui/chip';

/**
 * One reading, in a list.
 *
 * The two things that have to be visible without opening it are what it costs
 * you -- money and pages -- and how sure the app is about where to look. The
 * second is the module's whole promise: a location the app checked and one it
 * guessed are different claims, and flattening them is how a reader learns to
 * distrust every link here.
 */

const ACCESS_LABEL: Record<SourceAccess, string | null> = {
  // The common case says nothing. A badge on every row is a badge on none.
  open: null,
  paywalled: 'Paywalled',
  purchase: 'Buy',
  library: 'Library',
  unknown: 'Access unknown',
};

/** What each badge means, for the mouse: the card is one link, so a badge takes no focus of its own. */
const ACCESS_HINT: Record<SourceAccess, string | null> = {
  open: null,
  paywalled: 'The source sits behind a paywall',
  purchase: 'You would have to buy the source to read it',
  library: 'The source is easiest to borrow from a library',
  unknown: 'Dash could not tell how to get hold of the source',
};

function AccessBadge({ access, priceCents }: { access: SourceAccess; priceCents: number | null }) {
  const label = ACCESS_LABEL[access];
  if (!label) return null;

  const price = priceCents !== null ? formatMoney(priceCents, 'USD') : null;

  // A recessed ground rather than a hairline. A badge is two words that want
  // marking off, and a fill marks them off without adding a frame to a row
  // that is already inside a card -- law 11's "a shared ground groups".
  return (
    <Tooltip label={ACCESS_HINT[access] ?? label}>
      <Chip>
        {price ? `${label} · ${price}` : label}
      </Chip>
    </Tooltip>
  );
}

/**
 * Where to look, and how far to trust it.
 *
 * An unverified locator is not hidden and not dressed up. It says so, because
 * a reader who knows the chapter number is a guess loses a minute checking,
 * and one who does not loses twenty and stops believing the next one.
 */
export function LocatorLine({ reading }: { reading: ReadingRow }) {
  const pages =
    reading.pageFrom && reading.pageTo
      ? `pp. ${reading.pageFrom}–${reading.pageTo}`
      : reading.pageFrom
        ? `p. ${reading.pageFrom}`
        : null;

  // Nothing to point into. A confidence badge on a reading with no source
  // would be claiming something about a document that does not exist.
  if (!reading.source) return null;

  const where = [reading.locatorLabel, pages].filter(Boolean).join(', ');
  if (!where && reading.locatorConfidence === 'verified') return null;

  const verified = reading.locatorConfidence === 'verified';

  return (
    <span className="inline-flex items-center gap-1 text-ui text-ink-muted">
      {/* Ink and a shape, not green. Law 4 spends positive on money coming
          back; "we checked this location" is not that, and the two glyphs
          already tell the claims apart. The caution keeps its colour because
          it is the one of the pair you have to act on. */}
      {verified ? (
        <Tooltip label="Dash checked this place in the source" className="shrink-0">
          <span role="img" aria-label="Checked" className="inline-flex">
            <BadgeCheck className="size-3.5 text-ink-muted" strokeWidth={1.75} aria-hidden />
          </span>
        </Tooltip>
      ) : (
        <AlertTriangle className="size-3.5 shrink-0 text-caution" strokeWidth={1.75} aria-hidden />
      )}
      <span>{where || 'Location not confirmed'}</span>
      {!verified && where && <span className="text-small">· unconfirmed</span>}
    </span>
  );
}

function StatusIcon({ status }: { status: ReadingRow['status'] }) {
  if (status === 'read') {
    // Read is not a refund. The four statuses are told apart by their glyphs
    // -- tick, slash, dashed circle, nothing -- and only the one that means
    // "in progress" earns the accent. Law 4.
    return (
      <Tooltip label="You have read this" className="shrink-0">
        <span role="img" aria-label="Read" className="inline-flex">
          <Check className="size-4 text-ink-muted" strokeWidth={1.75} aria-hidden />
        </span>
      </Tooltip>
    );
  }
  if (status === 'abandoned') {
    return (
      <Tooltip label="You gave up on this one" className="shrink-0">
        <span role="img" aria-label="Gave up" className="inline-flex">
          <CircleSlash className="size-4 text-ink-ghost" strokeWidth={1.75} aria-hidden />
        </span>
      </Tooltip>
    );
  }
  if (status === 'reading') {
    return (
      <Tooltip label="You have started this" className="shrink-0">
        <span role="img" aria-label="Started" className="inline-flex">
          <CircleDashed className="size-4 text-accent" strokeWidth={1.75} aria-hidden />
        </span>
      </Tooltip>
    );
  }
  return <span className="size-4 shrink-0" aria-hidden />;
}

/**
 * `from` names the newsletter a story sent from News was in (plan #1368). The
 * whole card is one link to the reading, so the line is text here; the
 * reading's own page links it to the story.
 */
export function ReadingCard({ reading, from }: { reading: ReadingRow; from?: string | null }) {
  const done = reading.status === 'read' || reading.status === 'abandoned';

  return (
    <li>
      <Link
        href={`/learn/r/${reading.id}`}
        className="flex gap-3 px-4 py-3 transition-colors duration-quick hover:bg-canvas"
      >
        <span className="pt-0.5">
          <StatusIcon status={reading.status} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={
                done
                  ? 'text-body font-medium text-ink-muted line-through decoration-border'
                  : 'text-body font-medium text-ink'
              }
            >
              {reading.subject}
            </span>
            {reading.source?.author && (
              <span className="text-ui text-ink-muted">{reading.source.author}</span>
            )}
            {reading.source ? (
              <AccessBadge
                access={reading.source.access}
                priceCents={reading.source.priceCents}
              />
            ) : (
              // Written down, nothing found for it yet. Said plainly rather
              // than left blank, because a row with no source and no note
              // about it reads as a row that failed.
              <Chip className="text-ink-ghost">
                No source yet
              </Chip>
            )}
          </span>

          {from && <span className="mt-0.5 block text-ui text-ink-muted">From {from}</span>}

          {reading.why && (
            <span className="mt-0.5 block text-ui text-ink-muted">{reading.why}</span>
          )}

          <span className="mt-1 block">
            <LocatorLine reading={reading} />
          </span>
        </span>
      </Link>
    </li>
  );
}
