import type { Metadata } from 'next';
import { Inter, Instrument_Sans } from 'next/font/google';
import './globals.css';

// Inter for UI at 14px base; Instrument Sans is the slightly warmer face used
// for the large dashboard numbers.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const instrument = Instrument_Sans({ variable: '--font-instrument', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Shopping Manager',
    template: '%s · Shopping Manager',
  },
  description:
    'Know what you already own, what you spent, and what you were about to buy again.',
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
