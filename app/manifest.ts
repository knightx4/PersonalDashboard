import type { MetadataRoute } from 'next';

/**
 * The web app manifest, which is what makes the home-screen app one app.
 *
 * Without it, iOS scopes a home-screen web app to the folder of the page it
 * was saved from: saved from /dev/plan, the app owns /dev/ and nothing else,
 * and following a link to /goals opens Safari's in-app browser over it, with
 * the domain bar and the close button. `scope: '/'` gives the whole site to
 * the app, so every page stays standalone.
 *
 * `start_url` is `/`, which the proxy forwards a signed-in person to their
 * dashboard from, so the icon always opens somewhere sensible whichever page
 * it was added on.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dash',
    short_name: 'Dash',
    // The workspaces in lib/modules.ts, less Dev, which only the owner sees.
    // Change this when a workspace is added.
    description:
      'Your goals, to-do list, job search, learning, news, shopping and vault of notes, in one app.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color:
      '#f7f4ed' /* ui-ok: the manifest is JSON for the OS, which cannot read a token; this is --c-canvas */,
    theme_color:
      '#f7f4ed' /* ui-ok: the manifest is JSON for the OS, which cannot read a token; this is --c-canvas */,
    /*
     * Android wants 192 and 512 PNGs, and a maskable one for the launcher's
     * own shape (circle, squircle, rounded square). Without a maskable icon,
     * Android shrinks the transparent-cornered mark onto a white disc.
     *
     * icon-192 and icon-512 are app/icon.svg at those sizes. The maskable one
     * is the composition of apple-icon.png: the ground runs to every edge and
     * the dash spans 56% of the width, inside the central 80% circle that every
     * launcher mask keeps. They live in public/ rather than app/ because a
     * numbered icon file in app/ becomes another <link rel="icon"> on every
     * page. If the mark changes, redraw these with it.
     */
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
