import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata:Metadata={title:'Wellspring | School reporting',description:'Daily student academic and behavioural reporting for international schools.'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
