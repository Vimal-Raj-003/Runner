import type { Metadata } from 'next';
import { Fira_Code, Fira_Sans } from 'next/font/google';
import './globals.css';

const firaSans = Fira_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-fira-sans',
  display: 'swap',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fira-code',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Runner System — Engineering Tool',
  description: 'Industrial-grade injection-mould runner and gate design',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning on <html>: some browser extensions
    // (e.g. Grammarly, Dark Reader, "crxlauncher" launcher add-ons)
    // inject extra attributes onto <html> after the server-rendered
    // HTML lands but before React hydrates. The mismatch is harmless
    // — React would skip the patch anyway — and this flag silences
    // the dev-only warning so real hydration bugs stay visible.
    <html
      lang="en"
      className={`${firaSans.variable} ${firaCode.variable}`}
      suppressHydrationWarning
    >
      <body className="h-screen overflow-hidden bg-bg text-fg antialiased">
        {children}
      </body>
    </html>
  );
}
