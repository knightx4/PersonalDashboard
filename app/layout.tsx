import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

// Inter does all the work. Instrument Serif is the voice: page titles and the
// one big figure, and nothing else -- it is the face that stops the app
// sounding like software. It ships at 400 only, so nothing wearing
// `font-display` may also ask for a bold; a synthesised serif bold looks
// exactly as bad as it sounds.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const instrument = Instrument_Serif({
  variable: '--font-instrument',
  subsets: ['latin'],
  weight: '400',
});

export const metadata: Metadata = {
  title: {
    default: 'Personal Dashboard',
    template: '%s · Personal Dashboard',
  },
  description:
    'What you own, what you spent, and where your job search stands, in one account.',
};

/**
 * The viewport, spelled out rather than left to the framework default.
 *
 * Next emits `width=device-width, initial-scale=1` and nothing else, which
 * leaves Safari's own minimum scale in force -- 0.25. A pinch on a phone can
 * therefore take the page to a quarter size and it does not spring back, which
 * is what "it zooms way out and the header gets smaller too" is: not a layout
 * that overflows (the document measures exactly 390px at 390px) but a scale
 * the browser was willing to go to and then keep.
 *
 * `minimumScale` only forbids zooming *out* past a page that already fits.
 * `maximumScale` and `userScalable` are deliberately left alone, so zooming in
 * -- the one that matters for reading -- is untouched.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
};

/**
 * The theme is read from a cookie, here, on the server.
 *
 * That cookie is a mirror of core.account_settings.theme rather than the
 * source of truth. It exists for one reason: so `data-theme` is in the first
 * byte of HTML we send. A theme that flashes white before going dark is worse
 * than having no dark mode at all, and that flash is precisely what you get
 * when the choice is only readable after hydration.
 *
 * No cookie means no choice has been made, which is not the same as choosing
 * light: the attribute is left off entirely and globals.css falls through to
 * `prefers-color-scheme`.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={`${inter.variable} ${instrument.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
