'use client';

import { useState } from 'react';

/**
 * Required attribution for the BoardGameGeek XML API.
 *
 * BGG's terms require the "Powered by BGG" logo on any public-facing app that
 * uses the API. The official artwork is theirs to distribute, so it is served
 * from public/powered-by-bgg.png rather than redrawn here; until that file is
 * added the link still renders as a text lockup, so the credit is never
 * missing entirely.
 */
export function PoweredByBgg() {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <footer className="mt-10 flex justify-center border-t border-border pt-6">
      <a
        href="https://boardgamegeek.com"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 text-ui text-ink-muted transition hover:text-ink"
        aria-label="Powered by BoardGameGeek"
      >
        {logoFailed ? (
          <span>
            Game data powered by <span className="font-semibold">BoardGameGeek</span>
          </span>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size badge, no optimisation wanted */}
            <img
              src="/powered-by-bgg.png"
              alt="Powered by BGG"
              className="h-8 w-auto"
              onError={() => setLogoFailed(true)}
            />
            <span className="sr-only">Powered by BoardGameGeek</span>
          </>
        )}
      </a>
    </footer>
  );
}
