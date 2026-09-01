import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Sans } from 'next/font/google';
import './globals.css';

// Inter for UI at 14px base; Instrument Sans is the slightly warmer face used
// for the large dashboard numbers.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const instrument = Instrument_Sans({ variable: '--font-instrument', subsets: ['latin'] });

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
