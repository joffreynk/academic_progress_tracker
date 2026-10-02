import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata:Metadata={title:'School reporting',description:'student academic and behavioural reporting.'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
