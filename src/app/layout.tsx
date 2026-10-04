import type { Metadata, Viewport } from 'next';
import './globals.css';
import './interface.css';
export const metadata: Metadata = { title: 'Squires | Family Finance', description: 'Our spending, our plans, our next chapter.', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'Squires', statusBarStyle: 'default' }, icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{media:'(prefers-color-scheme: light)',color:'#ffffff'},{media:'(prefers-color-scheme: dark)',color:'#151619'}] };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
