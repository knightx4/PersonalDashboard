'use client';

import { useState } from 'react';

/**
 * Required attribution for the BoardGameGeek XML API.
 *
 * BGG's terms require the "Powered by BGG" logo on any public-facing app that
 * uses the API. The official artwork is theirs to distribute, so it is served
 * from public/powered-by-bgg.png rather than redrawn here; until that file is
 * added the link renders as a text credit, so the credit is never missing.
 *
 * The artwork is black on clear, which vanishes on a dark card. So it is used
 * as a mask over the muted ink: the logo's shape in the theme's own text
 * colour, readable on every ground. A hidden copy of the image is what
 * notices a missing file and swaps in the text.
 *
 * It sat at the foot of the Add board games page until that page went (plan
 * #1950.3.4); a game's details are where BGG's data is shown now.
 */
export function PoweredByBgg() {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <a
      href="https://boardgamegeek.com"
      target="_blank"
      rel="noreferrer"
      className="-my-2.5 inline-flex min-h-11 items-center text-small text-ink-muted transition hover:text-ink"
      aria-label="Powered by BoardGameGeek"
    >
      {logoFailed ? (
        <span>
          Game data powered by <span className="font-semibold">BoardGameGeek</span>
        </span>
      ) : (
        <>
          <span
            aria-hidden
            // ui-ok: fixed-control-height -- the badge's size, not a control
            className="block aspect-[368/108] h-6 bg-current [mask-image:url(/powered-by-bgg.png)] [mask-repeat:no-repeat] [mask-size:contain]"
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- only here to notice a missing file */}
          <img src="/powered-by-bgg.png" alt="" hidden onError={() => setLogoFailed(true)} />
        </>
      )}
    </a>
  );
}
