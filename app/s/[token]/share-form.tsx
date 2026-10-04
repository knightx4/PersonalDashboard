import type { SharePage } from '@/lib/share/read/load-disposition';
import { formatMoneyOrBlank } from '@/lib/money';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { DispositionGroup } from './disposition-group';

/**
 * The shared form as she sees it, from the page the share functions return.
 * Apart from the page so the surface gallery can draw it with fixtures.
 */
export function ShareForm({ token, page }: { token: string; page: SharePage }) {
  const decidedAll = page.totals.decided >= page.totals.units && page.totals.units > 0;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-5 sm:py-12">
      <header>
        <h1 className="font-display text-title tracking-tight text-ink">{page.title}</h1>
        {page.intro && (
          <p className="mt-2 text-body leading-relaxed text-ink-muted">{page.intro}</p>
        )}
        <p className="mt-3 text-ui text-ink-muted">
          {page.totals.units} {page.totals.units === 1 ? 'item' : 'items'}
          {page.totals.products !== page.totals.units && (
            <> across {page.totals.products} titles</>
          )}
          {page.canRespond && (
            <>
              {' · '}
              {decidedAll ? 'all decided' : `${page.totals.units - page.totals.decided} left`}
            </>
          )}
        </p>
        <p className="mt-1 text-ui text-ink-muted">
          {page.canRespond
            ? 'Choices save as you make them, and you can change them later.'
            : 'This link is read-only.'}
        </p>
      </header>

      {page.groups.length === 0 && (
        <p className="mt-10 text-body text-ink-muted">
          There is nothing on this list yet.
        </p>
      )}

      {page.families.map((family) => (
        <section key={family.key ?? '__loose'} className="mt-8">
          {/* The loose things get a heading too once anything above them has
              one, so they do not read as part of the last family. */}
          {(family.label || page.families.length > 1) && (
            <h2 className="mb-3 text-ui font-semibold tracking-wide text-ink-muted uppercase">
              {family.label ?? 'Everything else'}
            </h2>
          )}
          {/* One surface with hairlines between the rows rather than a card
              each, so a phone holds more of the list. */}
          <ul className={cn(cardVariants({ padding: 'dense' }), 'divide-y divide-border')}>
            {family.groups.map((group) => (
              <DispositionGroup
                key={group.groupKey}
                token={token}
                group={group}
                canRespond={page.canRespond}
                // Formatted here, on the server, because formatting money is
                // lib/money's job and the stepper is a client component.
                priceLabel={formatMoneyOrBlank(group.unitPriceCents)}
              />
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-12 text-small text-ink-muted">
        Shared privately. Anyone with this link can see and change these choices.
      </p>
    </main>
  );
}
