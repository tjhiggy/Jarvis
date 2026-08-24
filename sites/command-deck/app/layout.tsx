import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { resolveCommandDeckApiBaseUrl } from './lib/command-deck';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MuthaShip Command Deck',
  description:
    'A safe, read-only operational view of the MuthaShip Jarvis platform.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const commandDeckApiBaseUrl = resolveCommandDeckApiBaseUrl(
    process.env.COMMAND_DECK_API_BASE_URL,
  );
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {commandDeckApiBaseUrl === undefined ? null : (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__COMMAND_DECK_API_BASE_URL__=${JSON.stringify(commandDeckApiBaseUrl)};`,
            }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
