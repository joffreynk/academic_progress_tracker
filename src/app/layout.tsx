import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata:Metadata={title:'School reporting',description:'student academic and behavioural reporting.'};
// Browser extensions (Grammarly and friends) inject attributes into <html>/<body> after the
// server render; suppressHydrationWarning (React 19's hydration suppression prop) keeps that
// from raising a hydration mismatch.
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>}
