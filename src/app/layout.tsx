import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

const manrope = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
      weight: '200 800',
    },
    {
      path: '../../node_modules/@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2',
      weight: '200 800',
    },
  ],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'lastfinance', template: '%s · lastfinance' },
  description: 'Finanças pessoais em tempo real',
  applicationName: 'lastfinance',
  appleWebApp: { capable: true, title: 'lastfinance', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1512' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="pt-BR" suppressHydrationWarning className={manrope.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
