import type { Metadata } from 'next';
import { Geist, EB_Garamond, Noto_Serif } from 'next/font/google';
import './globals.css';
import { TRPCReactProvider } from '@/trpc/client';

/**
 * Typography replicates cluely.com's system (scraped from its CSS bundles):
 * Geist 400/500/600 as the sans workhorse, EB Garamond 400 as a rare serif
 * accent. Cluely's third face (Forma DJR) is commercial; Geist 600 with tight
 * tracking covers display duty, matching their modest-heading rhythm.
 */
const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const garamond = EB_Garamond({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
});

/**
 * The test screen reproduces the official Digital SAT typography exactly, as
 * published in College Board's Digital SAT Suite Technical Manual:
 *
 *   Noto Serif · 15pt · 24pt line height · weights 400 and 700
 *
 * Only those two weights are loaded, because only those two are specified.
 * The sizes are applied as literal `pt` in `globals.css` (.dsat-text), so the
 * spec is legible in the code rather than pre-converted to pixels.
 */
const notoSerif = Noto_Serif({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-bluebook',
});

export const metadata: Metadata = {
  title: 'SPrep — SAT Trainer',
  description: 'Personal SAT practice: mock tests, vocabulary decoding, and skill tracking.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${garamond.variable} ${notoSerif.variable}`}>
      <head>
        {/* Lineicons — the app's single icon set */}
        <link rel="stylesheet" href="https://cdn.lineicons.com/4.0/lineicons.css" />
      </head>
      <body className="bg-paper font-sans text-ink-700 antialiased">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
