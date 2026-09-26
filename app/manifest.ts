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
    name: 'Personal Dashboard',
    short_name: 'Dash',
    description:
      'What you own, what you spent, and where your job search stands, in one account.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f4ed',
    theme_color: '#f7f4ed',
    icons: [
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
