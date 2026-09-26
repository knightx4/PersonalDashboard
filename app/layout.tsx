import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { formatTheme, parseTheme, THEME_CHOICE_ATTRIBUTE, THEME_COOKIE } from '@/lib/theme';
import { themeAttribute, themeStyle } from '@/lib/theme/apply';
import { DENSITY_COOKIE, parseDensity } from '@/lib/density';

// Inter does all the work. Bricolage Grotesque is the voice: page titles, the
// workspace name and the one big figure, and nothing else. A grotesque with
// actual character rather than a serif -- the app should read as designed, not
// as a document. Variable, so it can carry weight where a display face needs
// to.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const display = Bricolage_Grotesque({
  variable: '--font-display-face',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'Personal Dashboard',
    template: '%s · Personal Dashboard',
  },
  description:
    'What you own, what you spent, and where your job search stands, in one account.',
  // Home-screen app title and full-screen mode on iOS; the scope that keeps
  // every page inside the app lives in app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: 'Dash',
    statusBarStyle: 'default',
  },
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
 *
 * A chosen colour rides in the same byte, as an inline style holding the
 * generated `--c-*` values. Inline rather than a stylesheet so it wins over
 * the written block underneath it without a specificity argument, and because
 * a theme applied after hydration is a theme you watch arrive.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  // Same arrangement as the theme, for the same reason: the attribute has to
  // be in the first byte, or the page renders one density and snaps to another.
  const density = parseDensity(jar.get(DENSITY_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={themeAttribute(theme)}
      // The whole choice, so the picker and the palette can read back what is
      // on screen instead of keeping a second copy that can disagree with it.
      {...{ [THEME_CHOICE_ATTRIBUTE]: formatTheme(theme) ?? undefined }}
      style={themeStyle(theme)}
      data-density={density === 'comfortable' ? undefined : density}
      className={`${inter.variable} ${display.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
