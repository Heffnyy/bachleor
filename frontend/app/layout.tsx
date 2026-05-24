import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hefny, Bachelor Project, Voice to Task',
  description: 'Record or upload audio and turn it into transcripts and tasks.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
