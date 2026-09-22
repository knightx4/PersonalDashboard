import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { MapPosition, MapQuote } from '@/components/vault/map-position';
import { createVaultClient } from '@/lib/vault/auth/server';
import { quoteFragment } from '@/lib/vault/map/fragment';
import { loadThemeMap, type MapSource } from '@/lib/vault/map/read';
import { noteHref } from '@/lib/vault/paths';

export const dynamic = 'force-dynamic';

/**
 * One theme: the positions under it, each with every sentence behind it and
 * the note that sentence is in (#758).
 *
 * The note link carries a text fragment (lib/vault/map/fragment.ts), so
 * opening it scrolls to the sentence and highlights it. That is the second tap
 * of the two the step promises; the first was the theme on the map's list.
 *
 * The notes under the theme come after the positions, because a note can be
 * about a subject without arguing anything in it, and such a note would
 * otherwise not appear on this page at all.
 */
export default async function ThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createVaultClient();
  const map = await loadThemeMap(supabase, id);
  if (!map) notFound();

  const { theme, positions, notes } = map;
  const span = seenSpan(theme.firstSeen, theme.lastSeen);

  return (
    <article className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link
          href="/vault/map"
          className="inline-flex items-center gap-1 text-ui font-medium text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Map
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="font-display text-title font-semibold tracking-tight text-ink">
          {theme.name}
        </h1>
        <p className="mt-1 text-body text-ink">{theme.about}</p>
        <p className="mt-1 text-ui text-ink-muted">
          {count(notes.length, 'note', 'notes')} · {count(positions.length, 'position', 'positions')}
          {span && <> · {span}</>}
        </p>
      </header>

      {positions.length > 0 && (
        <section aria-labelledby="positions-heading">
          <h2 id="positions-heading" className="mb-1 text-body font-semibold text-ink">
            Positions
          </h2>
          <ul className="divide-y divide-border">
            {positions.map((position) => (
              <li key={position.id} className="py-4">
                <MapPosition
                  name={position.name}
                  statement={position.statement}
                  kind={position.kind}
                  stance={position.stance}
                  basis={position.basis}
                  tag={position.sources.length === 0 ? 'No sentence left in the notes' : null}
                >
                  {position.sources.map((source, i) => (
                    <Source key={i} source={source} />
                  ))}
                </MapPosition>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section aria-labelledby="notes-heading" className="mt-8">
          <h2 id="notes-heading" className="mb-1 text-body font-semibold text-ink">
            Notes
          </h2>
          <ul className="divide-y divide-border">
            {notes.map((note) => (
              <li key={note.path} className="py-3">
                <Link href={noteHref(note.path)} className="text-body font-medium text-ink hover:underline">
                  {note.title}
                </Link>
                <span className="mt-0.5 block text-ui text-ink-muted">{note.basis}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** One sentence behind a position, and the note it is in. */
function Source({ source }: { source: MapSource }) {
  return (
    <span className="mt-2 block">
      <MapQuote quote={source.quote} />
      <span className="mt-1 block pl-3.5 text-small text-ink-muted">
        {source.note ? (
          <>
            From{' '}
            {/* A plain anchor, because a browser acts on a text fragment only
                on a document load: Link's client-side navigation would open
                the note at the top and look for an element with that id. */}
            <a
              href={`${noteHref(source.note.path)}${quoteFragment(source.quote)}`}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              {source.note.title}
            </a>
          </>
        ) : (
          'From a note no longer in the vault'
        )}
      </span>
    </span>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * When the notes under it are dated, the months they span. Most notes carry no
 * date until a commit touches them, so this is often absent, and a guessed
 * date would be worse than none.
 */
function seenSpan(first: string | null, last: string | null): string | null {
  if (!first || !last) return null;
  const a = month(first);
  const b = month(last);
  return a === b ? `written in ${a}` : `written ${a} to ${b}`;
}

function month(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
